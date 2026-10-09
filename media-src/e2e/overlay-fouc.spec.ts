import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'
import { PARITY_CONFIGS } from '../../test/parity/configs'
import { buildParityPage } from './parity-harness'

// The instant-paint overlay must never be VISIBLE before the <head> stylesheets it depends on have
// loaded: unstyled it is a bare `<pre>` (monospace, flush left) that flashes and then jumps to the
// real layout. Resources load instantly on a dev box, so the test slows every stylesheet down and
// samples each rendered frame from document start.
const ORIGIN = 'http://localhost:9123'
const CSS_DELAY_MS = 1500

interface Frame {
  live?: boolean
  t: number
  fontFamily: string
  paddingLeft: number
  sheetsLoaded: number
  sheetsTotal: number
}

async function sampleFrames(
  page: Page,
  html: string,
  opts: { withMain: boolean; only?: string },
): Promise<Frame[]> {
  await page.addInitScript(() => {
    const frames: Frame[] = []
    ;(window as unknown as { __frames: Frame[] }).__frames = frames
    const tick = () => {
      const o = document.getElementById('vmarkd-prerender')
      if (o) {
        const cs = getComputedStyle(o)
        const p = o.querySelector('.vditor-reset p, pre.vditor-reset')
        const links = Array.from(
          document.querySelectorAll<HTMLLinkElement>(
            'head link[rel=stylesheet]:not([disabled])',
          ),
        )
        if (cs.visibility !== 'hidden' && cs.opacity !== '0' && p) {
          const pcs = getComputedStyle(p)
          const reset = getComputedStyle(
            o.querySelector('pre.vditor-reset') as Element,
          )
          frames.push({
            t: Math.round(performance.now()),
            fontFamily: pcs.fontFamily,
            paddingLeft: Number.parseFloat(reset.paddingLeft) || 0,
            sheetsLoaded: links.filter((l) => l.sheet).length,
            sheetsTotal: links.length,
          })
        }
      }
      // The live editor must not paint before the sheets either (main.js is a script, which the
      // browser holds back behind pending stylesheets).
      const live = document.querySelector('#app .vditor-reset')
      if (live) {
        const links = Array.from(
          document.querySelectorAll<HTMLLinkElement>(
            'head link[rel=stylesheet]:not([disabled])',
          ),
        )
        const reset = getComputedStyle(live)
        frames.push({
          live: true,
          t: Math.round(performance.now()),
          fontFamily: reset.fontFamily,
          paddingLeft: Number.parseFloat(reset.paddingLeft) || 0,
          sheetsLoaded: links.filter((l) => l.sheet).length,
          sheetsTotal: links.length,
        })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.route(opts.only ?? '**/*.css*', async (route) => {
    await new Promise((r) => setTimeout(r, CSS_DELAY_MS))
    await route.continue()
  })
  if (!opts.withMain) await page.route('**/dist/main.js*', (r) => r.abort())
  // VS Code hosts the webview in an <iframe> whose document it document.write()s (workbench
  // webview pre/index.html), so the page is delivered the same way here.
  await page.route('**/host.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body style="margin:0"><iframe id="f" style="border:0;width:100vw;height:100vh"></iframe></body>',
    }),
  )
  await page.goto('/host.html', { waitUntil: 'domcontentloaded' })
  await page.evaluate((h) => {
    const d = (document.getElementById('f') as HTMLIFrameElement)
      .contentDocument as Document
    d.open()
    d.write(h)
    d.close()
  }, html)
  await page.waitForTimeout(CSS_DELAY_MS + 2500)
  return page.evaluate(
    () =>
      (
        (document.getElementById('f') as HTMLIFrameElement)
          .contentWindow as unknown as { __frames: Frame[] }
      ).__frames ?? [],
  )
}

for (const [withMain, only] of [
  [false, undefined],
  [true, undefined],
  // The user's Windows capture: content-theme / main.css applied, Vditor's index.css (the largest) not.
  [false, '**/vditor/dist/index.css*'],
  [true, '**/vditor/dist/index.css*'],
] as const) {
  test(`overlay is never visible unstyled while ${only ? 'index.css' : 'stylesheets'} loads (${withMain ? 'with' : 'without'} main.js)`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const html = await buildParityPage(PARITY_CONFIGS[0], ORIGIN)
    const frames = await sampleFrames(page, html, { withMain, only })
    const bad = frames.filter(
      (f) =>
        !/sans|serif|system|segoe|ubuntu|droid sans(?!.*mono)/i.test(
          f.fontFamily,
        ) ||
        f.paddingLeft === 0 ||
        f.sheetsLoaded < f.sheetsTotal,
    )
    // A hold that never lifts would pass the check above with zero frames.
    expect(
      frames.filter((f) => !f.live).length,
      'the overlay is revealed once the sheets loaded',
    ).toBeGreaterThan(0)
    console.log(
      `frames=${frames.length} bad=${bad.length}`,
      JSON.stringify(bad[0] ?? frames[0]),
    )
    expect(bad, 'a frame showed the overlay before its stylesheets').toEqual([])
  })
}
