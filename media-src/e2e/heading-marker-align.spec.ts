import { expect, test } from './coverage-fixture'
import { PARITY_CONFIGS } from '../../test/parity/configs'
import { buildParityPage } from './parity-harness'

// Task 532 step 3b — the left-gutter heading markers (H1..H6, `vmarkd.editor.headingMarkers`) must sit
// on their heading's own first line: the marker ::before's line box (height) equals the heading's line
// box and it carries no vertical offset, at every heading level, in IR and WYSIWYG, at every editor font
// size, on every geometry profile (vscode · github · default/Monokai · material-dark). Both read the
// same --vmarkd-geo-h1..h6 / --vmarkd-geo-heading-lh tokens, so this holds by construction; the spec
// pins that. Real-VS-Code twin: test/vscode-e2e/heading-marker-align.spec.ts. Needs `node build.mjs`.
const ORIGIN = 'http://localhost:9123'
const DOC = [1, 2, 3, 4, 5, 6]
  .map((n) => `${'#'.repeat(n)} Heading level ${n}`)
  .join('\n\n')
  .concat('\n\nTrailing paragraph.\n')
const THEMES = [
  'vscode-dark-2026',
  'github-dark',
  'material-dark',
  'auto-monokai',
]
const SIZES = [12, 14, 16, 20]
const TOLERANCE = 0.5
const SHOT = process.env.HM_SHOT // `<dir>/<prefix>` — screenshots for eyeballing

for (const id of THEMES) {
  const base = PARITY_CONFIGS.find((c) => c.id === id)
  if (!base) throw new Error(`parity config ${id} missing`)
  const config = {
    ...base,
    settings: { ...base.settings, 'vmarkd.editor.headingMarkers': true },
  }
  test(`heading markers sit on their heading's line box — ${id}`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      ;(window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi =
        () => ({
          postMessage: () => undefined,
          getState: () => undefined,
          setState: () => undefined,
        })
    })
    const html = await buildParityPage(config, ORIGIN, DOC)
    await page.route('**/hm.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    )
    await page.goto('/hm.html', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => !!document.querySelector('#app .vditor-ir pre.vditor-reset > h6'),
      undefined,
      { timeout: 60_000 },
    )
    await page.evaluate(() =>
      (
        window as unknown as { __vmarkdReleasePrerender?: () => void }
      ).__vmarkdReleasePrerender?.(),
    )

    const measure = (mode: 'ir' | 'wysiwyg', px: number) =>
      page.evaluate(
        ({ mode, px }) => {
          document.body.style.setProperty('--me-font-size', `${px}px`)
          const root = document.querySelector(
            `#app .vditor-${mode} pre.vditor-reset`,
          ) as HTMLElement
          // Park the caret in the trailing paragraph: a caret inside a heading expands its source.
          const last = root.lastElementChild as HTMLElement
          const r = document.createRange()
          r.setStart(last, 0)
          r.collapse(true)
          const sel = getSelection()
          sel?.removeAllRanges()
          sel?.addRange(r)
          return [1, 2, 3, 4, 5, 6].map((n) => {
            const h = root.querySelector(`:scope > h${n}`) as HTMLElement
            const cs = getComputedStyle(h)
            const m = getComputedStyle(h, '::before')
            const num = (v: string) => Number.parseFloat(v) || 0
            return {
              level: n,
              fontSize: cs.fontSize,
              heading: num(cs.lineHeight),
              markerHeight: num(m.height),
              markerLineHeight: num(m.lineHeight),
              markerTop: num(m.top),
              markerMarginTop: num(m.marginTop),
              markerContent: m.content,
            }
          })
        },
        { mode, px },
      )

    for (const mode of ['ir', 'wysiwyg'] as const) {
      if (mode === 'wysiwyg') {
        await page.evaluate(() =>
          document
            .querySelector('.vditor-toolbar button[data-mode="wysiwyg"]')
            ?.dispatchEvent(
              new MouseEvent('click', { bubbles: true, cancelable: true }),
            ),
        )
        await page.waitForSelector(
          '#app .vditor-wysiwyg pre.vditor-reset > h6',
          { timeout: 30_000 },
        )
        await page.waitForTimeout(500)
      }
      for (const px of SIZES) {
        await measure(mode, px) // applies the size + parks the caret; the next read is the settled one
        await page.waitForTimeout(100)
        const settled = await measure(mode, px)
        for (const row of settled) {
          const label = `${id} ${mode} ${px}px h${row.level}`
          console.log(
            `[hm] ${label}: heading ${row.heading} marker ${row.markerHeight} (lh ${row.markerLineHeight}) top ${row.markerTop} delta ${Math.round((row.markerHeight - row.heading) * 100) / 100}`,
          )
          expect
            .soft(row.markerContent, `${label} marker shown`)
            .toContain(`H${row.level}`)
          expect
            .soft(row.markerHeight, `${label} marker line box height`)
            .toBeCloseTo(row.heading, 0)
          expect
            .soft(
              Math.abs(row.markerHeight - row.heading),
              `${label} marker line box vs heading`,
            )
            .toBeLessThanOrEqual(TOLERANCE)
          expect
            .soft(
              Math.abs(row.markerTop + row.markerMarginTop),
              `${label} marker has no vertical offset`,
            )
            .toBeLessThanOrEqual(TOLERANCE)
        }
        if (SHOT && px === 20) {
          await page.screenshot({
            path: `${SHOT}-${id}-${mode}-${px}.png`,
            clip: { x: 0, y: 0, width: 760, height: 520 },
          })
        }
      }
    }
  })
}
