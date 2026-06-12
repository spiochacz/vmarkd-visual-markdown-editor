import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for edit↔preview scroll-position preservation (preview-scroll-preserve.ts).
// Vditor's preview toggle re-renders the preview from the top; the user wants to
// stay where they were. The harness drives the SAME display toggle the toolbar
// Preview button performs (enter/leavePreview) and exposes the heading nearest
// each pane's viewport centre — a layout-independent "same place" check.

const VIEWPORT = { width: 1100, height: 500 }
test.use({ viewport: VIEWPORT })

async function goto(page: Page) {
  await page.goto('/preview-scroll.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

test('edit→preview keeps the same section in view (not scrolled to the top)', async ({
  page,
}) => {
  await goto(page)
  // Scroll the IR edit pane well past the top, let the anchor snapshot fire.
  await page.evaluate(() => (window as any).__preview.setEditScroll(2500))
  await page.waitForTimeout(80)
  const editHeading = await page.evaluate(() =>
    (window as any).__preview.editCenteredHeading(),
  )

  // Enter preview (fresh render from scrollTop 0) and let the pin settle.
  await page.evaluate(() => (window as any).__preview.enterPreview())
  await page.waitForTimeout(800)

  const { pvScroll, pvHeading } = await page.evaluate(() => ({
    pvScroll: (window as any).__preview.getPreviewScroll(),
    pvHeading: (window as any).__preview.previewCenteredHeading(),
  }))

  expect(pvScroll).toBeGreaterThan(200) // did NOT reset to the top
  expect(editHeading).toBeGreaterThan(0) // sanity: we really had scrolled
  expect(pvHeading).toBe(editHeading) // same section centred in the preview
})

test('preview→edit returns the editor to the section the preview was showing', async ({
  page,
}) => {
  await goto(page)
  // Enter preview, then scroll the PREVIEW somewhere of its own.
  await page.evaluate(() => (window as any).__preview.setEditScroll(1500))
  await page.waitForTimeout(80)
  await page.evaluate(() => (window as any).__preview.enterPreview())
  await page.waitForTimeout(800)

  await page.evaluate(() => (window as any).__preview.setPreviewScroll(4200))
  await page.waitForTimeout(80)
  const pvHeading = await page.evaluate(() =>
    (window as any).__preview.previewCenteredHeading(),
  )

  // Leave preview → the (already laid-out) editor should jump to that section.
  await page.evaluate(() => (window as any).__preview.leavePreview())
  await page.waitForTimeout(500)

  const { editScroll, editHeading } = await page.evaluate(() => ({
    editScroll: (window as any).__preview.getEditScroll(),
    editHeading: (window as any).__preview.editCenteredHeading(),
  }))

  expect(editScroll).toBeGreaterThan(200)
  expect(pvHeading).toBeGreaterThan(0)
  expect(editHeading).toBe(pvHeading)
})

test('edit→preview lands on the same BLOCK, not just the same section', async ({
  page,
}) => {
  await goto(page)
  // Scroll so the viewport centre sits on a non-heading block (a paragraph between
  // two headings). The reported bug: between headings the old heading-only anchor
  // interpolated linearly, so a block whose rendered height differs across panes
  // (a diagram) landed at the wrong spot. Block-level anchoring (IR & Preview are
  // both Lute renders → 1:1 blocks) keeps the SAME block centred, at the same
  // fraction down it.
  await page.evaluate(() => {
    const A = (window as any).__preview
    A.setEditScroll(99999)
    A.setEditScroll(Math.round(A.getEditScroll() * 0.4))
  })
  await page.waitForTimeout(120)
  const edit = await page.evaluate(() =>
    (window as any).__preview.editCenteredBlock(),
  )

  await page.evaluate(() => (window as any).__preview.enterPreview())
  await page.waitForTimeout(900)
  const pv = await page.evaluate(() =>
    (window as any).__preview.previewCenteredBlock(),
  )

  expect(edit.index).toBeGreaterThan(0) // really landed on a mid-doc block
  expect(pv.index).toBe(edit.index) // same block centred in the preview
  expect(Math.abs(pv.frac - edit.frac)).toBeLessThan(0.2) // same point within it
})

test('entering preview from the very top leaves the preview at the top', async ({
  page,
}) => {
  await goto(page)
  // No edit scroll → no anchor past the top → preview should open at (near) the top.
  await page.evaluate(() => (window as any).__preview.enterPreview())
  await page.waitForTimeout(800)
  const pvScroll = await page.evaluate(() =>
    (window as any).__preview.getPreviewScroll(),
  )
  expect(pvScroll).toBeLessThan(100)
})
