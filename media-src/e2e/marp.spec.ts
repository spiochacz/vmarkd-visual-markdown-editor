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
