import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// E2e for the host-side instant-paint overlay swap (task 50). prerender.html
// ships the host-style overlay; the real main.ts (loaded by prerender-harness)
// drives the init flow. We stub acquireVsCodeApi so `ready` is answered with an
// `init` message — exactly what the extension host posts on open.
const INIT = {
  command: 'update',
  type: 'init',
  content: '# Hello world\n\nA paragraph.\n',
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
