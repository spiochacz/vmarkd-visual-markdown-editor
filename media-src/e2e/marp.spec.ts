import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

const DECK = `---
marp: true
---

# Slide one

---

# Slide two

---

# Slide three
`

async function goto(page: Page) {
  await page.goto('/marp.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

test('renders one <section> per slide', async ({ page }) => {
  await goto(page)
  const count = await page.evaluate(
    (src) => (window as any).__renderDeck(src),
    DECK,
  )
  expect(count).toBe(3)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(3)
})

test('the deck CSS does not leak onto .vditor-reset', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  // Marp scopes its theme under .marpit; the editor chrome keeps its own colour.
  const color = await page.evaluate(
    () => getComputedStyle(document.querySelector('.vditor-reset')!).color,
  )
  expect(color).toBe('rgb(1, 2, 3)')
})

test('re-rendering with new source updates the deck', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(3)
  const two = await page.evaluate(
    (src) => (window as any).__renderDeck(src),
    `---\nmarp: true\n---\n\n# Only one\n\n---\n\n# And two\n`,
  )
  expect(two).toBe(2)
  await expect(page.locator('#panel .vmarkd-marp__deck section')).toHaveCount(2)
})

test('the marp chunk is not loaded until a deck is rendered', async ({
  page,
}) => {
  await goto(page)
  expect(await page.evaluate(() => (window as any).__marpLoaded())).toBe(false)
  await page.evaluate((src) => (window as any).__renderDeck(src), DECK)
  expect(await page.evaluate(() => (window as any).__marpLoaded())).toBe(true)
})

test('caret in slide K highlights slide K in the deck', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__mountPanel(src), DECK)
  // Place the "caret" at a source offset inside slide 2 (0-based slide index 1).
  await page.evaluate(() => (window as any).__setCaretToSlide(1))
  await expect(
    page.locator('#mount .vmarkd-marp__deck section.vmarkd-marp__active'),
  ).toHaveCount(1)
  const idx = await page.evaluate(() => (window as any).__activeSlideIndex())
  expect(idx).toBe(1)
})

test('clicking slide K reports slide K source offset', async ({ page }) => {
  await goto(page)
  await page.evaluate((src) => (window as any).__mountPanel(src), DECK)
  await page.locator('#mount .vmarkd-marp__deck section').nth(2).click()
  // The reverse-nav hook records the requested source offset.
  const off = await page.evaluate(() => (window as any).__lastNavOffset())
  // Slide 3 (index 2) starts after the first two `---` slide-break lines.
  expect(off).toBeGreaterThan(0)
  const before = DECK.slice(0, off)
  // Two slide-break `---` occur before slide 3's content.
  expect((before.match(/^---$/gm) || []).length).toBeGreaterThanOrEqual(3)
})

test('overlay draws N cards for N slides in IR/WYSIWYG', async ({ page }) => {
  await goto(page)
  // The overlay harness builds an editable element with top-level <hr>s (3 slides = 2 hrs).
  await page.evaluate(() => (window as any).__mountOverlay(2))
  await expect(page.locator('#editor .vmarkd-marp-card')).toHaveCount(3)
})

test('overlay leaves the editable DOM (and its <hr>s) untouched', async ({
  page,
}) => {
  await goto(page)
  // Build the editable content first, then snapshot it BEFORE the overlay is mounted.
  await page.evaluate(() => (window as any).__buildEditor(2))
  const before = await page.evaluate(() => (window as any).__editorHtml())
  await page.evaluate(() => (window as any).__mountOverlay(2))
  const editable = await page.evaluate(() => (window as any).__editorHtml())
  // Cards live in a separate overlay layer, not inside the editable content.
  expect(editable).toBe(before)
  expect(await page.evaluate(() => (window as any).__editorHrCount())).toBe(2)
})
