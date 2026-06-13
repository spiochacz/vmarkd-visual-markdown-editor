import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

const DECK = `---\nmarp: true\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n`
const PLAIN = `# Not a deck\n\njust text\n`

async function goto(page: Page) {
  await page.goto('/marp.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

// The first render of a marp doc shows a placeholder, then repaints with the deck once the chunk
// loads. waitFor the sections to appear.
async function renderDeck(page: Page, src: string) {
  await page.evaluate((s) => (window as any).__setSource(s), src)
  await page.evaluate(() => (window as any).__renderPreview())
  await page.waitForFunction(() => (window as any).__sectionCount() > 0)
}

test('a marp doc renders N <section> slides into the preview', async ({
  page,
}) => {
  await goto(page)
  await renderDeck(page, DECK)
  expect(await page.evaluate(() => (window as any).__sectionCount())).toBe(3)
})

test('a non-marp doc falls back to the normal (lute) render — no sections, chunk not loaded', async ({
  page,
}) => {
  await goto(page)
  await page.evaluate((s) => (window as any).__setSource(s), PLAIN)
  await page.evaluate(() => (window as any).__renderPreview())
  expect(await page.evaluate(() => (window as any).__sectionCount())).toBe(0)
  expect(await page.evaluate(() => (window as any).__marpLoaded())).toBe(false)
})

test('caret offset highlights the matching slide in the preview', async ({
  page,
}) => {
  await goto(page)
  await renderDeck(page, DECK)
  await page.evaluate(
    (o) => (window as any).__highlight(o),
    DECK.indexOf('# Two'),
  )
  expect(await page.evaluate(() => (window as any).__activeIdx())).toBe(1)
  // Guard the CSS selector itself (not just the class toggle): main.css is loaded into the
  // harness, so the active slide's focusBorder outline must actually compute to a real color.
  // A broken `.vditor-preview … section.vmarkd-marp__active` selector would leave it transparent.
  const outlineColor = await page.evaluate(() => {
    const active = document.querySelector(
      '.vditor-preview .vditor-reset section.vmarkd-marp__active',
    ) as HTMLElement
    return getComputedStyle(active).outlineColor
  })
  expect(outlineColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(outlineColor).not.toBe('transparent')
})

test('clicking a slide reports its source offset', async ({ page }) => {
  await goto(page)
  await renderDeck(page, DECK)
  await page.locator('.vditor-preview section').nth(2).click()
  const off = await page.evaluate(() => (window as any).__lastNavOffset())
  expect(off).toBe(DECK.indexOf('# Three'))
})

test('highlight is a no-op when the preview is hidden', async ({ page }) => {
  await goto(page)
  await renderDeck(page, DECK)
  await page.evaluate(() => (window as any).__previewVisible(false))
  await page.evaluate(
    (o) => (window as any).__highlight(o),
    DECK.indexOf('# Two'),
  )
  expect(await page.evaluate(() => (window as any).__activeIdx())).toBe(-1)
})
