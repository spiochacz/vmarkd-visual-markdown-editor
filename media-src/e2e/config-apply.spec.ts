import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e that settings flowing through the REAL buildVditorOptions / main.ts
// construction actually apply to the rendered editor:
//   - showOutlineByDefault -> outline panel open/closed on init
//   - outlinePosition      -> outline panel side
//   - showToolbar          -> toolbar rendered with buttons / empty
// The harness builds the Vditor options exactly as main.ts does (see
// config-apply-harness.ts), so these assert the setting→DOM path, not a
// hand-rolled option object.

async function goto(page: Page, query: string) {
  await page.goto(`/config-apply.html${query}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

function outline(page: Page) {
  return page.locator('.vditor-outline')
}
function outlineItems(page: Page) {
  return page.locator('.vditor-outline li span[data-target-id]')
}
function toolbarButtons(page: Page) {
  return page.locator('.vditor-toolbar [data-type]')
}

test.describe('showOutlineByDefault governs the outline panel', () => {
  test('ON: outline opens on init with one item per heading', async ({
    page,
  }) => {
    await goto(page, '?openByDefault=1')
    expect(
      await page.evaluate(() => (window as any).__effectiveOutline.enable),
    ).toBe(true)
    await expect(outline(page)).toBeVisible()
    expect(await outlineItems(page).count()).toBeGreaterThanOrEqual(3)
  })

  test('OFF: outline panel is closed on init', async ({ page }) => {
    await goto(page, '?openByDefault=0')
    expect(
      await page.evaluate(() => (window as any).__effectiveOutline.enable),
    ).toBe(false)
    await expect(outline(page)).toBeHidden()
  })
})

test.describe('outlinePosition governs the panel side', () => {
  test('right (default): panel carries the --right modifier', async ({
    page,
  }) => {
    await goto(page, '?openByDefault=1&position=right')
    expect(
      await page.evaluate(() => (window as any).__effectiveOutline.position),
    ).toBe('right')
    await expect(outline(page)).toHaveClass(/vditor-outline--right/)
  })

  test('left: panel does NOT carry the --right modifier', async ({ page }) => {
    await goto(page, '?openByDefault=1&position=left')
    expect(
      await page.evaluate(() => (window as any).__effectiveOutline.position),
    ).toBe('left')
    await expect(outline(page)).not.toHaveClass(/vditor-outline--right/)
  })
})

test.describe('showToolbar governs the toolbar', () => {
  test('ON (default): the toolbar renders its buttons', async ({ page }) => {
    await goto(page, '?toolbar=1')
    expect(await toolbarButtons(page).count()).toBeGreaterThan(0)
  })

  test('OFF: the toolbar renders no buttons', async ({ page }) => {
    await goto(page, '?toolbar=0')
    await expect(toolbarButtons(page)).toHaveCount(0)
  })
})
