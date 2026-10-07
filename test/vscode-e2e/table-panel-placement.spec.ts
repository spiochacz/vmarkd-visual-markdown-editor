// Task 531 — the floating table-edit panel is mounted OUTSIDE the editable IR element (a sibling
// inside `.vditor-ir`), so no editing machinery has to special-case it. Placement and scrolling can
// only be proven in the real webview: the panel must sit by the clicked cell, scroll with the
// content, never be part of the editable root, and its buttons must still act on the table.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

const file = path.join(tmpdir(), 'vmarkd-table-panel.md')

test.afterEach(async ({ evaluateInVSCode }) => {
  rmSync(file, { force: true })
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('the table panel sits outside the editable root, follows the cell through a scroll, and its buttons act', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const filler = Array.from({ length: 60 }, (_, i) => `filler ${i}`).join(
    '\n\n',
  )
  writeFileSync(
    file,
    `${filler}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n${filler}\n`,
  )
  await openInMode(evaluateInVSCode, file, 'ir')
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 800)

  const cell = frame.locator('.vditor-ir td').first()
  await cell.scrollIntoViewIfNeeded()
  await cell.click()

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const w = document.getElementById('fix-table-ir-wrapper')
      const ir = (window as any).vditor.vditor.ir.element as HTMLElement
      const td = ir.querySelector('td') as HTMLElement
      const panel = w?.querySelector('.vditor-panel') as HTMLElement | null
      const pr = panel?.getBoundingClientRect()
      return {
        exists: !!w,
        insideRoot: !!w && ir.contains(w),
        inContainer: !!w && w.parentElement === ir.parentElement,
        display: panel?.style.display,
        panelTop: pr?.top ?? NaN,
        panelLeft: pr?.left ?? NaN,
        cellTop: td.getBoundingClientRect().top,
        cellLeft: td.getBoundingClientRect().left,
      }
    })
  await expect
    .poll(async () => (await measure()).display, { message: 'panel shown' })
    .toBe('block')
  const before = await measure()
  expect(before.exists).toBe(true)
  expect(before.insideRoot).toBe(false)
  expect(before.inContainer).toBe(true)
  expect(before.display).toBe('block')
  // The collapsed puck is translated -25px horizontally and placed 25px above the cell.
  expect(Math.abs(before.panelTop - (before.cellTop - 25))).toBeLessThan(6)
  expect(Math.abs(before.panelLeft - (before.cellLeft - 25))).toBeLessThan(6)

  // Scroll the content: the panel must move with the cell, not stay put.
  await workbox.mouse.wheel(0, 120)
  await expect
    .poll(
      async () => {
        const m = await measure()
        return m.cellTop !== before.cellTop
          ? Math.round(m.panelTop - m.cellTop)
          : null
      },
      { message: 'the panel keeps its offset from the cell while scrolling' },
    )
    .toBe(Math.round(before.panelTop - before.cellTop))

  // A button still acts on the table (insert row below).
  await frame.locator('#fix-table-ir-wrapper .vditor-panel').hover()
  await frame
    .locator('#fix-table-ir-wrapper .vditor-icon[data-type="insertRowB"]')
    .click()
  await expect
    .poll(
      async () => (await docText(evaluateInVSCode, file)).split('\n| ').length,
      {
        message: 'insertRowB added a table row',
      },
    )
    .toBeGreaterThan(3)
})
