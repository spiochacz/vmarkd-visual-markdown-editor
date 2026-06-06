import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for heading-anchored split-view scroll sync (task 48). The harness creates
// Vditor in SV mode with preview.mode "both" (source + preview side-by-side) and
// 30 sections. Tests scroll the source pane and verify the preview follows.

const VIEWPORT = { width: 1300, height: 400 }
test.use({ viewport: VIEWPORT })

async function gotoSplit(page: Page) {
  await page.goto('/split-scroll.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // Wait for both panes to be visible and have content
  await page.waitForSelector('.vditor-sv', { state: 'visible' })
  await page.waitForSelector('.vditor-preview', { state: 'visible' })
  // Wait for preview to render enough content to be scrollable
  await page.waitForFunction(
    () => {
      const pv = document.querySelector('.vditor-preview') as HTMLElement
      return pv && pv.scrollHeight > pv.clientHeight + 100
    },
    { timeout: 5000 },
  )
}

test('both source and preview panes are visible in split mode', async ({
  page,
}) => {
  await gotoSplit(page)
  await expect(page.locator('.vditor-sv')).toBeVisible()
  await expect(page.locator('.vditor-preview')).toBeVisible()
})

test('source pane is scrollable (content taller than viewport)', async ({
  page,
}) => {
  await gotoSplit(page)
  const scrollable = await page.evaluate(() => {
    const sv = document.querySelector('.vditor-sv') as HTMLElement
    return sv ? sv.scrollHeight > sv.clientHeight : false
  })
  expect(scrollable).toBe(true)
})

test('scrolling source to the middle moves preview away from top', async ({
  page,
}) => {
  await gotoSplit(page)

  const initialScroll = await page.evaluate(
    () =>
      (document.querySelector('.vditor-preview') as HTMLElement)?.scrollTop ??
      0,
  )

  const svBox = await page.locator('.vditor-sv').boundingBox()
  await page.mouse.move(svBox!.x + 50, svBox!.y + 50)
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(300)

  const afterScroll = await page.evaluate(
    () =>
      (document.querySelector('.vditor-preview') as HTMLElement)?.scrollTop ??
      0,
  )

  expect(afterScroll).toBeGreaterThan(initialScroll + 50)
})

test('scrolling source to the bottom scrolls preview near its bottom', async ({
  page,
}) => {
  await gotoSplit(page)

  const svBox2 = await page.locator('.vditor-sv').boundingBox()
  await page.mouse.move(svBox2!.x + 50, svBox2!.y + 50)
  await page.mouse.wheel(0, 99999)
  await page.waitForTimeout(100)

  const { scrollTop, scrollHeight, clientHeight } = await page.evaluate(() => {
    const pv = document.querySelector('.vditor-preview') as HTMLElement
    return {
      scrollTop: pv?.scrollTop ?? 0,
      scrollHeight: pv?.scrollHeight ?? 0,
      clientHeight: pv?.clientHeight ?? 0,
    }
  })

  // Preview should be near the bottom (within 20% of max scroll)
  const maxScroll = scrollHeight - clientHeight
  expect(scrollTop).toBeGreaterThan(maxScroll * 0.7)
})

test('scrolling source back to top resets preview to near top', async ({
  page,
}) => {
  await gotoSplit(page)

  const svBox3 = await page.locator('.vditor-sv').boundingBox()
  await page.mouse.move(svBox3!.x + 50, svBox3!.y + 50)
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(300)

  // Scroll back to top
  await page.mouse.wheel(0, -99999)
  await page.waitForTimeout(100)

  const scrollTop = await page.evaluate(
    () =>
      (document.querySelector('.vditor-preview') as HTMLElement)?.scrollTop ??
      0,
  )

  // Preview should be back near the top (within 100px — heading-anchored
  // sync interpolates, so the first heading offset can be non-zero)
  expect(scrollTop).toBeLessThan(100)
})
