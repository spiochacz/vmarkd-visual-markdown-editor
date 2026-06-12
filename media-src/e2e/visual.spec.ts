import { expect, test } from '@playwright/test'

// Golden screenshots — element-scoped visual regression for the surfaces whose bugs were
// historically PERCEPTUAL ("a few px", "jumps", "squished") and slipped past numeric guards.
// Baselines live in visual.spec.ts-snapshots/ (committed). A failing diff drops
// expected/actual/diff PNGs into test-results/ — read the diff image to see WHERE it moved.
// Regenerate ONLY after a deliberate visual change: `npx playwright test visual.spec.ts
// --update-snapshots` (never to silence an unexplained diff). Tolerance lives in
// playwright.config.ts (maxDiffPixelRatio) to absorb cross-machine anti-aliasing only.
//
// Keep goldens few and element-scoped: every golden is a maintenance contract, and
// full-page shots multiply font-rendering drift. Add one when a NEW visual bug class
// appears, scoped to the element that regressed.
//
// Tagged `@visual` and EXCLUDED from CI (`test:e2e` runs `--grep-invert @visual`): the
// baselines are generated on the dev machine, and golden screenshots only hold in a
// consistent environment — the ubuntu-latest runner's font set may differ from local.
// These are a LOCAL pre-flight ("did I move a pixel I didn't mean to?"), run with
// `npm run test:visual` (or just `test:e2e` locally). The numeric layout guards in
// blockbg/codenav/width specs are the cross-environment safety net that DOES gate CI.

test('collapsed code block — panel geometry and highlight chrome', {
  tag: '@visual',
}, async ({ page }) => {
  await page.goto('/blockbg.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // highlight.js settled (the un-highlighted→highlighted swap is itself a guarded
  // transition; the golden captures the FINAL state)
  await page.waitForFunction(
    () =>
      !!(window as any).__el().querySelector('.vditor-ir__preview code.hljs'),
    undefined,
    { timeout: 10000 },
  )
  // caret outside → collapsed (the state Edit↔Preview parity is judged in)
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges()
    ;(document.activeElement as HTMLElement)?.blur?.()
  })
  await page.evaluate(() => document.fonts.ready)
  const node = page
    .locator('.vditor-ir__node[data-type="code-block"]', {
      has: page.locator('code.language-js'),
    })
    .first()
  // Guards in one image: phantom height above/below the render, panel padding
  // (top/bottom symmetry), transparent inner code bg, no diagonal hatch.
  await expect(node).toHaveScreenshot('codeblock-collapsed.png')
})

test('rendered [!NOTE] callout — accent, icon, title row, body', {
  tag: '@visual',
}, async ({ page }) => {
  await page.goto('/callouts.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.evaluate(() => (window as any).__apply())
  await page.evaluate(() => document.fonts.ready)
  const note = page.locator('#note')
  await expect(note).toHaveAttribute('data-callout', 'note')
  await expect(note).toHaveScreenshot('callout-note.png')
})

// WYSIWYG live code highlighting (this branch): the EDITABLE source is coloured with
// real hljs token spans (full fidelity — colour + bold + italic) while editing, like
// the render. The numeric e2e (wysiwyg-highlight.spec) proves the span DOM + the
// serialisation; this golden guards the painted PIXELS (token colours, comment
// italic) the env-stable assertions can't see. caret:hide (Playwright default) keeps
// the blinking caret out of the shot.
async function focusWysiwygCode(
  page: import('@playwright/test').Page,
  md: string,
) {
  await page.goto('/wysiwyg-highlight.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForFunction(
    () => typeof (window as any).hljs?.highlight === 'function',
    undefined,
    { timeout: 10000 },
  )
  await page.evaluate((value) => (window as any).vditor.setValue(value), md)
  await page
    .locator('.vditor-wysiwyg__block[data-type="code-block"]')
    .first()
    .click()
  // spans present AND the hljs theme stylesheet (which paints them) has loaded
  await page.waitForFunction(
    () =>
      (window as any).__sourceTokenClasses().length > 0 &&
      !!document.getElementById('vditorHljsStyle'),
    undefined,
    { timeout: 5000 },
  )
  await page.evaluate(() => document.fonts.ready)
}

test('WYSIWYG code block — live syntax highlighting (colour + comment italic)', {
  tag: '@visual',
}, async ({ page }) => {
  await focusWysiwygCode(
    page,
    'intro\n\n```js\nfunction greet(name) {\n  // say hi\n  const msg = `Hello, ${name}!`\n  return msg.toUpperCase()\n}\n```\n\nend\n',
  )
  // The editable source pre (the coloured surface) — excludes the hover block-toolbar
  // that sits above it, so the golden is just the highlighted code.
  const source = page
    .locator(
      '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre',
    )
    .first()
  await expect(source).toHaveScreenshot('wysiwyg-code-highlighted.png')
})

// WYSIWYG inline code (this branch): Vditor zeroes inline-code horizontal padding in
// WYSIWYG only; main.css re-asserts `.4em` so the box matches the render. The numeric
// e2e checks the computed padding; this golden guards the actual box (breathing room
// left/right of the glyphs vs the text).
test('WYSIWYG inline code — horizontal padding box matches the render', {
  tag: '@visual',
}, async ({ page }) => {
  await page.goto('/wysiwyg-highlight.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.evaluate(() =>
    (window as any).vditor.setValue('text `inline code` after\n'),
  )
  await page.evaluate(() => document.fonts.ready)
  const code = page.locator('.vditor-wysiwyg code[data-marker="`"]').first()
  await expect(code).toHaveScreenshot('wysiwyg-inline-code.png')
})
