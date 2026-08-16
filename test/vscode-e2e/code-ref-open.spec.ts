import { type EvaluateInVSCode, settle } from './webview-helpers'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 229 — clickable code references (`src/foo.ts:42`). Proves the FULL round trip in a real
// VS Code webview: decoration is resolution-gated (a ref to a file that doesn't exist stays
// plain text, no chip), the modifier policy applies (plain click in editable content does NOT
// navigate — only Ctrl/Cmd+click does, same as every other link, task 62), resolution is
// WORKSPACE-relative (not doc-relative like onOpenLink's markdown-link targets — `main.md` lives
// under `sub/`, the ref is written as if from the workspace root, and it still resolves), and the
// click opens the PLAIN TEXT editor (never vmarkd's custom editor — task 52's reveal-line is a
// different feature) at the exact 1-based line/col the ref names.
//
// Outcome-based (tab shape / cursor position), matching local-link-open.spec.ts's own reasoning
// for why it doesn't intercept webview postMessage in real VS Code.
const dir = path.join(tmpdir(), `vmarkd-code-ref-${process.pid}`)
mkdirSync(path.join(dir, 'sub'), { recursive: true })
mkdirSync(path.join(dir, 'src'), { recursive: true })
// 5 lines so line 3 / line 2 col 5 are both meaningfully inside the file, not an edge case.
writeFileSync(
  path.join(dir, 'src', 'target.ts'),
  [
    '// line 1',
    'export const two = 2',
    'export const three = 3',
    '// line 4',
    '// line 5',
    '',
  ].join('\n'),
)
const main = path.join(dir, 'sub', 'main.md')
writeFileSync(
  main,
  [
    '# Code ref open',
    '',
    'See src/target.ts:3 for the prose reference.',
    '',
    'See `src/target.ts:2:5` for the inline-code reference.',
    '',
    'See src/does-not-exist.ts:5 for a reference that must stay plain.',
    '',
  ].join('\n'),
)

test.use({ baseDir: dir })

const wf = (w: import('@playwright/test').Page) =>
  w
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')

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

async function activeSelection(
  evaluateInVSCode: EvaluateInVSCode,
): Promise<{ line: number; character: number } | null> {
  return evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const sel = vscode.window.activeTextEditor?.selection
      return sel
        ? { line: sel.active.line, character: sel.active.character }
        : null
    },
    [] as unknown as [string],
  ) as Promise<{ line: number; character: number } | null>
}

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
  // Poll for the async resolve-code-refs round trip to land + decorate (task 451 — a fixed sleep
  // guessed a duration; this waits for the actual condition instead, and tolerates a slow CI/
  // shared-machine run without needing a longer blind guess). The prose chip is the earliest
  // reliable signal — 2 refs share the SAME path, so once one resolves, both do (shared cache).
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(
            () => document.querySelectorAll('[data-code-ref="1"]').length,
          ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  return { frame }
}

// Dispatch a click on the PROSE chip (`span.vmarkd-code-ref-chip`) whose own data-code-ref-line
// matches `line` — the fixture's two refs share a path (`src/target.ts`) but differ in
// line/col, so line disambiguates which one this hits. Returns whether a matching element was
// found.
async function clickProseCodeRef(
  frame: ReturnType<typeof wf>,
  line: number,
  opts: { ctrlKey: boolean },
): Promise<boolean> {
  return frame.locator('body').evaluate(
    (_el, args) => {
      const { line, ctrlKey } = args as { line: number; ctrlKey: boolean }
      const el = Array.from(
        document.querySelectorAll<HTMLElement>('span.vmarkd-code-ref-chip'),
      ).find((e) => e.dataset.codeRefLine === String(line))
      if (!el) return false
      el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey }),
      )
      return true
    },
    { line, ctrlKey: opts.ctrlKey },
  )
}

// Dispatch a click on the inline-code ref (`code.vmarkd-code-ref` — attribute-only decoration,
// task 229's "no DOM injection inside <code>"). The fixture has exactly one, so no disambiguator
// is needed.
async function clickInlineCodeRef(
  frame: ReturnType<typeof wf>,
  opts: { ctrlKey: boolean },
): Promise<boolean> {
  return frame.locator('body').evaluate((_el, ctrlKey) => {
    const el = document.querySelector<HTMLElement>('code.vmarkd-code-ref')
    if (!el) return false
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: ctrlKey as boolean,
      }),
    )
    return true
  }, opts.ctrlKey)
}

test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('a code reference resolves workspace-relative, is resolution-gated, and Ctrl+click opens the PLAIN text editor at the exact line/col — plain click does not navigate', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const { frame } = await boot(evaluateInVSCode, workbox)
  const before = await openTabInfo(evaluateInVSCode)

  // 1. Resolution gate: a ref to a file that doesn't exist must NOT be decorated at all — "no
  // dead-link chips". If this ever got a chip it would mean the resolve round trip stopped
  // gating (a functional regression, not a cosmetic one — the click would then fail with
  // "File not found").
  const missingChipCount = await frame
    .locator('body')
    .evaluate(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[data-code-ref="1"]'),
        ).filter((e) =>
          (e.dataset.codeRefPath ?? '').includes('does-not-exist'),
        ).length,
    )
  expect(missingChipCount).toBe(0)

  // 2. A PLAIN click on the resolved prose chip must NOT navigate (task 62's modifier policy —
  // plain click in editable content places the caret / edits, same as every other link).
  const foundForPlainClick = await clickProseCodeRef(frame, 3, {
    ctrlKey: false,
  })
  expect(foundForPlainClick).toBe(true) // the chip DOES exist (resolution succeeded)
  // Negative assertion (task 451 — no condition to poll FOR here, only the absence of one; a
  // fixed wait is the correct shape per the testing skill's own guidance).
  await settle(frame, 500)
  expect(await openTabInfo(evaluateInVSCode)).toEqual(before) // no new tab from the plain click

  // 3. Ctrl+click the PROSE reference (`src/target.ts:3`, written relative to the WORKSPACE
  // root even though main.md itself lives under sub/ — proves workspace-relative resolution,
  // not doc-relative like onOpenLink's markdown-link targets).
  const foundForCtrlClick = await clickProseCodeRef(frame, 3, { ctrlKey: true })
  expect(foundForCtrlClick).toBe(true)
  await expect
    .poll(async () => (await openTabInfo(evaluateInVSCode)).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(before.length)

  const afterProse = await openTabInfo(evaluateInVSCode)
  const newTabs = afterProse.filter(
    (t) => !before.some((b) => b.fsPath === t.fsPath),
  )
  // The discriminating assertion (task 229: "the plain text-editor path, NOT the custom
  // editor"): viewType is undefined for a TabInputText, never 'vmarkd.editor'.
  expect(newTabs).toEqual([
    { fsPath: path.join(dir, 'src', 'target.ts'), viewType: undefined },
  ])
  // Line 3 (1-based, how it's written) → Position line 2 (0-based). No column written → char 0.
  // `activeTextEditor` can lag a beat behind the tab actually opening — poll for it too.
  await expect
    .poll(async () => (await activeSelection(evaluateInVSCode))?.line, {
      timeout: 15_000,
    })
    .toBe(2)
  expect(await activeSelection(evaluateInVSCode)).toEqual({
    line: 2,
    character: 0,
  })

  // 4. The INLINE-CODE variant (`` `src/target.ts:2:5` ``) — attribute-only decoration (no
  // nested span inside the <code>), and its own Ctrl+click opens at line 2 col 5
  // (0-based: line 1, character 4) — proving line/col parsing isn't hardcoded to the prose path.
  const inlineDecoration = await frame.locator('body').evaluate(() => {
    const code = document.querySelector<HTMLElement>('code.vmarkd-code-ref')
    return code
      ? { childCount: code.children.length, text: code.textContent }
      : null
  })
  expect(inlineDecoration).toEqual({ childCount: 0, text: 'src/target.ts:2:5' })

  const foundInline = await clickInlineCodeRef(frame, { ctrlKey: true })
  expect(foundInline).toBe(true)
  await expect
    .poll(async () => (await activeSelection(evaluateInVSCode))?.line, {
      timeout: 15_000,
    })
    .toBe(1)
  expect(await activeSelection(evaluateInVSCode)).toEqual({
    line: 1,
    character: 4,
  })
})
