import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for the `vmarkd.editor.codeLineNumbers` setting. The setting must GOVERN the
// rendered line-number gutter in code blocks — on AND off. The reported bug: line
// numbers were "always there" and the setting couldn't turn them off, because the
// webview persists the whole Vditor `preview` object (saveVditorOptions) so a saved
// `preview.hljs.lineNumber: true` (from a session where the setting was on) was
// spread back into the init options and the old buildVditorOptions only ever set
// lineNumber:true — never false — so the saved value pinned it on forever.
//
// The harness drives the REAL buildVditorOptions via query params:
//   ?setting=1|0  -> the live codeLineNumbers setting
//   ?saved=1      -> a stale saved preview.hljs.lineNumber:true blob
//   ?mode=ir|wysiwyg  -> editor mode

async function goto(page: Page, query: string) {
  await page.goto(`/code-linenumber.html${query}`)
  await page.waitForFunction(() => (window as any).__ready === true)
  // highlightRender adds `code.hljs` BEFORE the lineNumber branch, so this is a
  // reliable "code highlighting finished" signal in both the on and off cases —
  // letting the off case assert the gutter is genuinely absent (not just unrendered).
  await page.waitForSelector('code.hljs')
}

function gutters(page: Page) {
  return page.locator('.vditor-linenumber__rows')
}

test.describe('codeLineNumbers setting governs the gutter (IR mode)', () => {
  test('setting ON renders a line-number gutter', async ({ page }) => {
    await goto(page, '?mode=ir&setting=1')
    expect(
      await page.evaluate(() => (window as any).__effectiveLineNumber),
    ).toBe(true)
    await expect(gutters(page)).toHaveCount(1)
  })

  test('setting OFF renders NO line-number gutter', async ({ page }) => {
    await goto(page, '?mode=ir&setting=0')
    expect(
      await page.evaluate(() => (window as any).__effectiveLineNumber),
    ).toBe(false)
    await expect(gutters(page)).toHaveCount(0)
  })

  test('setting OFF wins over a stale saved lineNumber:true (the bug)', async ({
    page,
  }) => {
    // A previous session saved preview.hljs.lineNumber:true; the setting is now OFF.
    // The current setting must win — no gutter.
    await goto(page, '?mode=ir&setting=0&saved=1')
    expect(
      await page.evaluate(() => (window as any).__effectiveLineNumber),
    ).toBe(false)
    await expect(gutters(page)).toHaveCount(0)
  })

  test('setting ON still renders the gutter when saved blob agrees', async ({
    page,
  }) => {
    await goto(page, '?mode=ir&setting=1&saved=1')
    expect(
      await page.evaluate(() => (window as any).__effectiveLineNumber),
    ).toBe(true)
    await expect(gutters(page)).toHaveCount(1)
  })

  // Regression for the IR edit-surface SHIFT (this branch): with line numbers on, the
  // RENDER reserves a 4em gutter for the digits, but the editable SOURCE did not — so
  // the code you type sat ~4em left of the same code rendered, "jumping" on caret
  // enter/leave. main.css now gives the source `code` the same 4em gutter
  // (`.vditor-ir__node:has(> pre.vditor-ir__preview > code.vditor-linenumber) >
  // pre.vditor-ir__marker--pre > code { padding-left: 4em }`). Assert the gutter is
  // reserved on the source when on, and absent when off — ratio to font-size, so it's
  // stable across machine fonts (4em → ratio ≈ 4).
  function sourcePadRatio(page: Page) {
    return page.evaluate(() => {
      const code = document.querySelector(
        '.vditor-ir__node[data-type="code-block"] pre.vditor-ir__marker--pre > code',
      ) as HTMLElement
      const cs = getComputedStyle(code)
      return parseFloat(cs.paddingLeft) / parseFloat(cs.fontSize)
    })
  }

  test('line numbers ON reserve a 4em gutter on the editable source (aligns with the render)', async ({
    page,
  }) => {
    await goto(page, '?mode=ir&setting=1')
    expect(await sourcePadRatio(page)).toBeCloseTo(4, 0)
  })

  test('line numbers OFF leave the editable source with no gutter', async ({
    page,
  }) => {
    await goto(page, '?mode=ir&setting=0')
    expect(await sourcePadRatio(page)).toBeLessThan(1)
  })
})

test.describe('codeLineNumbers setting governs the gutter (WYSIWYG mode)', () => {
  test('setting ON renders a gutter in wysiwyg', async ({ page }) => {
    await goto(page, '?mode=wysiwyg&setting=1')
    await expect(gutters(page)).toHaveCount(1)
  })

  test('setting OFF + stale saved value still renders no gutter in wysiwyg', async ({
    page,
  }) => {
    await goto(page, '?mode=wysiwyg&setting=0&saved=1')
    await expect(gutters(page)).toHaveCount(0)
  })
})

// The `codeTheme` setting resolves to the highlight.js style (codeHljsStyle) and
// must, like lineNumber, be authoritative over a stale saved `preview.hljs.style`.
// At init main.ts force-applies it through setTheme too, but the constructor option
// must still be correct so the first paint isn't a wrong-theme flash. Asserted at
// both the option level (__effectiveCodeStyle) and the installed hljs stylesheet.
test.describe('codeTheme setting governs the highlight style', () => {
  test('explicit codeTheme installs that hljs stylesheet', async ({ page }) => {
    await goto(page, '?mode=ir&codeTheme=monokai')
    expect(
      await page.evaluate(() => (window as any).__effectiveCodeStyle),
    ).toBe('monokai')
    expect(await page.evaluate(() => (window as any).__hljsHref())).toContain(
      '/monokai.min.css',
    )
  })

  test('codeTheme auto follows the dark VS Code theme', async ({ page }) => {
    await goto(page, '?mode=ir&codeTheme=auto&theme=dark')
    expect(
      await page.evaluate(() => (window as any).__effectiveCodeStyle),
    ).toBe('github-dark')
  })

  test('codeTheme wins over a stale saved preview.hljs.style (the bug class)', async ({
    page,
  }) => {
    // A past session saved hljs.style:nord; the setting now resolves to monokai.
    // The setting must win — both the option and the installed stylesheet are monokai.
    await goto(page, '?mode=ir&codeTheme=monokai&savedStyle=nord')
    expect(
      await page.evaluate(() => (window as any).__effectiveCodeStyle),
    ).toBe('monokai')
    const href = await page.evaluate(() => (window as any).__hljsHref())
    expect(href).toContain('/monokai.min.css')
    expect(href).not.toContain('/nord.min.css')
  })
})

// Task 82: an `auto` codeTheme pairs with the markdown content theme so the code
// block colours match the surrounding palette (codeHljsStyle): material-dark →
// atom-one-dark, vscode-dark-2026 → vs2015, vscode-light-2026 → vs. Asserted at
// the option level AND the installed hljs stylesheet (the end of "code theme applied").
test.describe('an auto codeTheme follows the content theme (task 82)', () => {
  const cases: Array<[string, string]> = [
    ['github-light', 'github'],
    ['github-dark', 'github-dark'],
    ['material-dark', 'atom-one-dark'],
    ['vscode-dark-2026', 'vs2015'],
    ['vscode-light-2026', 'vs'],
  ]
  for (const [contentTheme, expected] of cases) {
    test(`${contentTheme} → ${expected}`, async ({ page }) => {
      await goto(page, `?mode=ir&codeTheme=auto&contentTheme=${contentTheme}`)
      expect(
        await page.evaluate(() => (window as any).__effectiveCodeStyle),
      ).toBe(expected)
      expect(await page.evaluate(() => (window as any).__hljsHref())).toContain(
        `/${expected}.min.css`,
      )
    })
  }

  test('an explicit codeTheme still wins over the content-theme pairing', async ({
    page,
  }) => {
    // codeTheme=monokai must beat material-dark's atom-one-dark pairing.
    await goto(page, '?mode=ir&codeTheme=monokai&contentTheme=material-dark')
    expect(
      await page.evaluate(() => (window as any).__effectiveCodeStyle),
    ).toBe('monokai')
  })
})
