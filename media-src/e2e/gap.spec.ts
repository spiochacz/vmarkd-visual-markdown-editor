import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Self-cleaning gap paragraph (gap-paragraph.ts). Vditor splices an empty <p> when you arrow
// off a block toward an adjacent code block so you CAN type between them; pure navigation
// then used to leave that empty paragraph behind (a blank markdown line + visible gap). The
// observer reclaims it once the caret leaves it empty, but keeps it the moment you type.

async function open(page: Page) {
  await page.goto('/gap.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  // let highlight.js settle so the code block is in its final shape
  await page.waitForTimeout(250)
}

const placeInFirstBlockquote = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    const bq = el.querySelector('blockquote') as HTMLElement
    const r = document.createRange()
    r.selectNodeContents(bq)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })

const emptyGapCount = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    return Array.from(el.querySelectorAll(':scope > p')).filter(
      (p) =>
        (p as HTMLElement).childElementCount === 0 &&
        (p.textContent || '').replace(/​/g, '').trim() === '',
    ).length
  })

test('arrowing into the gap gives an editable paragraph; arrowing through reclaims it (markdown unchanged)', async ({
  page,
}) => {
  await open(page)
  const before = await page.evaluate(() => (window as any).vditor.getValue())
  await placeInFirstBlockquote(page)
  // 1st ArrowDown: Vditor splices a gap paragraph and parks the caret in it (you can type).
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  expect(await emptyGapCount(page)).toBe(1)
  // 2nd ArrowDown: caret moves into the code block; the now-empty gap is reclaimed.
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect(await emptyGapCount(page)).toBe(0)
  expect(await page.evaluate(() => (window as any).vditor.getValue())).toBe(
    before,
  )
})

test('typing in the gap keeps the paragraph and its content', async ({
  page,
}) => {
  await open(page)
  await placeInFirstBlockquote(page)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  await page.keyboard.type('inserted between')
  await page.waitForTimeout(150)
  expect(
    await page.evaluate(() => (window as any).vditor.getValue()),
  ).toContain('inserted between')
  // it is NOT reclaimed once the caret leaves (it now holds content)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect(
    await page.evaluate(() => (window as any).vditor.getValue()),
  ).toContain('inserted between')
})
