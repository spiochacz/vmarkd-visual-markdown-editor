// Task 531 — after Ctrl+Z (and redo) in IR mode the NEXT keystroke must land at the restored caret
// and reach the document. Measured before the fix: IR undo left the caret anchored on a DIV outside
// the editable root, so the next typed character never reached the DOM or the saved file. WYSIWYG
// was always fine and is the control.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

const CHORDS = [undefined, 'Control+y', 'Control+Shift+z'] as const

// One VS Code boot per mode: each phase re-opens a fresh file in the SAME window (the 2500 ms wait after
// each open is what makes the race deterministic — the initial undo snapshot is taken before the first
// click creates the table panel — so a phase must not reuse a session in which that click already ran).
for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`typing right after undo, and after undo then redo, lands at the restored caret (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(300_000)
    for (const chord of CHORDS) {
      const file = path.join(
        tmpdir(),
        `vmarkd-undo-type-${mode}-${(chord ?? 'undo').replace(/\W/g, '')}.md`,
      )
      writeFileSync(file, 'abcd\n\nsecond\n')
      await openInMode(evaluateInVSCode, file, mode)
      const frame = wf(workbox)
      const surface = frame.locator(`.vditor-${mode}`).first()
      await surface.waitFor({ timeout: 60_000 })
      await settle(frame, 2500) // initial undo snapshot is taken before the first click creates the table panel

      await surface.locator('p').filter({ hasText: 'abcd' }).first().click()
      await settle(frame, 300)
      await workbox.keyboard.press('End')
      await workbox.keyboard.press('ArrowLeft')
      await workbox.keyboard.press('ArrowLeft')
      await settle(frame, 1300) // Vditor undoDelay is 800 ms: X must be its own undo step
      await workbox.keyboard.type('X')
      await expect
        .poll(() => docText(evaluateInVSCode, file))
        .toBe('abXcd\n\nsecond\n')
      await settle(frame, 1300)
      await workbox.keyboard.press('Control+z')
      await expect
        .poll(() => docText(evaluateInVSCode, file))
        .toBe('abcd\n\nsecond\n')
      await settle(frame, 500)
      if (!chord) {
        await workbox.keyboard.type('Y')
        await expect
          .poll(() => docText(evaluateInVSCode, file), {
            message: 'the keystroke after undo reached the document',
          })
          .toBe('abYcd\n\nsecond\n')
      } else {
        await workbox.keyboard.press(chord)
        await expect
          .poll(() => docText(evaluateInVSCode, file))
          .toBe('abXcd\n\nsecond\n')
        await settle(frame, 500)
        await workbox.keyboard.type('Z')
        await expect
          .poll(() => docText(evaluateInVSCode, file), {
            message: `the keystroke after redo (${chord}) reached the document`,
          })
          .toBe('abXZcd\n\nsecond\n')
      }
      rmSync(file, { force: true })
    }
  })
}
