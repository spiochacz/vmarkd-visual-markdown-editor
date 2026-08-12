import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// D11 (tasks/516, = 455's "config interaction pairs" open item) — settings that are only
// tested ONE AT A TIME today can still interact badly in combination. This spec asserts
// concrete GEOMETRY (computed widths/offsets), not screenshots, at the chromium-harness
// layer (task 450's lesson: parametrized boots here, not N real-VS-Code boots).
//
// Pair 1: editor.fullWidth x outline visible/hidden
//   — regression shape: the outline panel overlapping the reading column, or full-width
//     failing to actually widen the column once the outline eats space from the flex row.
// Pair 2: editor.fontSize x editor.codeLineNumbers
//   — regression shape: the line-number gutter (em-relative, main.css `.vditor-linenumber`)
//     not scaling with fontSize, so at a large font size the row-number column collides
//     with the code text, or at a small font size the reserved gutter is too wide.

const VIEWPORT = { width: 1300, height: 900 }
test.use({ viewport: VIEWPORT })

async function gotoPairs(page: Page, query: string) {
  await page.goto(`/config-pairs.html${query}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

const IR_CONTENT = '.vditor-ir pre.vditor-reset'
const OUTLINE = '.vditor-outline'

async function rect(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    return {
      left: r.left,
      right: r.right,
      // TEXT column width (border-box minus horizontal padding/gutter), matching
      // width.spec.ts's `measure()` — the 800px cap applies to the text column, not
      // the padded border-box, so raw r.width overcounts by the ~52px gutter.
      width: r.width - padL - padR,
      display: cs.display,
    }
  }, selector)
}

// Outline (right-docked) must sit strictly to the right of the reading column — no
// horizontal overlap between the panel and the editor content, in EITHER width mode.
// This is the exact "outline overlapping the reading column" regression shape.
async function assertNoOutlineOverlap(page: Page, content: { right: number }) {
  const ol = (await rect(page, OUTLINE))!
  expect(ol).not.toBeNull()
  expect(ol.display).not.toBe('none')
  expect(content.right).toBeLessThanOrEqual(ol.left + 1)
}

function assertColumnWidth(fullWidth: boolean, content: { width: number }) {
  if (fullWidth) {
    // Full width must actually widen the column past the 800px narrow cap, even with
    // the outline open eating 250px from the flex row — proves full-width isn't
    // computed against a stale (pre-outline) available width.
    expect(content.width).toBeGreaterThan(840)
  } else {
    // Narrow mode keeps ~800px regardless of outline state.
    expect(Math.abs(content.width - 800)).toBeLessThan(40)
  }
  // Never collapsed to a sliver — the "column width collapsing" regression shape.
  expect(content.width).toBeGreaterThan(200)
}

test.describe('fullWidth x outline', () => {
  for (const fullWidth of [false, true]) {
    for (const outline of [false, true]) {
      test(`fullWidth=${fullWidth} outline=${outline}: no overlap, sane column width`, async ({
        page,
      }) => {
        await gotoPairs(
          page,
          `?fullWidth=${fullWidth ? 1 : 0}&outline=${outline ? 1 : 0}`,
        )
        const content = (await rect(page, IR_CONTENT))!
        expect(content).not.toBeNull()

        if (outline) await assertNoOutlineOverlap(page, content)
        assertColumnWidth(fullWidth, content)
      })
    }
  }
})

async function gutterMeasure(page: Page) {
  return page.evaluate(() => {
    const code = document.querySelector(
      '.vditor-ir__preview code.hljs',
    ) as HTMLElement | null
    if (!code) return null
    const cs = getComputedStyle(code)
    const rows = document.querySelector(
      '.vditor-ir__preview .vditor-linenumber__rows',
    ) as HTMLElement | null
    const codeRect = code.getBoundingClientRect()
    return {
      paddingLeft: parseFloat(cs.paddingLeft) || 0,
      hasLineNumberClass: code.classList.contains('vditor-linenumber'),
      rowsRight: rows ? rows.getBoundingClientRect().right : null,
      codeLeft: codeRect.left,
    }
  })
}

test.describe('fontSize x codeLineNumbers', () => {
  for (const fontSize of [14, 32]) {
    test(`fontSize=${fontSize}: lineNumbers ON scales the gutter and never collides with code`, async ({
      page,
    }) => {
      await gotoPairs(page, `?fontSize=${fontSize}&lineNumbers=1`)
      expect(
        await page.evaluate(
          () => (window as any).__effectiveLineNumber === true,
        ),
      ).toBe(true)
      const m = (await gutterMeasure(page))!
      expect(m).not.toBeNull()
      expect(m.hasLineNumberClass).toBe(true)
      // The gutter (padding-left: 4em) is em-relative to the code element's own font
      // size, so it must scale with fontSize, not sit at a fixed px value.
      const expectedPadding = fontSize * 4
      expect(Math.abs(m.paddingLeft - expectedPadding)).toBeLessThan(
        expectedPadding * 0.25,
      )
      // The row-number column (3em wide, absolutely positioned at the code element's
      // left edge) must end strictly BEFORE the reserved 4em text gutter — else the
      // numbers collide with the wrapped code text at this font size.
      expect(m.rowsRight).not.toBeNull()
      expect(m.rowsRight!).toBeLessThanOrEqual(m.codeLeft + m.paddingLeft + 1)
    })

    test(`fontSize=${fontSize}: lineNumbers OFF reserves no gutter`, async ({
      page,
    }) => {
      await gotoPairs(page, `?fontSize=${fontSize}&lineNumbers=0`)
      expect(
        await page.evaluate(
          () => (window as any).__effectiveLineNumber === true,
        ),
      ).toBe(false)
      const m = (await gutterMeasure(page))!
      expect(m).not.toBeNull()
      expect(m.hasLineNumberClass).toBe(false)
      // No reserved 4em gutter when the setting is off, at either font size.
      expect(m.paddingLeft).toBeLessThan(fontSize * 4 * 0.5)
    })
  }
})
