import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

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

function hintButtons(page: Page) {
  return page.locator('.vditor-hint button')
}

function chip(page: Page, target: string) {
  return page.locator(
    `.vditor-ir .wiki-link-chip[data-wiki-target="${target}"]`,
  )
}

async function focusAtEnd(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.vditor-ir .vditor-reset') as HTMLElement
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  })
}

async function typeInEditor(page: Page, text: string) {
  await focusAtEnd(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await page.keyboard.type(text, { delay: 50 })
}

async function waitForHint(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.vditor-hint')
      return (
        el instanceof HTMLElement &&
        el.style.display === 'block' &&
        el.querySelectorAll('button').length > 0
      )
    },
    { timeout: 3000 },
  )
}

async function hintIsHidden(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.vditor-hint') as HTMLElement | null
    return !el || el.style.display !== 'block'
  })
}

test.describe('Wiki hint — dropdown appearance', () => {
  test('[[ triggers the autocomplete dropdown', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[')
    await waitForHint(page)
    const count = await hintButtons(page).count()
    expect(count).toBeGreaterThan(0)
  })

  test('single [ does NOT trigger autocomplete', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[')
    await page.waitForTimeout(400)
    expect(await hintIsHidden(page)).toBe(true)
  })

  test('[[ shows all known pages when no filter text', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[')
    await waitForHint(page)
    const labels = await hintButtons(page).allInnerTexts()
    expect(labels.length).toBeGreaterThanOrEqual(3)
  })

  test('[[ with filter narrows the list', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    const labels = await hintButtons(page).allInnerTexts()
    expect(labels.some((l) => l.includes('Home'))).toBe(true)
    expect(labels.some((l) => l.includes('Alpha'))).toBe(false)
  })

  test('filter is case-insensitive', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[ho')
    await waitForHint(page)
    const labels = await hintButtons(page).allInnerTexts()
    expect(labels.some((l) => l.includes('Home'))).toBe(true)
  })

  test('Escape closes the dropdown', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[')
    await waitForHint(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    expect(await hintIsHidden(page)).toBe(true)
  })

  test('non-matching filter shows no dropdown', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[zzzzz')
    await page.waitForTimeout(400)
    expect(await hintIsHidden(page)).toBe(true)
  })
})

test.describe('Wiki hint — selection and insertion', () => {
  test('Enter selects hint and inserts a chip', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    // After IR reprocessing the chip should appear
    const chipCount = await chip(page, 'Home').count()
    expect(chipCount).toBeGreaterThanOrEqual(1)
  })

  test('inserted chip preserves original case of page name', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[getting')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    // Check that a "Getting Started" chip exists (case preserved from knownPages)
    const found = await page.evaluate(() =>
      Boolean(
        document.querySelector(
          '.wiki-link-chip[data-wiki-target="Getting Started"]',
        ),
      ),
    )
    expect(found).toBe(true)
  })

  test('cursor lands outside the chip — typing does not extend it', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    // Type something after the chip
    await page.keyboard.type('xyz', { delay: 30 })
    await page.waitForTimeout(300)
    // The last Home chip should still say "Home"
    const chipText = await page.evaluate(() => {
      const chips = document.querySelectorAll(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Home"]',
      )
      const last = chips[chips.length - 1]
      return last?.textContent
    })
    expect(chipText).toBe('Home')
  })

  test('click on hint item inserts the chip', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Al')
    await waitForHint(page)
    const btn = hintButtons(page).first()
    await btn.click()
    await page.waitForTimeout(300)
    const chipCount = await chip(page, 'Alpha').count()
    expect(chipCount).toBeGreaterThanOrEqual(1)
  })

  test('dropdown closes after chip is inserted', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    expect(await hintIsHidden(page)).toBe(true)
  })

  test('inserted chip round-trips through getValue()', async ({ page }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Al')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    expect(md).toContain('[[Alpha]]')
  })

  test('selected existing-page chip stays NOT-missing right after insert', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const missing = await page.evaluate(() => {
      const chips = document.querySelectorAll(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Home"]',
      )
      const last = chips[chips.length - 1]
      return last?.hasAttribute('data-wiki-missing')
    })
    expect(missing).toBe(false)
  })

  test('selected chip stays NOT-missing after typing a non-space char', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    // Type a non-space char to trigger IR reprocessing
    await page.keyboard.type('x', { delay: 50 })
    await page.waitForTimeout(400)
    const missing = await page.evaluate(() => {
      const chips = document.querySelectorAll(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Home"]',
      )
      const last = chips[chips.length - 1]
      return last?.hasAttribute('data-wiki-missing')
    })
    expect(missing).toBe(false)
  })

  test('selecting a second link keeps the first chip NOT-missing', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Ho')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await page.keyboard.type(' [[Al', { delay: 50 })
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    const state = await page.evaluate(() => {
      const home = document.querySelector(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Home"]',
      )
      const alpha = document.querySelector(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Alpha"]',
      )
      return {
        homeMissing: home?.hasAttribute('data-wiki-missing') ?? null,
        alphaMissing: alpha?.hasAttribute('data-wiki-missing') ?? null,
      }
    })
    expect(state.homeMissing).toBe(false)
    expect(state.alphaMissing).toBe(false)
  })
})

test.describe('Wiki hint — path-qualified names (duplicate basenames)', () => {
  test('hint offers a path-qualified entry for an ambiguous basename', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[sub/De')
    await waitForHint(page)
    const labels = await hintButtons(page).allInnerTexts()
    expect(labels.some((l) => l.includes('sub/Deep Page'))).toBe(true)
  })

  test('selecting a path-qualified entry inserts [[sub/Deep Page]] and resolves (not missing)', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[sub/De')
    await waitForHint(page)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    const chip = page.locator(
      '.vditor-ir .wiki-link-chip[data-wiki-target="sub/Deep Page"]',
    )
    await expect(chip).toHaveCount(1)
    // The relative-path key is known → chip must NOT be flagged missing.
    expect(await chip.first().getAttribute('data-wiki-missing')).toBeNull()
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    expect(md).toContain('[[sub/Deep Page]]')
  })
})

test.describe('Wiki hint — caret at chip boundary', () => {
  test('caret inside a trailing chip: typing does not garble or jump to line start', async ({
    page,
  }) => {
    await gotoWiki(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue('intro [[Alpha]] [[Beta]]')
    })
    await page.waitForTimeout(400)
    // Force the caret INSIDE the trailing chip's text node — reproduces a click
    // at the end of a line resolving the caret into the last chip.
    await page.evaluate(() => {
      const chip = document.querySelector(
        '.vditor-ir .wiki-link-chip[data-wiki-target="Beta"]',
      )
      const t = chip?.firstChild
      if (!t) throw new Error('no Beta chip')
      const r = document.createRange()
      r.setStart(t, (t.textContent || '').length)
      r.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    })
    // First keystroke is absorbed by the chip (caret moves out, after the link);
    // the rest lands after it. The bug was: caret jumped to the line START.
    await page.keyboard.type('  END', { delay: 50 })
    await page.waitForTimeout(400)
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    // Not reordered / not jumped: content order preserved.
    expect(md.trimStart().startsWith('intro [[Alpha]] [[Beta]]')).toBe(true)
    // Trailing text landed AFTER the last link, not at the start of the line.
    expect(md.indexOf('END')).toBeGreaterThan(md.indexOf('[[Beta]]'))
  })
})

test.describe('Wiki hint — manual typing (no autocomplete)', () => {
  test('manually typed [[Page]] becomes a chip after cursor moves', async ({
    page,
  }) => {
    await gotoWiki(page)
    await typeInEditor(page, '[[Home]]')
    // Dismiss hint if it appeared
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    // Press space to trigger IR reprocessing
    await page.keyboard.type(' ', { delay: 50 })
    await page.waitForTimeout(300)
    const chipCount = await chip(page, 'Home').count()
    expect(chipCount).toBeGreaterThanOrEqual(1)
  })

  test('two links typed back-to-back: [[A]] [[B]]', async ({ page }) => {
    await gotoWiki(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue('start\n')
    })
    await page.waitForTimeout(300)
    await focusAtEnd(page)
    await page.keyboard.type('[[Alpha]] [[Beta]]', { delay: 50 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.keyboard.type(' ', { delay: 50 })
    await page.waitForTimeout(500)
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    expect(md).toContain('[[Alpha]]')
    expect(md).toContain('[[Beta]]')
  })

  test('typing [[X]] without space before still produces a link', async ({
    page,
  }) => {
    await gotoWiki(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue('start\n')
    })
    await page.waitForTimeout(300)
    await focusAtEnd(page)
    await page.keyboard.type('word[[Home]]', { delay: 50 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.keyboard.type(' ', { delay: 50 })
    await page.waitForTimeout(300)
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    expect(md).toContain('[[Home]]')
  })

  test('two links typed back-to-back serialize correctly', async ({ page }) => {
    await gotoWiki(page)
    // Clear editor and type fresh content
    await page.evaluate(() => {
      ;(window as any).vditor.setValue('test\n')
    })
    await page.waitForTimeout(300)
    await focusAtEnd(page)
    // Type first link, dismiss hint
    await page.keyboard.type('[[Alpha]]', { delay: 50 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // Type space + second link
    await page.keyboard.type(' [[Beta]]', { delay: 50 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    // Type trailing space to trigger final reprocessing
    await page.keyboard.type(' ', { delay: 50 })
    await page.waitForTimeout(500)
    const md = await page.evaluate(() => (window as any).vditor.getValue())
    expect(md).toContain('[[Alpha]]')
    expect(md).toContain('[[Beta]]')
  })
})
