import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for wiki-link click behavior: modifier policy (Ctrl+click vs plain click)
// in IR mode and preview mode.

async function gotoWiki(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/wiki.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function chip(page: Page, target: string) {
  return page.locator(`.wiki-link-chip[data-wiki-target="${target}"]`)
}

async function posted(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__posted)
}

async function clearPosted(page: Page) {
  await page.evaluate(() => ((window as any).__posted = []))
}

test.describe('IR mode — modifier policy (default: Ctrl+click to navigate)', () => {
  test('plain click on wiki chip does NOT navigate (no open-wikilink message)', async ({
    page,
  }) => {
    await gotoWiki(page)
    await clearPosted(page)
    await chip(page, 'Home').click()
    const msgs = await posted(page)
    const wikiMsgs = msgs.filter((m) => m.command === 'open-wikilink')
    expect(wikiMsgs).toHaveLength(0)
  })

  test('plain click on wiki chip lets Vditor place the caret (chip is in contenteditable)', async ({
    page,
  }) => {
    await gotoWiki(page)
    const homeChip = chip(page, 'Home')
    await homeChip.click()
    // After click, selection should be near or inside the chip's parent block.
    const caretInEditor = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return false
      const editor = document.querySelector('.vditor-ir .vditor-reset')
      return editor?.contains(sel.anchorNode) ?? false
    })
    expect(caretInEditor).toBe(true)
  })

  test('Ctrl+click on wiki chip navigates (posts open-wikilink)', async ({
    page,
  }) => {
    await gotoWiki(page)
    await clearPosted(page)
    await chip(page, 'Home').click({ modifiers: ['Control'] })
    const msgs = await posted(page)
    const wikiMsgs = msgs.filter((m) => m.command === 'open-wikilink')
    expect(wikiMsgs).toHaveLength(1)
    expect(wikiMsgs[0].target).toBe('Home')
  })

  test('Ctrl+click on missing chip also navigates (triggers create flow)', async ({
    page,
  }) => {
    await gotoWiki(page)
    await clearPosted(page)
    await chip(page, 'Missing Page').click({ modifiers: ['Control'] })
    const msgs = await posted(page)
    const wikiMsgs = msgs.filter((m) => m.command === 'open-wikilink')
    expect(wikiMsgs).toHaveLength(1)
    expect(wikiMsgs[0].target).toBe('Missing Page')
  })
})

test.describe('Delete/Backspace removes wiki chips', () => {
  test('Backspace after a wiki chip removes it', async ({ page }) => {
    await gotoWiki(page)
    await expect(chip(page, 'Home')).toBeVisible()

    // Place caret right after the Home chip
    await page.evaluate(() => {
      const c = document.querySelector('[data-wiki-target="Home"]')!
      const range = document.createRange()
      const next = c.nextSibling
      if (next) {
        range.setStart(next, 0)
      } else {
        range.setStartAfter(c)
      }
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })

    await page.keyboard.press('Backspace')
    await expect(chip(page, 'Home')).toHaveCount(0)
  })

  test('Delete before a wiki chip removes it', async ({ page }) => {
    await gotoWiki(page)
    await expect(chip(page, 'Home')).toBeVisible()

    // Place caret right before the Home chip
    await page.evaluate(() => {
      const c = document.querySelector('[data-wiki-target="Home"]')!
      const range = document.createRange()
      const prev = c.previousSibling
      if (prev && prev.nodeType === 3) {
        range.setStart(prev, prev.textContent!.length)
      } else {
        range.setStartBefore(c)
      }
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })

    await page.keyboard.press('Delete')
    await expect(chip(page, 'Home')).toHaveCount(0)
  })
})

test.describe('Preview mode — plain click navigates (no modifier needed)', () => {
  async function switchToPreview(page: Page) {
    await page.click('[data-type="preview"]')
    await page.waitForSelector('.vditor-preview', { state: 'visible' })
    // Wait for preview to render wiki chips (Md2HTML runs async).
    await page.waitForFunction(
      () =>
        document.querySelector(
          '.vditor-preview .wiki-link-chip[data-wiki-target="Home"]',
        ) !== null,
    )
  }

  test('plain click on wiki chip in preview navigates without Ctrl', async ({
    page,
  }) => {
    await gotoWiki(page)
    await switchToPreview(page)
    await clearPosted(page)
    await page
      .locator('.vditor-preview .wiki-link-chip[data-wiki-target="Home"]')
      .click()
    const msgs = await posted(page)
    const wikiMsgs = msgs.filter((m) => m.command === 'open-wikilink')
    expect(wikiMsgs).toHaveLength(1)
    expect(wikiMsgs[0].target).toBe('Home')
  })

  test('plain click on missing chip in preview also navigates', async ({
    page,
  }) => {
    await gotoWiki(page)
    await switchToPreview(page)
    await clearPosted(page)
    await page
      .locator(
        '.vditor-preview .wiki-link-chip[data-wiki-target="Missing Page"]',
      )
      .click()
    const msgs = await posted(page)
    const wikiMsgs = msgs.filter((m) => m.command === 'open-wikilink')
    expect(wikiMsgs).toHaveLength(1)
    expect(wikiMsgs[0].target).toBe('Missing Page')
  })
})
