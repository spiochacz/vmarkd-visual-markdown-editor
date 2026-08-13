// D3 (tasks/516 Phase 4) — wiki create-missing-page. `[[Page]]` with no matching file under
// `wiki.root` renders a chip flagged `data-wiki-missing="1"`; activating it (Ctrl+Enter, the same
// `activateWikiLink` -> `open-wikilink` path wiki-chip-focus.spec.ts pins for a resolved link) hits
// `onOpenWikilink`'s zero-match branch (src/session/asset-link-actions.ts), which shows a native
// `showWarningMessage('… was not found …', 'Create Page')` toast. Clicking "Create Page" calls
// `createWikiPage(root, key)` (src/wiki/wiki.ts) and opens the result.
//
// Deliberately asserting the EXACT landing path, not just "a new tab opened somewhere" — task 521
// found that the SAME `createWikiPage(root, key)` call, reached via a stale chip after a rename,
// silently forks a duplicate page at a path the user doesn't expect. This spec's fixture has no
// pre-existing file at all, so there's no fork risk here, but pinning the exact path is what would
// have caught 521's shape if it had been checked here first.
//
// Pattern lifted from wiki-chip-focus.spec.ts (caret-in-chip + Ctrl+Enter activation) and
// wiki-rename-stale-chip.spec.ts (the "Create Page" toast — that spec dismisses it deliberately;
// this one clicks it, since landing the create IS the journey here).
//
// Red proof: `expectedNewFile` was temporarily pointed at a path the create call would never
// write to, confirmed to fail (both the toast-timeout and file-appearance assertions), then
// reverted to the real computed path below.
import { settle, wf } from './webview-helpers'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

test('Ctrl+Enter on a missing [[Page]] creates the file under wiki.root and opens it', async ({
  workbox,
  evaluateInVSCode,
  baseDir,
}) => {
  test.setTimeout(90_000)

  const docPath = path.join(baseDir, 'wiki-create-missing.md')
  const docContent =
    '# Wiki create-missing-page (task 516 D3)\n\nSee the [[Missing Page]] page.\n'
  writeFileSync(docPath, docContent)
  // The page must NOT already exist — that's the whole precondition for the zero-match branch.
  const expectedNewFile = path.join(baseDir, 'missing-page.md')
  expect(
    existsSync(expectedNewFile),
    'fixture precondition: target must not pre-exist',
  ).toBe(false)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [docPath] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  const chip = frame.locator('.wiki-link-chip[data-wiki-target="Missing Page"]')
  await chip.waitFor({ timeout: 60_000 })
  await expect(chip).toHaveAttribute('data-wiki-missing', '1')
  await settle(frame, 500)

  // Caret-in-chip activation, same as wiki-chip-focus.spec.ts / wiki-rename-stale-chip.spec.ts.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await chip.evaluate((el) => {
    const text = el.firstChild
    if (!text) return
    const range = document.createRange()
    range.setStart(text, Math.min(1, text.textContent?.length ?? 0))
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
  await settle(frame, 500)
  await workbox.keyboard.press('Control+Enter')

  await expect
    .poll(
      () =>
        workbox.evaluate(
          () =>
            document.querySelector('.notifications-toasts')?.textContent ?? '',
        ),
      { timeout: 15_000 },
    )
    .toContain('was not found')

  const createButton = workbox
    .locator(
      '.notifications-toasts a.monaco-button, .notifications-toasts button',
    )
    .filter({ hasText: 'Create Page' })
    .first()
  await createButton.click()

  // The file lands at the exact path createWikiPage computes from the normalized key — not
  // somewhere else, not a fork of an existing page (there wasn't one to fork here, but the path
  // itself is the assertion task 521 says matters).
  await expect
    .poll(() => existsSync(expectedNewFile), {
      message: `missing-page.md never appeared at ${expectedNewFile}`,
      timeout: 15_000,
    })
    .toBe(true)
  expect(readFileSync(expectedNewFile, 'utf8')).toBe('# Missing Page\n')

  // And it opens — a vmarkd.editor tab for exactly that new file.
  await expect
    .poll(
      () =>
        evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) =>
            vscode.window.tabGroups.all
              .flatMap((g) => g.tabs)
              .some(
                (t) =>
                  t.input instanceof vscode.TabInputCustom &&
                  t.input.viewType === 'vmarkd.editor' &&
                  t.input.uri.fsPath === args[0],
              ),
          [expectedNewFile] as [string],
        ),
      { timeout: 15_000, intervals: [300, 600, 1000] },
    )
    .toBe(true)

  // The originating document is untouched — this is a navigation + filesystem side effect, not an
  // edit to the document the chip was activated from.
  const originalDocText = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [docPath] as [string],
  )
  expect(originalDocText).toBe(docContent)

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})
