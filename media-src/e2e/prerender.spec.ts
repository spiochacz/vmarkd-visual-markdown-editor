import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// E2e for the host-side instant-paint overlay swap (task 50). prerender.html
// ships the host-style overlay; the real main.ts (loaded by prerender-harness)
// drives the init flow. We stub acquireVsCodeApi so `ready` is answered with an
// `init` message — exactly what the extension host posts on open.
const INIT = {
  command: 'update',
  type: 'init',
  content:
    '# Hello world\n\nA paragraph.\n\n```js\nconst x = 1\nconsole.log(x)\n```\n',
  cdn: '/vditor',
  options: {
    showToolbar: true,
    useVscodeThemeColor: true,
    enableFullWidth: true,
    showHeadingMarkers: true,
  },
  theme: 'dark',
  wiki: { enabled: false },
}

async function open(page: Page) {
  await page.addInitScript((init) => {
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => {
        if (m && m.command === 'ready') window.postMessage(init, '*')
      },
      getState: () => undefined,
      setState: () => {},
    })
  }, INIT)
  // domcontentloaded, not load: a held/slow Lute script would otherwise keep the
  // page in "loading" forever and stall goto. The overlay is in the initial HTML.
  await page.goto('/prerender.html', { waitUntil: 'domcontentloaded' })
}

test('the overlay is present on load (instant paint)', async ({ page }) => {
  // Block the live editor's Lute so the overlay can't have been swapped yet.
  await page.route('**/lute/lute.min.js', () => {})
  await open(page)
  await expect(page.locator('#vmarkd-prerender')).toHaveCount(1)
  await expect(page.locator('#vmarkd-prerender .vditor-reset h1')).toHaveText(
    /Hello world/,
  )
})

test('the overlay is swapped out once the live editor is ready (no hang)', async ({
  page,
}) => {
  await open(page)
  // after() removes the overlay AND the live editor mounts in #app.
  await page.waitForFunction(
    () =>
      !document.getElementById('vmarkd-prerender') &&
      !!document.querySelector('#app .vditor-ir pre.vditor-reset'),
    undefined,
    { timeout: 15_000 },
  )
  await expect(page.locator('#vmarkd-prerender')).toHaveCount(0)
  // the live editor carries the real, interactive toolbar (with icons)
  await expect(
    page.locator('#app .vditor-toolbar [data-type="bold"]'),
  ).toHaveCount(1)
})

test('the real toolbar is cloned into the overlay during the Lute wait', async ({
  page,
}) => {
  // Hold the live editor's Lute so the teaser window stays open, then assert the
  // overlay's empty bar was replaced with the real toolbar (showRealToolbarInOverlay).
  let release: (() => void) | undefined
  await page.route('**/lute/lute.min.js', async (route) => {
    await new Promise<void>((r) => {
      release = r
    })
    await route.continue()
  })
  await open(page)
  // the toolbar build doesn't need Lute, so the clone lands while Lute is held
  await page.waitForFunction(
    () => {
      const tb = document.querySelector('#vmarkd-prerender .vditor-toolbar')
      return !!tb && tb.querySelectorAll('svg').length > 0
    },
    undefined,
    { timeout: 15_000 },
  )
  const icons = await page
    .locator('#vmarkd-prerender .vditor-toolbar svg')
    .count()
  expect(icons).toBeGreaterThan(0)
  // indent/outdent are greyed to match their default disabled state
  await expect(
    page.locator(
      '#vmarkd-prerender .vditor-toolbar [data-type="indent"].vditor-menu--disabled',
    ),
  ).toHaveCount(1)
  release?.()
})

// Regression: the overlay's code block must paint at the SAME height as the live
// editor's settled render, or content below it jumps up at swap. The overlay's code
// is `pre.vditor-ir__preview > code.language-js` (no `.hljs`, the hljs stylesheet is
// runtime-only) so without the #vmarkd-prerender main.css rule it'd miss the hljs
// `padding:1em` box and be ~1em shorter. Hold Lute → measure the overlay code block;
// release → wait for the live render + highlight.js to settle → measure that → assert
// they match. (Both are dark here, so the task-05 9.9px bottom trim applies to both.)
test('overlay code block matches the live render height (no jump on swap)', async ({
  page,
}) => {
  let release: (() => void) | undefined
  await page.route('**/lute/lute.min.js', async (route) => {
    await new Promise<void>((r) => {
      release = r
    })
    await route.continue()
  })
  await open(page)
  // Lute is held → the overlay (with its code block) is still up. Measure it.
  const overlayCode = page
    .locator('#vmarkd-prerender pre.vditor-ir__preview')
    .first()
  await expect(overlayCode).toHaveCount(1)
  const hOverlay = await overlayCode.evaluate(
    (el) => el.getBoundingClientRect().height,
  )
  release?.()
  // Let the live editor mount and highlight.js apply the hljs box (padding:1em) to
  // the rendered code — that stylesheet loading is the height the overlay must match.
  await page.waitForFunction(
    () => {
      const c = document.querySelector(
        '#app pre.vditor-ir__preview code.hljs',
      ) as HTMLElement | null
      return !!c && getComputedStyle(c).paddingTop !== '0px'
    },
    undefined,
    { timeout: 15_000 },
  )
  const hLive = await page
    .locator('#app pre.vditor-ir__preview')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height)
  // Pre-fix gap is ~16px (the missing 1em top padding); the fix brings it to ~0.
  expect(Math.abs(hOverlay - hLive)).toBeLessThanOrEqual(4)
})

// Regression: even AFTER the overlay swaps out, the live editor renders code blocks as bare
// `code.language-X` until highlight.js async-loads its script and tags them `.hljs` — that window
// is where the code block used to grow ~1em (and content jumped) the moment `.hljs` landed. Hold
// the highlight.js library so the editor stays in the un-highlighted window, measure the code
// block, then release and re-measure once `.hljs` + the theme padding apply — the two must match.
test('live code block holds its height before highlight.js loads (no jump after swap)', async ({
  page,
}) => {
  let release: (() => void) | undefined
  await page.route('**/highlight.js/highlight.min.js**', async (route) => {
    await new Promise<void>((r) => {
      release = r
    })
    await route.continue()
  })
  await open(page)
  // Live editor mounted (overlay gone), code rendered but NOT yet highlighted.
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        '#app pre.vditor-ir__preview > code.language-js',
      ) && !document.querySelector('#app pre.vditor-ir__preview > code.hljs'),
    undefined,
    { timeout: 15_000 },
  )
  const liveCode = page.locator('#app pre.vditor-ir__preview').first()
  const hUnhighlighted = await liveCode.evaluate(
    (el) => el.getBoundingClientRect().height,
  )
  release?.()
  // highlight.js now tags `.hljs` and the theme's padding:1em box applies.
  await page.waitForFunction(
    () => {
      const c = document.querySelector(
        '#app pre.vditor-ir__preview code.hljs',
      ) as HTMLElement | null
      return !!c && getComputedStyle(c).paddingTop !== '0px'
    },
    undefined,
    { timeout: 15_000 },
  )
  const hHighlighted = await liveCode.evaluate(
    (el) => el.getBoundingClientRect().height,
  )
  // No growth across the highlight transition = no jump (pre-fix gap was ~9.5px).
  expect(Math.abs(hUnhighlighted - hHighlighted)).toBeLessThanOrEqual(4)
})
