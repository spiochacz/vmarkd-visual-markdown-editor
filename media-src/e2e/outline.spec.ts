import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for the outline cluster (tasks 07/08/13): the outline panel renders its
// heading items on the configured side, clicking one flashes the target
// heading, and the highlight/width CSS hooks behave.

async function gotoOutline(page: Page) {
  await page.goto('/outline.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

test('outline renders heading items and opens on the configured (right) side', async ({
  page,
}) => {
  await gotoOutline(page)
  await expect(page.locator('.vditor-outline')).toHaveClass(
    /vditor-outline--right/,
  )
  const items = page.locator('.vditor-outline li span[data-target-id]')
  // one per heading in the harness document (H1/H2/H3)
  expect(await items.count()).toBeGreaterThanOrEqual(3)
})

test('clicking an outline item flashes the target heading (task 13)', async ({
  page,
}) => {
  await gotoOutline(page)
  const targetId = await page.evaluate(() => {
    const span = document.querySelector(
      '.vditor-outline li span[data-target-id]',
    ) as HTMLElement
    span.click() // bubbles to the outline container → setupOutlineFlash
    return span.getAttribute('data-target-id')
  })
  // SCROLL_SETTLE_MS is 60ms; wait past it then assert the flash class landed.
  await page.waitForTimeout(150)
  const flashed = await page.evaluate(
    (id) => document.getElementById(id!)?.classList.contains('heading-flash'),
    targetId,
  )
  expect(flashed).toBe(true)
})

test('highlight-headings attr themes headings; --me-outline-width drives panel width', async ({
  page,
}) => {
  await gotoOutline(page)
  const styles = await page.evaluate(() => {
    document.body.setAttribute('data-highlight-headings', '1')
    document.body.style.setProperty('--me-outline-width', '321px')
    const h1 = document.querySelector('.vditor-reset h1') as HTMLElement
    const outline = document.querySelector('.vditor-outline') as HTMLElement
    return {
      h1Radius: getComputedStyle(h1).borderRadius,
      h1Bg: getComputedStyle(h1).backgroundColor,
      outlineWidth: getComputedStyle(outline).width,
    }
  })
  expect(styles.h1Radius).toBe('3px') // heading-highlight rule applied
  // translucent overlay (follows the theme), not a fixed blue-grey var
  expect(styles.h1Bg).toBe('rgba(127, 127, 127, 0.13)')
  expect(styles.outlineWidth).toBe('321px') // width var applied
})

test('--me-font-size drives the .vditor-reset base size; headings scale with it (task 43)', async ({
  page,
}) => {
  await gotoOutline(page)
  const sizes = await page.evaluate(() => {
    const reset = document.querySelector('.vditor-reset') as HTMLElement
    const h1 = document.querySelector('.vditor-reset h1') as HTMLElement
    document.body.style.setProperty('--me-font-size', '20px')
    const base20 = parseFloat(getComputedStyle(reset).fontSize)
    const h1At20 = parseFloat(getComputedStyle(h1).fontSize)
    document.body.style.setProperty('--me-font-size', '10px')
    const base10 = parseFloat(getComputedStyle(reset).fontSize)
    return { base20, base10, h1At20 }
  })
  expect(sizes.base20).toBe(20) // CSS rule follows the var
  expect(sizes.base10).toBe(10) // and updates live
  expect(sizes.h1At20).toBeGreaterThan(20) // em-relative heading scales up
})

test('showHeadingMarkers toggle hides the gutter markers and tightens the gutter', async ({
  page,
}) => {
  await gotoOutline(page)
  const result = await page.evaluate(() => {
    const h1 = document.querySelector(
      '.vditor-ir .vditor-reset > h1',
    ) as HTMLElement
    const reset = document.querySelector(
      '.vditor-ir .vditor-reset',
    ) as HTMLElement
    // Gutter tightening on markers-off is a FULL-WIDTH behaviour: in narrow mode the
    // content is centred, so the gutter must NOT collapse to a fixed 10px (that left-
    // aligns it — see width.spec.ts). Exercise the tightening in full-width mode.
    document.body.setAttribute('data-full-width', '1')
    document.body.setAttribute('data-heading-markers', '1')
    const shown = getComputedStyle(h1, '::before').display
    const padOn = getComputedStyle(reset).paddingLeft
    document.body.setAttribute('data-heading-markers', '0')
    const hidden = getComputedStyle(h1, '::before').display
    const padOff = getComputedStyle(reset).paddingLeft
    return { shown, hidden, padOn, padOff }
  })
  expect(result.shown).not.toBe('none') // marker visible by default
  expect(result.hidden).toBe('none') // hidden when toggled off
  // the now-empty left gutter is tightened
  expect(parseFloat(result.padOff)).toBeLessThan(parseFloat(result.padOn))
})

// The drag-resize handle must track the outline's visibility. Vditor's Outline.toggle()
// only flips the panel's inline display; with the outline OFF the handle would otherwise
// hang at the editor's right edge (visible grip for a hidden panel) and its straddle margins
// poked a few px past the viewport → a phantom horizontal scrollbar. outline-resize.ts mirrors
// the outline's display onto the handle.
test('the resize handle is hidden when the outline is toggled off, shown when on', async ({
  page,
}) => {
  await gotoOutline(page)
  const handle = page.locator('.outline-resize-handle')
  await expect(handle).toHaveCount(1)
  // outline starts enabled → handle visible
  await expect(handle).toBeVisible()

  // toggle the outline OFF through Vditor's own path (sets display:none on the panel)
  await page.evaluate(() => {
    const v = (window as any).vditor.vditor
    v.outline.toggle(v, false)
  })
  await expect(handle).toBeHidden() // MutationObserver mirrored display:none

  // and back ON
  await page.evaluate(() => {
    const v = (window as any).vditor.vditor
    v.outline.toggle(v, true)
  })
  await expect(handle).toBeVisible()
})
