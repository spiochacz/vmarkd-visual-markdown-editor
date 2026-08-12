import { wf } from './webview-helpers'
// NET (task 516 A8) — closing a DIRTY vMarkd tab must not silently lose or leak an edit.
//
// PROBE FINDING (recorded here, not a separate probe file — see the report to team-lead): the
// interactive "Save / Don't Save / Cancel" dialog cannot be reached in this harness at all.
// vscode-test-playwright always launches VS Code with BOTH `--extensionDevelopmentPath` and
// `--extensionTestsPath` set (test/vscode-e2e/node_modules/vscode-test-playwright/dist/index.js),
// which makes VS Code's own `DialogService`/`FileDialogService` `skipDialogs()` return true
// (`environmentService.isExtensionDevelopment && environmentService.extensionTestsLocationURI`,
// see the compiled `.vscode-test/.../workbench.desktop.main.js`). Concretely,
// `FileDialogService.showSaveConfirm()` — the exact call VS Code's close-editor flow makes to ask
// "Save / Don't Save / Cancel" — short-circuits to `return 1` (Don't Save) BEFORE any UI renders,
// logging "FileDialogService: refused to show save confirmation dialog in tests." So:
//   - There is no reachable "click Save in the dialog" interaction in ANY real-VS-Code spec in
//     this repo — the dialog literally never opens. That half of A8 belongs on the manual QA
//     checklist (tasks/516-qa-journey-coverage-plan.md), not here.
//   - "Don't Save" is, ironically, the environment's unconditional default — every dirty close in
//     this harness silently takes that branch. That IS a real, always-exercised, automatable
//     journey: prove the extension's webview→document write path (WorkspaceEdit through VS Code's
//     own dirty tracking, not an out-of-band disk write — see writeback-controller.ts) respects
//     that default and never lets the discarded edit reach disk.
// The ordinary "explicit Ctrl+S / Save command" path (no dialog involved) is already covered by
// save-fidelity.spec.ts / undo-dirty-probe.spec.ts and is not re-tested here.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const SRC = path.join(__dirname, 'fixtures', 'dirty-close.md')
const MARKER = 'DIRTYCLOSEMARKER'

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('closing a dirty tab discards the edit — nothing leaks to disk, the tab closes', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const tmp = path.join(tmpdir(), 'vmarkd-dirty-close.md')
  const before = readFileSync(SRC, 'utf8')
  writeFileSync(tmp, before)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      // Close any editor left over from a previous test/repeat FIRST — see checkbox-toggle.spec.ts
      // for why a stale already-open tab silently no-ops everything that follows.
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  // PAGE-LEVEL keyboard focus into the nested webview iframe first (see save-fidelity.spec.ts).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  await frame.locator('body').evaluate(() => {
    const p = Array.from(document.querySelectorAll('.vditor-ir p')).find((x) =>
      x.textContent?.includes('Edit here'),
    ) as HTMLElement | undefined
    const t = p?.lastChild as Text | null
    if (!t) throw new Error('edit target not found')
    const r = document.createRange()
    r.setStart(t, (t.textContent ?? '').length)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    p?.focus()
  })
  await workbox.keyboard.type(MARKER, { delay: 40 })

  const docState = () =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === args[0],
        )
        return { isDirty: !!doc?.isDirty, text: doc?.getText() ?? '' }
      },
      [tmp] as [string],
    ) as Promise<{ isDirty: boolean; text: string }>

  // The document is dirty and holds the typed marker BEFORE we close.
  await expect
    .poll(async () => (await docState()).isDirty, {
      timeout: 10_000,
      intervals: [200, 300, 500, 800],
    })
    .toBe(true)
  const dirty = await docState()
  expect(dirty.text, 'the marker reached the live document').toContain(MARKER)

  // Close the tab. In THIS harness this ALWAYS takes the "Don't Save" branch (see header note) —
  // no dialog appears, no interaction needed.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    },
    [] as [],
  )

  // The tab is gone AND the document is no longer tracked as an open (dirty) TextDocument.
  await expect
    .poll(
      async () =>
        (await evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) => {
            const stillOpenTab = vscode.window.tabGroups.all
              .flatMap((g) => g.tabs)
              .some(
                (t) =>
                  t.input instanceof vscode.TabInputCustom &&
                  t.input.uri.fsPath === args[0],
              )
            const stillTrackedDirty = !!vscode.workspace.textDocuments.find(
              (d) => d.uri.fsPath === args[0],
            )?.isDirty
            return { stillOpenTab, stillTrackedDirty }
          },
          [tmp] as [string],
        )) as { stillOpenTab: boolean; stillTrackedDirty: boolean },
      { timeout: 10_000, intervals: [200, 300, 500, 800] },
    )
    .toEqual({ stillOpenTab: false, stillTrackedDirty: false })

  const after = readFileSync(tmp, 'utf8')
  expect(after, 'discarded edit must not reach disk').toBe(before)
  expect(after, 'the marker must never land on disk').not.toContain(MARKER)
})
