import { type EvaluateInVSCode, settle } from './webview-helpers'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 359 — verifies the FIX (onOpenLink: Uri.file not Uri.parse, raw href not resolved href,
// scheme allowlist, directory/missing-target handling). The probe
// (local-link-open-probe.spec.ts) measured the PRE-fix behaviour: a relative WYSIWYG/preview
// link resolved to a `https://…vscode-resource…` href and routed to `env.openExternal` instead
// of opening the file — confirmed via a host-side patch of `vscode.env.openExternal`.
//
// This spec is outcome-based (open tab / error message / no tab), matching the task's own L3
// verification wording — no webview-side message interception, which the probe found doesn't
// work in real VS Code (`acquireVsCodeApi().postMessage` is non-writable there).
//
// `../b.md` (per the task's verification list) needs a WORKSPACE FOLDER open — without one,
// onOpenLink's containment (task 148 item 2) treats the doc's own directory as the root and
// refuses ANY `../` escape from it, by design (see open-link.test.ts's "without a workspace"
// case). `baseDir` is vscode-test-playwright's launch-folder option; overriding it here (instead
// of the default throwaway temp dir) makes VS Code open with THIS fixture tree as the workspace
// root, matching how a real user (a project folder open) would hit this path.
const dir = path.join(tmpdir(), `vmarkd-link-open-${process.pid}`)
mkdirSync(path.join(dir, 'sub'), { recursive: true })
mkdirSync(path.join(dir, 'a-directory'), { recursive: true })
writeFileSync(path.join(dir, 'sub', 'a.md'), '# A\n')
writeFileSync(path.join(dir, 'b.md'), '# B\n')
writeFileSync(path.join(dir, 'my file.md'), '# Spaced\n')
const main = path.join(dir, 'sub', 'main.md')
writeFileSync(
  main,
  [
    '# Local link open',
    '',
    '- [nested](./a.md)',
    '- [up-then-sibling](../b.md)',
    '- [spaced](../my%20file.md)',
    '- [dir](../a-directory)',
    '- [missing](../does-not-exist.md)',
    '- [web](https://example.com)',
    '',
  ].join('\n'),
)

test.use({ baseDir: dir })

const wf = (w: import('@playwright/test').Page) =>
  w
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  // Task 468 — used to set a `workbench.editorAssociations` override here (task 243 review):
  // vmarkd's customEditor `priority` is `"option"` (package.json), so plain `vscode.open` was
  // NOT guaranteed to land in the vmarkd webview for a fresh profile. Fixed at the product
  // level in task 468 (onOpenLink now forces `vscode.openWith(…, 'vmarkd.editor')` for a
  // markdown target whenever the SOURCE panel — main.md, opened via `vscode.openWith` below —
  // is itself vMarkd), so the override is gone; `openTabInfo`'s viewType assertions below are
  // the real proof it still works without it, not a workaround for it being broken.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [main] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  // Switch to WYSIWYG through the toolbar edit-mode panel (the user's own path) — real <a
  // href> elements only exist there / in SV's preview pane, not in IR's marker spans.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  await settle(frame, 1000)

  return { frame }
}

async function openTabFsPaths(
  evaluateInVSCode: EvaluateInVSCode,
): Promise<string[]> {
  return evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      return vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map(
          (t) =>
            (t.input as { uri?: { fsPath?: string } } | undefined)?.uri?.fsPath,
        )
        .filter((p): p is string => !!p)
    },
    [] as unknown as [string],
  ) as Promise<string[]>
}

// Task 243 review — `openTabFsPaths` alone proved a link-clicked file's TAB opened, never
// which EDITOR it opened in. vmarkd's customEditor `priority` is `"option"` (package.json), not
// `"default"`, so `onOpenLink`'s `vscode.commands.executeCommand('vscode.open', targetUri)`
// (below, unchanged) is not guaranteed to land in the vmarkd webview at all — in a profile with
// no prior "Open With" choice for .md it opens VS Code's built-in text editor instead, silently
// (a `vscode.TabInputText`, no `viewType`, vs a vmarkd tab's `vscode.TabInputCustom` with
// `viewType: 'vmarkd.editor'`). This suite was green for its whole life without ever
// distinguishing the two — a test that can't tell them apart is worse than no test at all
// (task 243's anchor-links.spec.ts is what surfaced this, cross-checking a NEW file's tab type
// after a link click for the first time). Returns BOTH so a regression back to "opens as plain
// text" fails here, not just silently in whatever feature next assumed a vmarkd webview exists.
async function openTabInfo(
  evaluateInVSCode: EvaluateInVSCode,
): Promise<Array<{ fsPath: string; viewType: string | undefined }>> {
  return evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      return vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map((t) => {
          const input = t.input as
            | { uri?: { fsPath?: string }; viewType?: string }
            | undefined
          return { fsPath: input?.uri?.fsPath, viewType: input?.viewType }
        })
        .filter(
          (t): t is { fsPath: string; viewType: string | undefined } =>
            !!t.fsPath,
        )
    },
    [] as unknown as [string],
  ) as Promise<Array<{ fsPath: string; viewType: string | undefined }>>
}

// Extension-host-side patch of showErrorMessage — plain mutable object there (unlike the
// webview's non-writable acquireVsCodeApi() handle, see local-link-open-probe.spec.ts).
async function installErrorSpy(evaluateInVSCode: EvaluateInVSCode) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const g = globalThis as unknown as { __linkOpenErrors?: string[] }
      g.__linkOpenErrors = []
      const orig = vscode.window.showErrorMessage.bind(vscode.window)
      vscode.window.showErrorMessage = ((msg: string, ...rest: unknown[]) => {
        g.__linkOpenErrors!.push(msg)
        return (orig as any)(msg, ...rest)
      }) as typeof vscode.window.showErrorMessage
    },
    [] as unknown as [string],
  )
}

async function readErrorSpy(
  evaluateInVSCode: EvaluateInVSCode,
): Promise<string[]> {
  return evaluateInVSCode(
    async () => {
      return (
        (globalThis as unknown as { __linkOpenErrors?: string[] })
          .__linkOpenErrors ?? []
      )
    },
    [] as unknown as [string],
  ) as Promise<string[]>
}

async function ctrlClickLink(
  frame: ReturnType<typeof wf>,
  hrefSubstring: string,
) {
  await frame.locator('body').evaluate((_el, needle) => {
    const a = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.vditor-wysiwyg a[href]'),
    ).find((el) => (el.getAttribute('href') ?? '').includes(needle as string))
    if (!a) throw new Error(`link containing "${needle}" not found`)
    a.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    )
  }, hrefSubstring)
}

test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('a nested relative link (./a.md) opens the right file, not the OS browser, AS a vmarkd editor', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabInfo(evaluateInVSCode)

  await ctrlClickLink(frame, './a.md')
  await settle(frame, 1500)

  const after = await openTabInfo(evaluateInVSCode)
  const newTabs = after.filter(
    (t) => !before.some((b) => b.fsPath === t.fsPath),
  )
  expect(newTabs).toEqual([
    { fsPath: path.join(dir, 'sub', 'a.md'), viewType: 'vmarkd.editor' },
  ])
})

test('"../b.md" resolves against the workspace and opens the sibling file AS a vmarkd editor', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabInfo(evaluateInVSCode)

  await ctrlClickLink(frame, '../b.md')
  await settle(frame, 1500)

  const after = await openTabInfo(evaluateInVSCode)
  const newTabs = after.filter(
    (t) => !before.some((b) => b.fsPath === t.fsPath),
  )
  expect(newTabs).toEqual([
    { fsPath: path.join(dir, 'b.md'), viewType: 'vmarkd.editor' },
  ])
})

test('a percent-encoded space ("my%20file.md") resolves to the real spaced filename, opened AS a vmarkd editor', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabInfo(evaluateInVSCode)

  await ctrlClickLink(frame, 'my%20file.md')
  await settle(frame, 1500)

  const after = await openTabInfo(evaluateInVSCode)
  const newTabs = after.filter(
    (t) => !before.some((b) => b.fsPath === t.fsPath),
  )
  expect(newTabs).toEqual([
    { fsPath: path.join(dir, 'my file.md'), viewType: 'vmarkd.editor' },
  ])
})

test('a directory target reveals it in the Explorer, not "open as file"', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabFsPaths(evaluateInVSCode)

  await ctrlClickLink(frame, 'a-directory')
  await settle(frame, 1500)

  const after = await openTabFsPaths(evaluateInVSCode)
  // No new EDITOR tab — the directory is revealed in Explorer, not opened as a document.
  expect(after.filter((p) => !before.includes(p))).toEqual([])
})

test('a missing target shows a readable error naming the resolved path — no raw failure, no silent no-op', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  await installErrorSpy(evaluateInVSCode)
  const before = await openTabFsPaths(evaluateInVSCode)

  await ctrlClickLink(frame, 'does-not-exist.md')
  await settle(frame, 1500)

  const after = await openTabFsPaths(evaluateInVSCode)
  expect(after.filter((p) => !before.includes(p))).toEqual([])
  const errors = await readErrorSpy(evaluateInVSCode)
  expect(errors.some((m) => m.includes('does-not-exist.md'))).toBe(true)
})

test('an https:// link does NOT open an editor tab (routes to the OS browser instead)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabFsPaths(evaluateInVSCode)

  await ctrlClickLink(frame, 'https://example.com')
  await settle(frame, 1500)

  const after = await openTabFsPaths(evaluateInVSCode)
  expect(after.filter((p) => !before.includes(p))).toEqual([])
})
