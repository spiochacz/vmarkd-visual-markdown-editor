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

test.describe('IR mode — plain click expands [[…]] markers', () => {
  test('plain click on chip adds the expanded class with [[…]] markers', async ({
    page,
  }) => {
    await gotoWiki(page)
    const home = chip(page, 'Home')
    await home.click()
    await expect(home).toHaveClass(/wiki-link-chip--expanded/)
  })

  test('clicking elsewhere collapses the expanded markers', async ({
    page,
  }) => {
    await gotoWiki(page)
    const home = chip(page, 'Home')
    await home.click()
    await expect(home).toHaveClass(/wiki-link-chip--expanded/)
    // Click on the editor body (not a chip)
    await page.click('.vditor-ir .vditor-reset')
    await expect(home).not.toHaveClass(/wiki-link-chip--expanded/)
  })

  test('clicking a different chip collapses the previous one', async ({
    page,
  }) => {
    await gotoWiki(page)
    const home = chip(page, 'Home')
    const missing = chip(page, 'Missing Page')
    await home.click()
    await expect(home).toHaveClass(/wiki-link-chip--expanded/)
    await missing.click()
    await expect(home).not.toHaveClass(/wiki-link-chip--expanded/)
    await expect(missing).toHaveClass(/wiki-link-chip--expanded/)
  })

  test('expanded chip shows [[ and ]] pseudo-elements', async ({ page }) => {
    await gotoWiki(page)
    await chip(page, 'Home').click()
    const before = await page.evaluate(() => {
      const el = document.querySelector('.wiki-link-chip--expanded')
      return el ? getComputedStyle(el, '::before').content : ''
    })
    const after = await page.evaluate(() => {
      const el = document.querySelector('.wiki-link-chip--expanded')
      return el ? getComputedStyle(el, '::after').content : ''
    })
    expect(before).toBe('"[["')
    expect(after).toBe('"]]"')
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

  test('Backspace with caret just past the chip ZWSP still removes it', async ({
    page,
  }) => {
    await gotoWiki(page)
    await expect(chip(page, 'Home')).toBeVisible()
    // The chip is followed by a zero-width space (then the rest of the line as one
    // text node). Put the caret right AFTER that ZWSP — where it lands when you
    // click immediately past a link — which the old handler ignored.
    const placed = await page.evaluate(() => {
      const c = document.querySelector('[data-wiki-target="Home"]')!
      const next = c.nextSibling
      if (!next || next.nodeType !== 3) return false
      if (!(next.textContent ?? '').startsWith('\u200B')) return false
      const range = document.createRange()
      range.setStart(next, 1) // just past the ZWSP
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      return true
    })
    expect(placed).toBe(true) // confirms a ZWSP follows the chip
    await page.keyboard.press('Backspace')
    await expect(chip(page, 'Home')).toHaveCount(0)
  })

  test('Backspace with caret INSIDE a chip removes it', async ({ page }) => {
    await gotoWiki(page)
    await expect(chip(page, 'Home')).toBeVisible()
    await page.evaluate(() => {
      const c = document.querySelector('[data-wiki-target="Home"]')!
      const t = c.firstChild! // the chip's text node ("Home")
      const range = document.createRange()
      range.setStart(t, (t.textContent ?? '').length)
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await expect(chip(page, 'Home')).toHaveCount(0)
  })

  test('removing a chip via Backspace drops it from getValue()', async ({
    page,
  }) => {
    await gotoWiki(page)
    const before = await page.evaluate(() => (window as any).vditor.getValue())
    expect(before).toContain('[[Home]]')
    await page.evaluate(() => {
      const c = document.querySelector('[data-wiki-target="Home"]')!
      const next = c.nextSibling!
      const range = document.createRange()
      range.setStart(next, 1) // just past the ZWSP
      range.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => (window as any).vditor.getValue())
    expect(after).not.toContain('[[Home]]')
    // the rest of the document survives
    expect(after).toContain('[[Missing Page]]')
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
