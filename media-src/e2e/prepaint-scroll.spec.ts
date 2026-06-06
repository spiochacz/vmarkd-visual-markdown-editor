import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// E2e for the prepaint→editor scroll handoff (task 49). main.ts captures the user's
// scroll DURING the host overlay (the teaser, while the webview's Lute is still
// loading) and applies it to the live editor at swap-in. These tests drive the REAL
// capture path with real wheel gestures — the prior bug was "I scroll on the teaser
// but when the editor appears the screen stays at the top" (intent not captured /
// applied).

const PARA =
  'Paragraph filler text that is long enough to occupy a full line or two so the document grows tall and the editor actually has somewhere to scroll to.'

function makeDoc(paras: number): string {
  let s = '# Heading\n\n'
  for (let i = 0; i < paras; i++) s += `## Section ${i}\n\n${PARA} (#${i})\n\n`
  return s
}

function initMsg(content: string) {
  return {
    command: 'update',
    type: 'init',
    content,
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
}

// Stub the VS Code API so `ready` is answered with our init message (what the host
// posts on open). No seeding of scroll state — the capture must come from real wheel.
async function open(page: Page, content: string) {
  await page.addInitScript((init) => {
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => {
        if (m && m.command === 'ready') window.postMessage(init, '*')
      },
      getState: () => undefined,
      setState: () => {},
    })
  }, initMsg(content))
  await page.goto('/prerender.html', { waitUntil: 'domcontentloaded' })
}

// Effective scroll offset of whatever actually scrolls (mirrors main.ts findScroller).
async function effectiveScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const start = document.querySelector(
      '#app .vditor-ir pre.vditor-reset',
    ) as HTMLElement | null
    let el: HTMLElement | null = start
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY
      if (
        (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
        el.scrollHeight > el.clientHeight + 1
      ) {
        return el.scrollTop
      }
      el = el.parentElement
    }
    const doc = (document.scrollingElement ||
      document.documentElement) as HTMLElement
    return doc.scrollTop
  })
}

async function liveEditor(page: Page) {
  await page.waitForFunction(
    () =>
      !document.getElementById('vmarkd-prerender') &&
      !!document.querySelector('#app .vditor-ir pre.vditor-reset'),
    undefined,
    { timeout: 20_000 },
  )
}

test('scrolling on the teaser carries into the editor (monolithic)', async ({
  page,
}) => {
  // Hold the webview's Lute so the teaser stays up while we scroll it.
  let release: (() => void) | undefined
  await page.route('**/lute/lute.min.js', async (route) => {
    await new Promise<void>((r) => {
      release = r
    })
    await route.continue()
  })
  await open(page, makeDoc(300)) // ~25 KB → monolithic path
  await page.waitForSelector('#vmarkd-prerender', { timeout: 20_000 })

  // Real wheel gestures over the teaser — captured by main.ts onPrepaintWheel.
  await page.mouse.move(400, 300)
  await page.mouse.wheel(0, 700)
  await page.mouse.wheel(0, 700)

  // Let the editor load; the handoff applies the captured offset.
  release?.()
  await liveEditor(page)
  await expect
    .poll(() => effectiveScrollTop(page), { timeout: 10_000 })
    .toBeGreaterThan(600)
})

test('scrolling on the teaser carries into the editor (streaming)', async ({
  page,
}) => {
  let release: (() => void) | undefined
  await page.route('**/lute/lute.min.js', async (route) => {
    await new Promise<void>((r) => {
      release = r
    })
    await route.continue()
  })
  await open(page, makeDoc(900)) // > 100 KB → streaming path
  await page.waitForSelector('#vmarkd-prerender', { timeout: 20_000 })
  await page.mouse.move(400, 300)
  await page.mouse.wheel(0, 900)
  await page.mouse.wheel(0, 900)
  release?.()
  await liveEditor(page)
  await expect
    .poll(() => effectiveScrollTop(page), { timeout: 14_000 })
    .toBeGreaterThan(800)
})

test('no teaser scroll → editor opens at the top', async ({ page }) => {
  await open(page, makeDoc(300))
  await liveEditor(page)
  await page.waitForTimeout(1500)
  expect(await effectiveScrollTop(page)).toBeLessThan(5)
})

test('a Space keypress after swap-in is editor input, not a teaser PageDown scroll', async ({
  page,
}) => {
  // Regression: the teaser capture reads Space as PageDown (≈0.9×viewport). If the
  // keydown listener survives past editor mount, typing a space in a freshly-opened
  // file is misread as scroll intent and the bridge yanks the view down. The bridge
  // must drop the teaser's keydown capture the moment the editor mounts (monolithic:
  // stop(); streaming: stopKeys()).
  await open(page, makeDoc(300))
  await liveEditor(page)
  // Let the bridge run a few frames so stopKeys() has fired.
  await page.waitForTimeout(400)
  // Dispatch Space exactly as the teaser capture would have observed it.
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    )
  })
  // The bridge window is still open; if intent had been bumped it would scroll now.
  await page.waitForTimeout(700)
  expect(await effectiveScrollTop(page)).toBeLessThan(5)
})

test('plain open (no teaser scroll) stops scroll capture immediately, not after ~3s', async ({
  page,
}) => {
  // When nothing was scrolled on the teaser (intent === 0) the bridge has nothing
  // to apply, so it must fully stop the capture the moment the editor mounts —
  // rather than keeping wheel/keydown listeners + the rAF loop alive for ~3 s.
  await open(page, makeDoc(300))
  await liveEditor(page)
  await expect
    .poll(() => page.evaluate(() => (window as any).__vmarkdScroll?.active), {
      timeout: 1500,
    })
    .toBe(false)
})
