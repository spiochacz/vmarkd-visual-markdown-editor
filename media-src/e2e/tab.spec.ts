import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e for the Tab fix. Vditor only handles Tab when `options.tab` is set; it was
 * unset, so Tab fell through to the browser, which moved focus to the next tabbable
 * element (the host iframe) and scrolled the view away. main.ts now sets `tab`.
 * With it, Tab stays in the editor and inserts indentation.
 */
async function gotoTab(page: Page, withTab: boolean) {
  await page.goto(`/tab.html${withTab ? '' : '?tab=off'}`)
  await page.waitForFunction(() => (window as any).__ready === true)
  // Caret into the first paragraph.
  const box = await page.evaluate(() => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const r = el.getBoundingClientRect()
    return { x: r.x + 8, y: r.y + 8 }
  })
  await page.mouse.click(box.x, box.y)
}

function state(page: Page) {
  return page.evaluate(() => ({
    activeTag: document.activeElement?.tagName ?? null,
    inEditor: !!document.activeElement?.closest?.('.vditor-ir'),
    len: (window as any).vditor.getValue().length,
  }))
}

test('with options.tab set, Tab stays in the editor and inserts indentation', async ({
  page,
}) => {
  await gotoTab(page, true)
  const before = await state(page)
  expect(before.inEditor).toBe(true)
  await page.keyboard.press('Tab')
  const after = await state(page)
  expect(after.inEditor).toBe(true) // focus did NOT escape the editor
  expect(after.activeTag).not.toBe('IFRAME')
  expect(after.len).toBeGreaterThan(before.len) // Tab inserted indentation
})

test('without options.tab, Tab escapes focus out of the editor (the bug)', async ({
  page,
}) => {
  await gotoTab(page, false)
  const before = await state(page)
  expect(before.inEditor).toBe(true)
  await page.keyboard.press('Tab')
  const after = await state(page)
  // Focus left the editor (to the host iframe / next tabbable) — the scroll-away.
  expect(after.inEditor).toBe(false)
  expect(after.len).toBe(before.len) // nothing inserted
})
