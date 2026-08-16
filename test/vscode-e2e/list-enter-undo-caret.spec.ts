import { stickySelection, wf } from './webview-helpers'
// Task 487: Vditor's undo checkpoint (`Undo.addToUndoStack` -> `addCaret`, debounced ~800ms after an
// edit) restores the caret through vMarkd's `patchUndoCaretSplitRestore` patch. That restore used to
// carry a flat document-wide CHARACTER offset, which cannot address an empty block - an empty
// <li>/<p> contributes zero characters, so "inside the blank line Enter just made" and "end of the
// line before it" were the same number on both the capture and the resolve side. What the user saw:
// press Enter anywhere in a list, the caret descends correctly, then snaps BACK to the end of the
// previous line about a second later - in every list line, and only after Enter. Fixed by addressing
// the caret STRUCTURALLY (`{blockPath, offsetInBlock}`).
// This test only means anything because it waits PAST the undo debounce: the immediate assert passed
// even with the bug present. Real VS Code only - it needs the real custom-editor pipeline plus
// Vditor's own undo timer, neither of which the chromium harness has.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'list-enter-undo-caret.md')

const CARET_INFO = () => {
  const sel = window.getSelection()
  const n = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
  const el = n
    ? ((n.nodeType === 3 ? n.parentElement : (n as Element)) as Element)
    : null
  return {
    tag: el?.tagName ?? null,
    text: (el?.textContent ?? '').slice(0, 60),
    offset: sel?.rangeCount ? sel.getRangeAt(0).startOffset : null,
  }
}

test('Enter at the end of a list item leaves the caret in the NEW empty item, and it survives the undo checkpoint', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  await expect(frame.locator('.vditor-ir li').first()).toBeVisible({
    timeout: 45_000,
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  await frame.locator('.vditor-ir li').first().click()
  // Precise Range to the LOGICAL end of this li's text — `End` only reaches the end of the
  // current soft-WRAPPED visual line on this long item, not the true end (confirmed earlier).
  await stickySelection(
    frame,
    () => {
      const li = document.querySelector('.vditor-ir li')
      const t = li?.lastChild
      if (t?.nodeType !== 3) return
      const r = document.createRange()
      r.setStart(t, (t as Text).data.length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    },
    null,
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 200)))
  await workbox.keyboard.press('Enter')

  const immediate = await frame.locator('body').evaluate(CARET_INFO)
  expect(immediate.tag).toBe('LI')
  expect(immediate.text).toBe('')

  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1400)))

  // PAST Vditor's undo debounce (undoDelay, 800ms) - this is the assert the bug failed.
  const later = await frame.locator('body').evaluate(CARET_INFO)
  expect(later.tag).toBe('LI')
  expect(later.text).toBe('') // must STILL be the new empty li — not reverted to the previous one
})
