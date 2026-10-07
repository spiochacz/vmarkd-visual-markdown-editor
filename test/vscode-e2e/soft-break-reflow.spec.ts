// Task 83 (increment 3) — vmarkd.editor.reflowLineBreaks in the EDITOR, in the real webview, both
// surfaces. A soft-wrapped paragraph is ONE visual line carrying a ↵ marker per source newline; the
// newlines survive every edit and the save byte for byte; Shift+Enter makes a hard break; undo/redo
// across a marker restores text and caret; the setting flips live. One VS Code boot per mode.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { applySettings, useSettingsRestore } from './settings-helpers'
import {
  docText,
  openInMode,
  placeCaretAtEndOf,
  settle,
  wf,
} from './webview-helpers'

useSettingsRestore(test, [
  'vmarkd.editor.defaultMode',
  'vmarkd.editor.reflowLineBreaks',
])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

const DOC = [
  '# Soft wrap',
  '',
  'Alpha one',
  'beta two',
  'gamma three',
  '',
  'Second one',
  'second two',
  '',
  '> quote one',
  '> quote two',
  '',
  'Tail para.',
  '',
].join('\n')

const FINAL = [
  '# Soft wrap',
  '',
  'Alpha one',
  'YQbeta two',
  'gamma three',
  '',
  'Second one',
  'second two\\',
  'N',
  '',
  '> quote one',
  '> quote two',
  '',
  'Tail para.',
  '',
].join('\n')

for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`soft breaks reflow with ↵ markers, edits keep every newline, Shift+Enter hard-breaks, undo/redo and the live flip work (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(300_000)
    const file = path.join(tmpdir(), `vmarkd-softbreak-${mode}.md`)
    writeFileSync(file, DOC)
    try {
      await applySettings(evaluateInVSCode, {
        'vmarkd.editor.reflowLineBreaks': true,
      })
      await openInMode(evaluateInVSCode, file, mode)
      const frame = wf(workbox)
      const surface = frame.locator(`.vditor-${mode}`).first()
      await surface.waitFor({ timeout: 60_000 })
      const markers = frame.locator('.vmarkd-softbreak')
      // Alpha (2) + Second (1) + quote (1)
      await expect(markers).toHaveCount(4, { timeout: 60_000 })

      const lines = (needle: string) =>
        frame.locator('body').evaluate((_b, needle) => {
          const p = [...document.querySelectorAll('.vditor-reset p')].find(
            (x) => x.textContent?.includes(needle),
          ) as HTMLElement
          const r = document.createRange()
          r.selectNodeContents(p)
          return new Set([...r.getClientRects()].map((c) => Math.round(c.top)))
            .size
        }, needle)

      // 1. One visual line, a generated ↵ glyph, a selection that never contains it.
      expect(await lines('Alpha one')).toBe(1)
      const probe = await frame.locator('body').evaluate(() => {
        const sp = document.querySelector('.vmarkd-softbreak') as HTMLElement
        const p = sp.closest('p') as HTMLElement
        const r = document.createRange()
        r.selectNodeContents(p)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(r)
        return {
          glyph: getComputedStyle(sp, '::before').content,
          selected: getSelection()?.toString() ?? '',
          editable: sp.getAttribute('contenteditable'),
        }
      })
      expect(probe.glyph).toContain('↵')
      expect(probe.selected).toBe('Alpha one beta two gamma three')
      expect(probe.editable).toBe('false')
      expect(await docText(evaluateInVSCode, file)).toBe(DOC)

      // 2. Mid-paragraph edit across a marker: Home (= paragraph start, one visual line), 9 chars to
      //    the end of line 1, ONE more press across the break, type.
      await placeCaretAtEndOf(frame, workbox, 'p', 'gamma three')
      await workbox.keyboard.press('Home')
      for (let i = 0; i < 10; i++) await workbox.keyboard.press('ArrowRight')
      await settle(frame, 1300) // Vditor undoDelay is 800 ms: Z must be its own undo step
      await workbox.keyboard.type('Z')
      await expect
        .poll(() => docText(evaluateInVSCode, file))
        .toBe(DOC.replace('beta two', 'Zbeta two'))

      // 3. Undo restores the text AND the caret (the next keystroke lands at the same place); then
      //    undo + redo of that second step.
      await settle(frame, 1300)
      await workbox.keyboard.press('Control+z')
      await expect.poll(() => docText(evaluateInVSCode, file)).toBe(DOC)
      await settle(frame, 500)
      await workbox.keyboard.type('Y')
      await expect
        .poll(() => docText(evaluateInVSCode, file), {
          message: 'the keystroke after undo landed at the restored caret',
        })
        .toBe(DOC.replace('beta two', 'Ybeta two'))
      await settle(frame, 1300)
      await workbox.keyboard.press('Control+z')
      await expect.poll(() => docText(evaluateInVSCode, file)).toBe(DOC)
      await settle(frame, 500)
      await workbox.keyboard.press('Control+y')
      await expect
        .poll(() => docText(evaluateInVSCode, file))
        .toBe(DOC.replace('beta two', 'Ybeta two'))
      await settle(frame, 500)
      await workbox.keyboard.type('Q')
      await expect
        .poll(() => docText(evaluateInVSCode, file))
        .toBe(DOC.replace('beta two', 'YQbeta two'))
      // decoration never leaked into the document or multiplied: markers are back, still 4
      await expect(markers).toHaveCount(4)
      expect(await lines('Alpha one')).toBe(1)

      // 4. Shift+Enter at the end of a soft-wrapped paragraph = a HARD break (backslash + newline),
      //    and the line visibly breaks (two visual lines now).
      await placeCaretAtEndOf(frame, workbox, 'p', 'second two')
      await workbox.keyboard.press('Shift+Enter')
      await settle(frame, 300)
      await workbox.keyboard.type('N')
      await expect.poll(() => docText(evaluateInVSCode, file)).toBe(FINAL)
      await expect.poll(() => lines('Second one')).toBe(2)

      // 5. Live flip off: spans gone, the paragraph shows its three source lines, the text is the
      //    same; back on: reflowed again.
      await applySettings(evaluateInVSCode, {
        'vmarkd.editor.reflowLineBreaks': false,
      })
      await expect(markers).toHaveCount(0, { timeout: 30_000 })
      expect(await lines('Alpha one')).toBe(3)
      expect(await docText(evaluateInVSCode, file)).toBe(FINAL)
      await applySettings(evaluateInVSCode, {
        'vmarkd.editor.reflowLineBreaks': true,
      })
      await expect(markers).toHaveCount(4, { timeout: 30_000 })
      expect(await lines('Alpha one')).toBe(1)

      // 6. Saved bytes.
      await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      })
      await settle(frame, 500)
      expect(readFileSync(file, 'utf8')).toBe(FINAL)
    } finally {
      rmSync(file, { force: true })
    }
  })
}
