import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// Bug: open a large doc, scroll to the bottom WITHOUT clicking into the text, then
// click a toolbar button → the view jumps to the top. Cause: with no live selection
// and no stored range, Vditor focuses the editor and re-renders, and the innerHTML
// replacement silently resets the scroll container's scrollTop to 0.
//
// The fix (guardToolbarScroll) must not only end up at the right place but also leave
// NO visible flash — so each test samples the MINIMUM scrollTop across the whole window
// (a flash would show a low minimum) and asserts it never dropped toward the top.

async function ready(page: Page) {
  await page.goto('/scrolljump.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForTimeout(50)
}

// Scroll to the bottom and start sampling the min scrollTop (rAF + a 1ms timer, so a
// painted dip can't slip through). Returns the bottom offset.
async function scrollBottomAndWatch(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = (window as any).__scroller() as HTMLElement
    s.scrollTop = s.scrollHeight
    ;(window as any).__min = s.scrollTop
    const sample = () => {
      const v = (window as any).__scroller().scrollTop
      if (v < (window as any).__min) (window as any).__min = v
      ;(window as any).__raf = requestAnimationFrame(sample)
    }
    sample()
    ;(window as any).__iv = setInterval(() => {
      const v = (window as any).__scroller().scrollTop
      if (v < (window as any).__min) (window as any).__min = v
    }, 1)
    return s.scrollTop
  })
}

async function readResult(page: Page) {
  return page.evaluate(() => {
    clearInterval((window as any).__iv)
    cancelAnimationFrame((window as any).__raf)
    return {
      min: (window as any).__min as number,
      final: (window as any).__scroller().scrollTop as number,
    }
  })
}

test('clicking a toolbar formatting button keeps a scrolled doc in place (no flash)', async ({
  page,
}) => {
  await ready(page)
  const bottom = await scrollBottomAndWatch(page)
  expect(bottom).toBeGreaterThan(200)

  await page.click('.vditor-toolbar button[data-type="bold"]')
  await page.waitForTimeout(700)

  const { min, final } = await readResult(page)
  expect(final).toBeGreaterThan(bottom - 50) // ends where it was
  expect(min).toBeGreaterThan(bottom - 50) // never flashed toward the top
})

test('re-selecting the current edit-mode keeps a scrolled doc in place (no flash)', async ({
  page,
}) => {
  await ready(page)
  const bottom = await scrollBottomAndWatch(page)
  expect(bottom).toBeGreaterThan(200)

  await page.click('.vditor-toolbar button[data-type="edit-mode"]')
  await page.waitForTimeout(50)
  await page.click('.vditor-toolbar button[data-mode="ir"]')
  await page.waitForTimeout(700)

  const { min, final } = await readResult(page)
  expect(final).toBeGreaterThan(bottom - 50)
  expect(min).toBeGreaterThan(bottom - 50)
})

// The mousedown viewport-jump-to-top only reproduces in the VS Code webview iframe (a
// browser focus-scroll-to-caret), not in this harness — so we can't assert the visual
// jump directly. Instead we guard the FIX MECHANISM: the toolbar mousedown must be
// default-prevented (that's what stops the focus shift + scroll-to-caret). If a refactor
// drops the preventDefault, this goes red.
test('toolbar mousedown is default-prevented (focus-scroll suppression)', async ({
  page,
}) => {
  await ready(page)
  const prevented = await page.evaluate(() => {
    const btn = document.querySelector(
      '.vditor-toolbar button[data-type="edit-mode"]',
    ) as HTMLElement
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(true)
})
