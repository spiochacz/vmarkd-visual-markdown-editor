import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e for WYSIWYG live code highlighting (full-fidelity hljs spans). Guards: (1) editing a code
 * block puts real `hljs-*` token spans in the editable source (so the theme styles them with full
 * fidelity — colour + bold + italic — like the preview); (2) the rendered preview is hidden while
 * editing (single section); (3) typing — including in the MIDDLE — leaves getValue() byte-clean
 * despite the spans (the Lute-flatten guard + caret restore); (4) the spans clear when the caret
 * leaves. The painted PIXELS / bold-italic are verified manually in the real webview; here we assert
 * the machinery (span DOM + serialisation + caret), which is environment-stable.
 */
async function goto(page: Page) {
  await page.goto('/wysiwyg-highlight.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // hljs is eager-loaded; wait until it's usable before driving the code block.
  await page.waitForFunction(
    () => typeof (window as any).hljs?.highlight === 'function',
    undefined,
    { timeout: 10000 },
  )
}

// Click into the first code block so Vditor reveals its editable source and the caret lands in it.
async function focusCodeBlock(page: Page) {
  await page
    .locator('.vditor-wysiwyg__block[data-type="code-block"]')
    .first()
    .click()
  await page.waitForFunction(() => {
    const pre = document.querySelector(
      '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre',
    ) as HTMLElement | null
    return !!pre && getComputedStyle(pre).display !== 'none'
  })
}

const tokenClasses = (page: Page) =>
  page.evaluate(() => (window as any).__sourceTokenClasses() as string[])
const value = (page: Page) =>
  page.evaluate(() => (window as any).__getValue() as string)
const waitTokens = (page: Page) =>
  page.waitForFunction(
    () => (window as any).__sourceTokenClasses().length > 0,
    undefined,
    { timeout: 5000 },
  )

test.describe('WYSIWYG live code highlighting', () => {
  test('editing a code block puts hljs token spans in the editable source', async ({
    page,
  }) => {
    await goto(page)
    await focusCodeBlock(page)
    await waitTokens(page)
    const classes = await tokenClasses(page)
    // `const` → keyword, `1` → number (real hljs classes → theme styles them like the preview).
    expect(classes).toContain('hljs-keyword')
    expect(classes).toContain('hljs-number')
  })

  test('editing shows ONLY the source — the rendered preview is hidden (single section)', async ({
    page,
  }) => {
    await goto(page)
    await focusCodeBlock(page)
    const displays = await page.evaluate(() => {
      const block = document.querySelector(
        '.vditor-wysiwyg__block[data-type="code-block"]',
      ) as HTMLElement
      const src = block.querySelector('pre.vditor-wysiwyg__pre') as HTMLElement
      const pv = block.querySelector(
        'pre.vditor-wysiwyg__preview',
      ) as HTMLElement
      return {
        src: getComputedStyle(src).display,
        preview: getComputedStyle(pv).display,
      }
    })
    expect(displays.src).toBe('block')
    expect(displays.preview).toBe('none')
  })

  test('typing at the end keeps getValue() byte-clean despite the spans', async ({
    page,
  }) => {
    await goto(page)
    await focusCodeBlock(page)
    await waitTokens(page)
    // Source is reparsed by Lute each keystroke; corruption (truncated/mangled) shows up here.
    await page.keyboard.press('End')
    await page.keyboard.type('23')
    const md = await value(page)
    expect(md).toContain('```js\nconst a = 123\n```')
    expect(md.match(/```/g)?.length).toBe(2)
  })

  test('typing in the MIDDLE inserts at the caret (caret survives re-highlight)', async ({
    page,
  }) => {
    await goto(page)
    await focusCodeBlock(page)
    await waitTokens(page)
    // Place the caret right after `const` (offset 5), then type — if the re-highlight reset the
    // caret to the start/end, the inserted text would land in the wrong place.
    await page.evaluate(() => {
      const code = (window as any).__codeSource() as HTMLElement
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      const first = walker.nextNode() as Text // `const` lives in the first token text node
      const r = document.createRange()
      r.setStart(first, Math.min(5, first.length))
      r.collapse(true)
      const sel = getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    })
    await page.keyboard.type('X')
    const md = await value(page)
    expect(md).toContain('```js\nconstX a = 1\n```')
  })

  test('spans clear when the caret leaves the code block', async ({ page }) => {
    await goto(page)
    await focusCodeBlock(page)
    await waitTokens(page)
    await page.locator('p', { hasText: 'text after' }).first().click()
    await page.waitForFunction(
      () => (window as any).__sourceTokenClasses().length === 0,
      undefined,
      { timeout: 5000 },
    )
    expect(await tokenClasses(page)).toHaveLength(0)
  })
})
