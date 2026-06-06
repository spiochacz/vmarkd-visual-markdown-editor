import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for narrow-width (full-width OFF) centring. The 800px text column must be
// horizontally centred (equal left/right margins) on every surface, and must NOT
// shift between Edit and Preview. Regression for: (a) Preview pane left-aligned while
// the editor centred → a width/gutter jump on toggle; (b) heading-markers OFF forcing
// a fixed 10px left gutter → content stuck left with no left margin.

const VIEWPORT = { width: 1300, height: 900 }
const COLUMN = 800 // Vditor preview.maxWidth default (vMarkd doesn't override it)

test.use({ viewport: VIEWPORT })

async function gotoWidth(page: Page) {
  await page.goto('/width.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

// Distance from the viewport's left/right edge to where the TEXT actually starts/ends
// (the element's border-box rect adjusted by its horizontal padding), plus the content
// width. Centred ⟺ leftGap ≈ rightGap.
async function measure(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    return {
      leftGap: r.left + padL,
      rightGap: window.innerWidth - (r.right - padR),
      contentWidth: r.width - padL - padR,
    }
  }, selector)
}

const IR = '.vditor-ir pre.vditor-reset'
const PREVIEW = '.vditor-preview > .vditor-reset'

test('IR editor centres the 800px column (equal left/right margins)', async ({
  page,
}) => {
  await gotoWidth(page)
  const m = (await measure(page, IR))!
  expect(m).not.toBeNull()
  // centred: gaps within a few px of each other, and clearly NOT left-aligned
  expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThan(10)
  expect(m.leftGap).toBeGreaterThan(100)
  expect(Math.abs(m.contentWidth - COLUMN)).toBeLessThan(40)
})

test('heading-markers OFF keeps the column centred (still has a left margin)', async ({
  page,
}) => {
  await gotoWidth(page)
  const before = (await measure(page, IR))!
  await page.evaluate(() => (window as any).__setMarkers(false))
  const after = (await measure(page, IR))!
  // markers off must NOT collapse the left gutter to ~10px — stays centred
  expect(Math.abs(after.leftGap - after.rightGap)).toBeLessThan(10)
  expect(after.leftGap).toBeGreaterThan(100)
  // and the column doesn't move when markers toggle
  expect(Math.abs(after.leftGap - before.leftGap)).toBeLessThan(6)
})

test('Preview pane centres the same column with no Edit→Preview shift', async ({
  page,
}) => {
  // Force classic (non-overlay) scrollbars — Playwright defaults to overlay, hiding
  // the Edit↔Preview shift caused by the scrollbar taking space inside the pane.
  await page.addStyleTag({
    content:
      '::-webkit-scrollbar { width: 16px !important; } ' +
      '* { scrollbar-width: auto !important; }',
  })
  await gotoWidth(page)
  const editGap = (await measure(page, IR))!.leftGap

  await page.click('[data-type="preview"]')
  await page.waitForSelector(PREVIEW, { state: 'visible' })
  const m = (await measure(page, PREVIEW))!

  // preview content left edge matches the editor's → no horizontal jump on toggle,
  // even with a classic scrollbar taking space on the right
  expect(Math.abs(m.leftGap - editGap)).toBeLessThan(8)
  expect(Math.abs(m.contentWidth - COLUMN)).toBeLessThan(40)
})
