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
