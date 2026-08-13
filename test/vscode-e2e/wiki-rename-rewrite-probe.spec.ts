import { settle, wf } from './webview-helpers'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

// Journey A5 (tasks/516-qa-journey-coverage-plan.md, Phase 1) = 455's open item ("no spec matches
// `renameFile`"), probe-first. `a.md` holds a `[[b]]` wiki chip; `b.md` (the target) is renamed to
// `c.md` from OUTSIDE the webview (`vscode.workspace.fs.rename`, the same API the Explorer's
// rename-in-place uses, and the one `editor-session.ts`'s `onDidRenameFiles` handler already
// listens to — but only to re-point ITS OWN open document's identity, not to rewrite chips inside
// its text that reference some OTHER renamed file). No code path found under
// `grep -rl wiki src/ media-src/src` rewrites chip text on a target rename, so this MEASURES rather
// than assumes: does `[[b]]` in `a.md` become `[[c]]`, or does it stay stale and now point nowhere?
//
// MUST run inside a real workspace folder (getWikiDocumentContext needs it) — `baseDir` fixture IS
// the workspace root, matching wiki-chip-focus.spec.ts's setup.
const wfFrame = wf

test('@probe probe: renaming a wiki-chip TARGET file — does the chip text follow or go stale', async ({
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
  const frame = wfFrame(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  const chipBefore = frame.locator('.wiki-link-chip[data-wiki-target="b"]')
  await chipBefore.waitFor({ timeout: 60_000 })
  await settle(frame, 1000)

  console.log(
    `[wiki-rename] BEFORE rename: chip present, data-wiki-target="b", a.md text=${JSON.stringify(aContent)}`,
  )

  // Rename b.md -> c.md via the real workspace.fs.rename API (same one Explorer rename uses).
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
  await settle(frame, 3000) // let onDidRenameFiles + any watcher reaction settle

  const chipAfterB = await frame
    .locator('.wiki-link-chip[data-wiki-target="b"]')
    .count()
  const chipAfterC = await frame
    .locator('.wiki-link-chip[data-wiki-target="c"]')
    .count()
  const webviewValue = await frame
    .locator('body')
    .evaluate(() => (window as any).vditor?.getValue?.() ?? null)
  const docState = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return { isDirty: doc?.isDirty ?? null, text: doc?.getText() ?? null }
    },
    [aPath] as [string],
  )
  console.log(
    `[wiki-rename] AFTER rename: chipStillTargetsB=${chipAfterB > 0} chipNowTargetsC=${chipAfterC > 0} ` +
      `webviewValue=${JSON.stringify(webviewValue)} docIsDirty=${(docState as any).isDirty} ` +
      `docText=${JSON.stringify((docState as any).text)}`,
  )

  // Does the (possibly stale) chip still navigate anywhere? Click it via the same activation path
  // wiki-chip-focus.spec.ts uses — place the caret inside, then Ctrl+Enter.
  const anyChip = frame.locator('.wiki-link-chip').first()
  if ((await anyChip.count()) > 0) {
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await anyChip.evaluate((el) => {
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
    await settle(frame, 2000)

    const openTabs = await evaluateInVSCode(
      async (vscode: typeof import('vscode')) =>
        vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .filter((t) => t.input instanceof vscode.TabInputCustom)
          .map((t) => (t.input as import('vscode').TabInputCustom).uri.fsPath),
    )
    const toast = await workbox.evaluate(() => {
      const toasts = document.querySelector('.notifications-toasts')
      return {
        toastText: toasts?.textContent?.trim().slice(0, 500) ?? null,
        buttons: toasts
          ? Array.from(toasts.querySelectorAll('a.monaco-button, button')).map(
              (b) => b.textContent?.trim(),
            )
          : [],
      }
    })
    console.log(
      `[wiki-rename] AFTER Ctrl+Enter on the chip, open vmarkd tabs=${JSON.stringify(openTabs)} (bPath=${bPath}, cPath=${cPath}) ` +
        `toastText=${JSON.stringify(toast.toastText)} toastButtons=${JSON.stringify(toast.buttons)}`,
    )
    // Dismiss any toast so it doesn't linger across the next probe/test.
    if (toast.toastText) {
      await workbox.keyboard.press('Escape')
      await settle(frame, 500)
    }
  }

  console.log(
    `[wiki-rename] c.md on disk exists with content: ${readFileSync(cPath, 'utf8').slice(0, 30)}`,
  )

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})
