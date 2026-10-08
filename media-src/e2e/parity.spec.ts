import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'
import { captureStages } from '../../test/parity/capture'
import type { ParityRun } from '../../test/parity/compare'
import { PARITY_CONFIGS } from '../../test/parity/configs'
import { PARITY_MARKERS } from '../../test/parity/elements'
import { OVERLAY_DIAGRAM_UNCACHED_MIN_HEIGHT } from '../../test/parity/policy'
import { judgeRuns } from '../../test/parity/gate'
import type { DiagramSize } from '../../src/shared/diagram-size'
import { buildParityPage } from './parity-harness'

// Task 532 — the cross-stage parity gate, chromium layer (CI, every PR). Canonical fixture ×
// every element kind × five stages (held overlay · IR · WYSIWYG · Preview · split pane) × the
// 10-configuration matrix. The page is the host's REAL HTML around the production bundle (see
// parity-harness.ts); the real-VS-Code twin (test/vscode-e2e/parity-matrix.spec.ts) shares the capture
// sequence, the comparator, the policy and the allow-list. Needs `node build.mjs` first.
//
// One capture test per configuration (serial — they fill the shared `runs` list), then ONE verdict
// test over all of them, so a run lists every difference in every configuration rather than the first.
// A stale allow-list entry fails the verdict too (see compare.ts).
test.describe.configure({ mode: 'serial' })

const runs: ParityRun[] = []
const ORIGIN = 'http://localhost:9123'

const stubbed = new WeakSet<Page>()

async function open(page: Page, html: string): Promise<void> {
  // The webview talks to the host through acquireVsCodeApi; the inline init payload boots the editor
  // without a reply, so a stub is enough (same as prerender.spec.ts). It keeps what the webview
  // posts: the first open of a document reports each diagram's rendered size (step 5c).
  if (!stubbed.has(page)) {
    stubbed.add(page)
    await page.addInitScript(() => {
      const posted: unknown[] = []
      ;(window as unknown as { __posted: unknown[] }).__posted = posted
      ;(window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi =
        () => ({
          postMessage: (m: unknown) => posted.push(m),
          getState: () => undefined,
          setState: () => undefined,
        })
    })
  }
  await page.unroute('**/parity.html')
  await page.route('**/parity.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  )
  await page.goto('/parity.html', { waitUntil: 'domcontentloaded' })
}

// Task 532 step 5c — the FIRST open of the canon: the overlay has no recorded diagram size, and the
// webview reports each rendered diagram's `{sizeKey, size}` to the host. Returns those sizes, which
// the capture open then feeds the overlay exactly the way the host's render cache would.
async function reportedDiagramSizes(
  page: Page,
): Promise<Map<string, DiagramSize>> {
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __posted: { command: string; size?: unknown }[]
        }
      ).__posted.filter((m) => m.command === 'diagram-render-cached' && m.size)
        .length >= 2,
    undefined,
    { timeout: 60_000 },
  )
  const posted = await page.evaluate(
    () =>
      (
        window as unknown as {
          __posted: { command: string; sizeKey?: string; size?: DiagramSize }[]
        }
      ).__posted,
  )
  const sizes = new Map<string, DiagramSize>()
  for (const m of posted)
    if (m.command === 'diagram-render-cached' && m.sizeKey && m.size)
      sizes.set(m.sizeKey, m.size)
  return sizes
}

for (const config of PARITY_CONFIGS) {
  test(`capture ${config.id}`, async ({ page }) => {
    test.setTimeout(240_000)
    await open(page, await buildParityPage(config, ORIGIN))
    const sizes = await reportedDiagramSizes(page)
    expect(sizes.size, 'the first open reported both diagrams').toBe(2)
    await open(page, await buildParityPage(config, ORIGIN, undefined, sizes))
    const stages = await captureStages({
      evaluate: <T>(expr: string) => page.evaluate<T>(expr),
    })
    runs.push({ theme: config.id, stages })
  })
}

// Task 532 step 5c — the UNCACHED contract (policy.ts OVERLAY_DIAGRAM_UNCACHED_MIN_HEIGHT): with no
// recorded size the overlay shows an empty box of the fixed minimum height, never the fence source.
test('an uncached diagram is an empty box of the fixed minimum height, not its source', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const config = PARITY_CONFIGS.find((c) => c.fast) ?? PARITY_CONFIGS[0]
  await open(page, await buildParityPage(config, ORIGIN))
  await page.waitForSelector('#vmarkd-prerender .vmarkd-diagram-placeholder')
  const boxes = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '#vmarkd-prerender .vmarkd-diagram-placeholder > *',
      ),
    ).map((e) => ({
      text: e.textContent,
      height: e.getBoundingClientRect().height,
    })),
  )
  expect(boxes).toHaveLength(2)
  for (const b of boxes) {
    expect(b.text).toBe('')
    expect(b.height).toBe(OVERLAY_DIAGRAM_UNCACHED_MIN_HEIGHT)
  }
})

test('stages agree across every configuration (modulo the allow-list)', () => {
  expect(runs.length, 'every configuration was captured').toBe(
    PARITY_CONFIGS.length,
  )
  const result = judgeRuns(runs, 'harness')
  console.log(result.report)
  expect(result.ok, result.report).toBe(true)
})

// Task 532 step 4 — the overlay's toolbar clone runs the same overflow pass as the live toolbar, so a
// narrow window shows the "..." collapse (not the full icon row) before AND after the swap. Its own
// test and a narrow viewport: the matrix above runs wide enough that nothing overflows. Serial with
// the rest only because the file is (the captured `runs` are untouched).
test('the overlay toolbar clone collapses into "more" like the live toolbar', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 520, height: 800 })
  await open(page, await buildParityPage(PARITY_CONFIGS[0], ORIGIN))
  const overflowed = (root: string) =>
    page.evaluate(
      (r) =>
        document.querySelectorAll(`${r} .vditor-toolbar [data-vmarkd-overflow]`)
          .length,
      root,
    )
  // held overlay: its clone exists once the real toolbar was built, overflow decided in the next rAF
  await expect
    .poll(() => overflowed('#vmarkd-prerender'), { timeout: 60_000 })
    .toBeGreaterThan(0)
  // the live toolbar makes the same decision once the editor is up
  await expect
    .poll(() => overflowed('#app'), { timeout: 60_000 })
    .toBeGreaterThan(0)
  expect(await overflowed('#vmarkd-prerender')).toBe(await overflowed('#app'))
})

// Task 532 step 4 — the overlay decoration is capped to the first two viewports (cold-start budget):
// the parity gate lifts the cap through __vmarkdOverlayDecorateAll, this test keeps it, so it sees the
// production behaviour on real layout. Head blocks are decorated, the tail below two viewports is not.
test('the overlay decorates only the first two viewports', async ({ page }) => {
  test.setTimeout(120_000)
  // 1000px: two viewports (2000px) reach past the canon's first code fences and math block but not
  // its html comments / last fences.
  await page.setViewportSize({ width: 1280, height: 1000 })
  const html = (await buildParityPage(PARITY_CONFIGS[0], ORIGIN)).replace(
    'window.__vmarkdOverlayDecorateAll=true;',
    '',
  )
  await open(page, html)
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __vmarkdOverlayDecorateMs?: number })
        .__vmarkdOverlayDecorateMs === 'number',
    undefined,
    { timeout: 60_000 },
  )
  const r = await page.evaluate(
    (sel) => {
      const root = document.querySelector(
        '#vmarkd-prerender .vditor-reset',
      ) as HTMLElement
      const limit = 2 * window.innerHeight
      const top = root.getBoundingClientRect().top
      const blocks = Array.from(root.children)
      const count = (head: boolean, selector: string) =>
        blocks.filter(
          (b) =>
            b.getBoundingClientRect().top - top <= limit === head &&
            (b.matches(selector) || b.querySelector(selector)),
        ).length
      return {
        headTokens: count(true, sel.token),
        headRawMath: count(true, '.language-math:not([data-math])'),
        tailTokens: count(false, sel.token),
        tailComments: count(false, sel.comment),
        tailBlocks: blocks.filter(
          (b) => b.getBoundingClientRect().top - top > limit,
        ).length,
      }
    },
    {
      token: PARITY_MARKERS['hljs-token'],
      comment: PARITY_MARKERS['html-comment'],
    },
  )
  expect(r.tailBlocks, 'the canon outgrows two viewports').toBeGreaterThan(0)
  expect(r.headTokens, 'code in the head is highlighted').toBeGreaterThan(0)
  expect(r.headRawMath, 'no raw math in the head').toBe(0)
  expect(r.tailTokens, 'code in the tail stays plain').toBe(0)
  expect(r.tailComments, 'comments in the tail stay plain').toBe(0)
})
