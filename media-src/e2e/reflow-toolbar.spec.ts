import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 83 (increment 4) — the toolbar toggle for vmarkd.editor.reflowLineBreaks. Clicking it flips the
 * setting live (markers off/on; pressed class + aria-pressed = reflow OFF, i.e. line breaks kept) and posts `set-reflow-line-breaks`
 * to the host; a changed value from the host side (VS Code Settings -> config-changed) moves the button
 * too. The real-VS-Code twin (host write + two editors) is test/vscode-e2e/reflow-toolbar.spec.ts.
 */

const DOC = 'First line\nsecond line\nthird line\n\nA new paragraph.\n'
const BTN = '.vditor-toolbar [data-type="reflow-line-breaks"]'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => undefined,
    })
  })
})

async function load(page: Page, query: string) {
  await page.goto(
    `/list.html?md=${encodeURIComponent(DOC)}&toolbar=1&mode=ir&${query}`,
  )
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.locator(BTN).waitFor()
}

const markers = (page: Page) => page.locator('.vmarkd-softbreak').count()
const posted = (page: Page) => page.evaluate(() => (window as any).__posted)
const pressed = async (page: Page) => ({
  cls: await page
    .locator(BTN)
    .evaluate((b) => b.classList.contains('vditor-menu--current')),
  aria: await page.locator(BTN).getAttribute('aria-pressed'),
})

test('NOT pressed at boot when reflow is on; click presses it (keep breaks), posts, turns reflow off', async ({
  page,
}) => {
  await load(page, 'reflow=1')
  await expect.poll(() => markers(page)).toBe(2)
  expect(await pressed(page)).toEqual({ cls: false, aria: 'false' })

  await page.locator(BTN).click()

  await expect.poll(() => markers(page)).toBe(0)
  expect(await pressed(page)).toEqual({ cls: true, aria: 'true' })
  expect(await posted(page)).toContainEqual({
    command: 'set-reflow-line-breaks',
    value: false,
  })

  await page.locator(BTN).click()
  await expect.poll(() => markers(page)).toBe(2)
  expect(await pressed(page)).toEqual({ cls: false, aria: 'false' })
  expect((await posted(page)).at(-1)).toEqual({
    command: 'set-reflow-line-breaks',
    value: true,
  })
})

test('pressed at boot when the setting is off (line breaks kept)', async ({
  page,
}) => {
  await load(page, 'reflow=0')
  expect(await pressed(page)).toEqual({ cls: true, aria: 'true' })
  expect(await markers(page)).toBe(0)
})

test('a change arriving from the host side (VS Code Settings) moves the button', async ({
  page,
}) => {
  await load(page, 'reflow=1')
  await page.evaluate(() => (window as any).__applyReflowLineBreaks(false))
  expect(await pressed(page)).toEqual({ cls: true, aria: 'true' })
  await page.evaluate(() => (window as any).__applyReflowLineBreaks(true))
  expect(await pressed(page)).toEqual({ cls: false, aria: 'false' })
  // Host-originated changes never echo back a write.
  expect(await posted(page)).toEqual([])
})

test('the host echo of a click does not toggle it back or re-post', async ({
  page,
}) => {
  await load(page, 'reflow=1')
  await page.locator(BTN).click()
  await page.evaluate(() => (window as any).__applyReflowLineBreaks(false)) // config-changed echo
  expect(await pressed(page)).toEqual({ cls: true, aria: 'true' })
  expect(await posted(page)).toHaveLength(1)
})

test('keyboard: the button is focusable and Enter activates it', async ({
  page,
}) => {
  await load(page, 'reflow=1')
  await page.locator(BTN).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => markers(page)).toBe(0)
  expect(await pressed(page)).toEqual({ cls: true, aria: 'true' })
})
