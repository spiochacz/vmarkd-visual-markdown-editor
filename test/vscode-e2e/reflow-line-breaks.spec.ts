// Task 83 (increment 2) — vmarkd.editor.reflowLineBreaks, the Preview half, in the real webview.
// A soft-wrapped paragraph renders as ONE flowing paragraph (no <br>) in the full Preview by default,
// flipping the setting to false re-renders the OPEN preview with <br>s, and the file on disk is never
// touched (the setting only changes how the preview is drawn).
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { applySettings, useSettingsRestore } from './settings-helpers'
import { openInMode, settle, wf } from './webview-helpers'

useSettingsRestore(test, [
  'vmarkd.editor.defaultMode',
  'vmarkd.editor.reflowLineBreaks',
])

const DOC = [
  '# Soft wrap',
  '',
  'The first wrapped line',
  'continues on the second',
  'and ends on the third.',
  '',
  'A separate paragraph.',
  '',
].join('\n')

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('soft line breaks flow in the Preview, flip live with the setting, and the file never changes', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const file = path.join(tmpdir(), `vmarkd-reflow-${process.pid}.md`)
  writeFileSync(file, DOC)
  try {
    await openInMode(evaluateInVSCode, file, 'ir')
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    // Same toggle the Preview toolbar button runs.
    await frame.locator('body').evaluate(() => {
      const el = (
        window as unknown as {
          vditor: {
            vditor: { toolbar: { elements: Record<string, HTMLElement> } }
          }
        }
      ).vditor.vditor.toolbar.elements.preview
      const btn = el.querySelector('button') ?? el.children[0]
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const para = frame
      .locator('.vditor-preview .vditor-reset p', {
        hasText: 'The first wrapped line',
      })
      .first()
    await para.waitFor({ timeout: 30_000 })

    // Default (true): one flowing paragraph, the source newlines kept as plain text.
    await expect(para.locator('br')).toHaveCount(0)
    expect(await para.evaluate((p) => p.textContent)).toBe(
      'The first wrapped line\ncontinues on the second\nand ends on the third.',
    )

    // Flip the setting live: the OPEN preview re-renders with a <br> per source line break.
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.reflowLineBreaks': false,
    })
    await expect(para.locator('br')).toHaveCount(2, { timeout: 30_000 })

    // And back on.
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.reflowLineBreaks': true,
    })
    await expect(para.locator('br')).toHaveCount(0, { timeout: 30_000 })

    expect(readFileSync(file, 'utf8'), 'the file bytes never change').toBe(DOC)
  } finally {
    rmSync(file, { force: true })
  }
})
