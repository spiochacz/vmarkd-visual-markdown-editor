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

  test('two adjacent code blocks keep a gap while editing one (do not merge)', async ({
    page,
  }) => {
    await goto(page)
    // Two code blocks stacked; edit the first. Vditor gives the shown source pre a negative
    // margin-bottom (to overlap the now-hidden preview) which would pull the next block up to a
    // 0 gap → the two panels merge. Assert they stay separated.
    await page.evaluate(() => {
      ;(window as any).vditor.setValue(
        '```js\nconst a = 1\n```\n\n```js\nconst b = 2\n```\n\nend\n',
      )
    })
    await page
      .locator('.vditor-wysiwyg__block[data-type="code-block"]')
      .first()
      .click()
    await waitTokens(page)
    const gap = await page.evaluate(() => {
      const blocks = [
        ...document.querySelectorAll(
          '.vditor-wysiwyg__block[data-type="code-block"]',
        ),
      ] as HTMLElement[]
      return Math.round(
        blocks[1].getBoundingClientRect().top -
          blocks[0].getBoundingClientRect().bottom,
      )
    })
    expect(gap).toBeGreaterThan(4)
  })

  test('after a keystroke (block rebuild) the preview stays hidden + gap holds', async ({
    page,
  }) => {
    await goto(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue(
        '```js\nconst a = 1\n```\n\n```js\nconst b = 2\n```\n\nend\n',
      )
    })
    await page
      .locator('.vditor-wysiwyg__block[data-type="code-block"]')
      .first()
      .click()
    await waitTokens(page)
    // Typing reparses the block; Vditor's `input()` rebuild DROPS the source's inline
    // `display: block`, so a rule keyed on that string would stop matching → the rendered preview
    // reappears ("second block below") and the negative margin re-merges the blocks. Guard both.
    await page.keyboard.type('z')
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const blocks = [
        ...document.querySelectorAll(
          '.vditor-wysiwyg__block[data-type="code-block"]',
        ),
      ] as HTMLElement[]
      return {
        blockCount: blocks.length,
        previewDisplay: getComputedStyle(
          blocks[0].querySelector('pre.vditor-wysiwyg__preview') as HTMLElement,
        ).display,
        gap: Math.round(
          blocks[1].getBoundingClientRect().top -
            blocks[0].getBoundingClientRect().bottom,
        ),
      }
    })
    expect(r.blockCount).toBe(2)
    expect(r.previewDisplay).toBe('none')
    expect(r.gap).toBeGreaterThan(4)
  })

  test('ALL code sources are highlighted (incl. non-focused) so switching never flashes', async ({
    page,
  }) => {
    await goto(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue(
        '```js\nconst a = 1\n```\n\n```js\nconst b = 2\n```\n\nend\n',
      )
    })
    // Edit the FIRST block; the SECOND stays unfocused (its source hidden) but must ALREADY carry
    // token spans, so revealing it later shows full colour immediately — no monochrome (near-white)
    // frame before the spans land (the reported "white font when switching" flash).
    await page
      .locator('.vditor-wysiwyg__block[data-type="code-block"]')
      .first()
      .click()
    await waitTokens(page)
    const secondSpanCount = await page.evaluate(() => {
      const blocks = [
        ...document.querySelectorAll(
          '.vditor-wysiwyg__block[data-type="code-block"]',
        ),
      ]
      const code = blocks[1].querySelector('pre.vditor-wysiwyg__pre > code')
      return code?.querySelectorAll('span[class^="hljs-"]').length ?? 0
    })
    expect(secondSpanCount).toBeGreaterThan(0)
  })

  test('clicking a specific line in a rendered code block lands the caret there (not at start)', async ({
    page,
  }) => {
    await goto(page)
    await page.evaluate(() => {
      ;(window as any).vditor.setValue(
        '```js\nfunction f() {\n  const x = 1\n  return x\n}\n```\n\nend\n',
      )
    })
    await page.waitForTimeout(400)
    // Click the rendered `return` (line 4). Vditor's showCode would collapse the caret to the block
    // start; the wysiwyg/index.ts patch (caretRangeFromPoint) should land it at the clicked word.
    await page
      .locator(
        '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__preview',
      )
      .getByText('return', { exact: false })
      .click()
    await page.waitForTimeout(300)
    const offset = await page.evaluate(() => {
      const code = document.querySelector(
        '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre > code',
      ) as HTMLElement
      const sel = getSelection()
      if (!sel || sel.rangeCount === 0 || !code.contains(sel.anchorNode))
        return -1
      const r = document.createRange()
      r.setStart(code, 0)
      r.setEnd(sel.anchorNode!, sel.anchorOffset)
      return r.toString().length
    })
    // `return` starts ~31 chars into the source; landing at the block start would be ~0.
    expect(offset).toBeGreaterThan(15)
  })

  test('leaving a block keeps it highlighted AND getValue stays clean', async ({
    page,
  }) => {
    await goto(page)
    await focusCodeBlock(page)
    await waitTokens(page)
    // Move the caret out of the code block. We intentionally KEEP the block highlighted (so
    // returning to it is flash-free); the serialization must still be byte-clean despite the spans.
    await page.locator('p', { hasText: 'text after' }).first().click()
    await page.waitForTimeout(200)
    expect((await tokenClasses(page)).length).toBeGreaterThan(0)
    const md = await value(page)
    expect(md).toContain('```js\nconst a = 1\n```')
    expect(md.match(/```/g)?.length).toBe(2)
  })

  test('inline code keeps its horizontal padding (matches the render, not hugged)', async ({
    page,
  }) => {
    await goto(page)
    // Vditor's base rule pads inline code `.2em .4em` in every mode (render/IR/Preview), but a
    // WYSIWYG-only `!important` rule in Vditor zeroes the horizontal half → editing showed the
    // code hugging the text ("inny margines przed/po tekście"). main.css re-asserts `.4em`.
    await page.evaluate(() => {
      ;(window as any).vditor.setValue('text `inline code` more text\n')
    })
    const pad = await page.evaluate(() => {
      const el = document.querySelector(
        '.vditor-wysiwyg code[data-marker="`"]',
      ) as HTMLElement
      const cs = getComputedStyle(el)
      return {
        top: parseFloat(cs.paddingTop),
        left: parseFloat(cs.paddingLeft),
        right: parseFloat(cs.paddingRight),
      }
    })
    // Horizontal restored, symmetric, and = 2× the vertical (`.4em` vs `.2em`) — the render's ratio.
    expect(pad.left).toBeGreaterThan(0)
    expect(pad.left).toBeCloseTo(pad.right, 1)
    expect(pad.left).toBeCloseTo(pad.top * 2, 0)
  })
})
