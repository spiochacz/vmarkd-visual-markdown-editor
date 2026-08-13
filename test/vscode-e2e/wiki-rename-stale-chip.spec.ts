import { settle, wf } from './webview-helpers'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 516 A5) — PINS a real bug found by wiki-rename-rewrite-probe.spec.ts, does NOT fix it.
// `a.md` holds a `[[b]]` chip; `b.md` is renamed to `c.md` via `workspace.fs.rename` (the same API
// Explorer rename uses). Measured contract, confirmed by reading source:
//
//   - `src/session/editor-session.ts`'s `onDidRenameFiles` handler is the ONLY rename listener in
//     the codebase (grep confirmed). It re-points only the CURRENTLY OPEN document's OWN identity
//     when THAT document is the renamed file — it never scans other open documents for chip
//     references, so `[[b]]` in `a.md` stays `[[b]]` verbatim: text, dirty state, everything.
//   - Activating the now-dangling chip (Ctrl+Enter -> `open-wikilink` -> `onOpenWikilink` ->
///    `cache.resolve('b')` -> 0 matches) does NOT silently fail and does NOT reach the renamed file.
//     It shows `showWarningMessage('Wiki page "b" was not found under "<root>".', 'Create Page')`.
//   - THE TRAP: clicking "Create Page" doesn't help the user reach `c.md` — `createWikiPage(root,
//     'b')` (src/wiki/wiki.ts) writes a BRAND NEW `b.md` at the wiki root, i.e. exactly the path the
//     real file used to occupy before the rename, seeded with just a bare heading. The chip still
//     LOOKS fine (`[[b]]`, no error markers anywhere in the source), and its own "fix this" affordance
//     silently forks a duplicate stub page instead of reaching the renamed target. A dead link that
//     announces itself is an annoyance; this looks fine and quietly forks the wiki.
//
// This spec pins the CURRENT (broken) contract so a future fix (chip rewrite on rename) flips it
// red on purpose, the same "pinned broken" shape as task 520's D4 net.
test('renaming a wiki-chip TARGET file leaves the chip stale, and activating it offers to create a DUPLICATE page rather than reach the rename', async ({
  workbox,
  evaluateInVSCode,
  baseDir,
}) => {
  test.setTimeout(90_000)

  const bPath = path.join(baseDir, 'b.md')
  const cPath = path.join(baseDir, 'c.md')
  const aPath = path.join(baseDir, 'a.md')
  writeFileSync(bPath, '# B\n\nThe rename target page.\n')
  const aContent = '# A\n\nSee the [[b]] page for details.\n'
  writeFileSync(aPath, aContent)

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
    [aPath] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  const chip = frame.locator('.wiki-link-chip[data-wiki-target="b"]')
  await chip.waitFor({ timeout: 60_000 })
  await settle(frame, 1000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.workspace.fs.rename(
        vscode.Uri.file(args[0]),
        vscode.Uri.file(args[1]),
        { overwrite: false },
      )
    },
    [bPath, cPath] as [string, string],
  )
  await settle(frame, 3000)

  // The chip stays stale — still targets "b", never "c" — and the document text/dirty state are
  // completely untouched by the rename.
  await expect(frame.locator('.wiki-link-chip[data-wiki-target="b"]')).toHaveCount(1)
  await expect(frame.locator('.wiki-link-chip[data-wiki-target="c"]')).toHaveCount(0)
  const afterRename = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return { isDirty: doc?.isDirty ?? null, text: doc?.getText() ?? null }
    },
    [aPath] as [string],
  )
  expect((afterRename as { isDirty: boolean | null }).isDirty).toBe(false)
  expect((afterRename as { text: string | null }).text).toBe(aContent)

  // Activate the stale chip.
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

  // It does NOT navigate to the renamed file — no new vmarkd tab for c.md ever opens.
  await settle(frame, 2000)
  const openTabsAfterActivate = (await evaluateInVSCode(
    async (vscode: typeof import('vscode')) =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputCustom)
        .map((t) => (t.input as import('vscode').TabInputCustom).uri.fsPath),
  )) as string[]
  expect(
    openTabsAfterActivate,
    'the stale chip must not navigate to the renamed file',
  ).not.toContain(cPath)

  // Instead it shows the SAME "missing page" prompt as a plain nonexistent link, offering to
  // create a NEW page at the STALE name.
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
  const toastButtons = await workbox.evaluate(() =>
    Array.from(
      document.querySelectorAll('.notifications-toasts a.monaco-button, .notifications-toasts button'),
    ).map((b) => b.textContent?.trim()),
  )
  expect(toastButtons).toContain('Create Page')

  // Dismiss the toast without clicking "Create Page" — this spec pins the PROMPT, not the write;
  // actually creating the duplicate file is exercised implicitly by wiki.ts's own createWikiPage
  // logic and isn't re-verified here (that would need a second full fixture setup for one extra
  // assertion of a single-purpose helper already read directly from source in the header comment).
  await workbox.keyboard.press('Escape')
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})
