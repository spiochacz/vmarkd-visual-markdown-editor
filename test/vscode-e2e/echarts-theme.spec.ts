import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { wf } from './webview-helpers'

// This spec rewrites `theme.content` four times and cannot stop — the content theme IS what it
// tests. What it must not do is leave the last one behind: it runs immediately before
// `flip-skip.spec.ts` in the suite's own order, whose control ("the first flip re-renders mermaid")
// silently stops holding once a content theme is pinned, because a workbench flip then changes
// nothing the renderers key off. Measured: this pair reproduced that failure on the first attempt
// (task 516 triage / task 524).
useSettingsRestore(test, ['vmarkd.theme.content'])

// ECharts + mindmap must follow the CONTENT theme regardless of the VS Code window mode.
// Ground truth = the PAINTED canvas pixels (getImageData), not getOption(). Run light/dark as
// SEPARATE process invocations (the suite reuses one VS Code instance → a 2nd test in the same
// run can read a stale shared echarts theme). Select with: -g "light" or -g "dark".
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Dominant SATURATED colour of a canvas: skip near-grey + near-bg pixels, bucket the rest to the
// nearest 32 and return the most common as "r,g,b". This is the series/bar/node fill the user sees.
const DOMINANT = `(canvas => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'NO-CTX';
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return 'ZERO-SIZE';
  const { data } = ctx.getImageData(0, 0, w, h);
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 128) continue;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    if (max - min < 40) continue; // grey / white / near-bg
    const key = (Math.round(r/32)*32) + ',' + (Math.round(g/32)*32) + ',' + (Math.round(b/32)*32);
    counts.set(key, (counts.get(key)||0) + 1);
  }
  let best = 'NONE', bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
  return best;
})`

async function dominant(frame: ReturnType<typeof wf>, selector: string) {
  return frame.locator('body').evaluate(
    (_b, args) => {
      const [sel, fn] = args as [string, string]
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null
      if (!canvas) return 'NO-CANVAS'
      return new Function('canvas', `return (${fn})(canvas)`)(canvas)
    },
    [selector, DOMINANT] as [string, string],
  )
}

for (const { mode, theme, lightBlue } of [
  { mode: 'light', theme: 'vscode-light-2026', lightBlue: true },
  { mode: 'dark', theme: 'vscode-dark-2026', lightBlue: false },
]) {
  test(`echarts + mindmap follow content theme (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    await evaluateInVSCode(
      async (vscode, args) => {
        const [uri, contentTheme] = args as [string, string]
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', contentTheme, true)
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vmarkd.editor',
        )
      },
      [FIXTURE, theme] as [string, string],
    )

    const frame = wf(workbox)
    await frame
      .locator('.vditor-ir__node[data-type="code-block"]')
      .first()
      .waitFor({ timeout: 45_000 })

    // Let the IR render settle before swapping into Preview (the overlay render is flaky if
    // entered the instant the first code block appears).
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

    // The IR pane FIRST — it is the surface the user actually edits in, and until now nothing
    // asserted its series colour (only its background, in the live-flip test below). Task 425's
    // muting was briefly believed not to reach it, because the @visual golden for this theme still
    // held the raw pre-425 blue and kept passing: pixelmatch's default per-pixel threshold (0.2 →
    // maxDelta 1409) is looser than the distance between raw and muted (504 dark / 264 light), so
    // the golden net is blind to exactly this kind of same-hue desaturation. Measured here instead.
    const irChart = await dominant(
      frame,
      '.vditor-ir__preview .language-echarts canvas',
    )

    // Enter the full Preview overlay (charts render there at a real size).
    await frame.locator('body').evaluate(() => {
      const v = (window as any).vditor
      const editEls = document.querySelectorAll(
        '.vditor-ir, .vditor-wysiwyg, .vditor-sv',
      )
      for (const el of Array.from(editEls))
        (el as HTMLElement).style.display = 'none'
      if (v?.vditor?.preview?.element) {
        v.vditor.preview.element.style.display = 'block'
        v.vditor.preview.render(v.vditor)
      }
    })

    await frame
      .locator('.vditor-preview .language-echarts canvas')
      .first()
      .waitFor({ timeout: 30_000 })
    // mindmap may take a beat longer; don't hard-fail the wait — sample whatever painted.
    await frame
      .locator('.vditor-preview .language-mindmap canvas')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {
        /* don't hard-fail the wait — see comment above */
      })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

    // ECharts chart: the bars are large → assert on the DOMINANT saturated canvas pixel.
    const chart = await dominant(
      frame,
      '.vditor-preview .language-echarts canvas',
    )
    // Mindmap: the `tree` node symbols are tiny (7px) and most pixels are grey label
    // surfaces, so dominant-pixel can't see them. ECharts paints node symbols with exactly
    // the explicit itemStyle.color we set from the theme → read that painted-truth value
    // (the whole point of the fix; before it the tree fell back to ECharts-default grey).
    const mindColor = await frame.locator('body').evaluate(() => {
      const w = window as any
      const el = document.querySelector('.vditor-preview .language-mindmap')
      const inst = el && w.echarts?.getInstanceByDom?.(el)
      if (!inst) return 'NO-INST'
      const opt = inst.getOption() as any
      const tree = opt?.series?.find((s: any) => s?.type === 'tree')
      return (tree?.itemStyle?.color as string) || 'NO-COLOR'
    })
    // Task 425 muted the raw VS Code `charts.*` blue toward the editor background
    // (mix(colour, bg, 0.12/0.22) in `ECHARTS_CONTENT_PALETTE`) — these pin the ACTUAL painted
    // (muted) colour, not the pre-425 raw one. `series[0]` also drives the mindmap tree node
    // colour (`mindmapStyleFromTheme` reads `theme.color[0]`), so both follow together.
    const LIGHT = '32,128,224' // mix('#0063d3', '#ffffff', 0.12) = #1f76d8, bucketed
    const DARK = '64,128,192' // mix('#59a4f9', '#121314', 0.22) = #4984c7, bucketed
    if (lightBlue) {
      expect(chart).toBe(LIGHT)
      expect(irChart).toBe(LIGHT)
      expect(mindColor.toLowerCase()).toBe('#1f76d8')
    } else {
      expect(chart).toBe(DARK)
      expect(irChart).toBe(DARK)
      expect(mindColor.toLowerCase()).toBe('#4984c7')
    }
  })
}

// Live theme flip (no reopen): the chart + mindmap BACKGROUND must follow the new content theme.
// Regression for the "background doesn't follow light/dark" bug — reRenderEcharts re-themes the
// IR-pane chart by reconstructing from source (always worked), but the mindmap path used to require
// a live echarts instance via getInstanceByDom (null on the snapshot IR-pane node) and preserved
// getOption().backgroundColor, so the mindmap's background stayed stale. The fix reconstructs the
// mindmap from `data-code` like the chart and lets the registered theme drive the background.
// Asserts on the painted canvas CORNER pixel (the background the user actually sees), in the IR
// preview pane (the default editing surface), and that no chart is rendered into the editable source.
//
// Task 412's viewport gate (diagram-retheme.ts's `gateAndRender`/`viewport-gate.ts`) defers a live
// re-theme for any diagram outside the viewport (±200px) until it actually scrolls into view — by
// design, so a flip on a long document doesn't dispose+reinit every offscreen chart. `all-renderers.md`
// is long enough that BOTH the echarts chart (§ well past the fold) and the mindmap sit far outside a
// headless VS Code window's ~786px viewport at document-top, so without a scroll their redraw callback
// is queued on the shared IntersectionObserver and never fires — this test asserted the pre-412 "always
// eager" contract and went stale the moment task 412 landed (2026-07-30, a month after this test was
// written) without touching this spec. Scroll each candidate into view AFTER the flip (the gate
// partitions candidates at flip time; a pre-flip scroll would already be stale) to exercise the same
// scroll-in path `retheme-preview-surface.spec.ts` already uses for the other four engines.
test('chart + mindmap background follows a live light->dark flip', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'vscode-light-2026', true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  // Stay in IR mode (default) — sample the IR preview panes (what reRenderEcharts targets).
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // Live flip to dark via config change (extension -> webview configChanged -> reRenderEcharts).
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'vscode-dark-2026', true)
  })

  // Scroll the chart, then the mindmap, into view so the viewport gate's IntersectionObserver
  // actually fires each one's deferred re-render (see the comment above the test).
  for (const sel of [
    '.vditor-ir__preview .language-echarts',
    '.vditor-ir__preview .language-mindmap',
  ]) {
    await frame.locator('body').evaluate((_b, s: string) => {
      document.querySelector(s)?.scrollIntoView({ block: 'center' })
    }, sel)
  }

  const readAfter = () =>
    frame.locator('body').evaluate(() => {
      const w = window as unknown as {
        echarts?: { getInstanceByDom?: (el: Element) => unknown }
      }
      const corner = (sel: string) => {
        const el = document.querySelector(sel)
        const canvas = el?.querySelector('canvas') as HTMLCanvasElement | null
        const ctx = canvas?.getContext('2d')
        if (!ctx) return 'NO-CANVAS'
        const d = ctx.getImageData(2, 2, 1, 1).data
        return `${d[0]},${d[1]},${d[2]}`
      }
      // Count rendered mindmaps that landed in an EDITABLE source surface (regression guard).
      const srcRendered = Array.from(
        document.querySelectorAll('.language-mindmap'),
      ).filter(
        (el) =>
          !el.closest(
            '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview',
          ) && w.echarts?.getInstanceByDom?.(el),
      ).length
      return {
        chart: corner('.vditor-ir__preview .language-echarts'),
        mind: corner('.vditor-ir__preview .language-mindmap'),
        srcRendered,
      }
    })

  // #121314 (Dark 2026 editor.background) = rgb(18,19,20). Poll for it — the observer's fire is
  // async (dispose → looseJsonParse → init → setOption), so a fixed sleep would be a guess at how
  // long that chain takes; poll the actual condition instead (task 451).
  await expect.poll(async () => (await readAfter()).chart).toBe('18,19,20')
  const after = await readAfter()
  expect(after.chart).toBe('18,19,20')
  expect(after.mind).toBe('18,19,20')
  // Never render a chart into the editable source `.language-mindmap`.
  expect(after.srcRendered).toBe(0)
})

// Task 424 (reprise, 2026-07-28) — the user compared echarts' material-dark salmon against
// vega/vega-lite's own hardcoded default blue and asked for the SAME salmon on both. Ground
// truth again = the actually-painted output: echarts (canvas) via the dominant-pixel helper
// above, vega/vega-lite (SVG renderer — see `vegaRenderConfig`'s call site) via the rendered
// mark's own `fill` attribute, not `getOption()`/config introspection.
test('echarts + vega + vega-lite all render the shared material-dark salmon (task 424 reprise)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'material-dark', true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('.vditor-ir__preview .language-vega-lite .mark-rect path')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator(
      '.vditor-ir__preview .language-vega:not(.language-vega-lite) .mark-rect path',
    )
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const chart = await dominant(
    frame,
    '.vditor-ir__preview .language-echarts canvas',
  )
  const marks = await frame.locator('body').evaluate(() => {
    const fillOf = (sel: string) =>
      document.querySelector(sel)?.getAttribute('fill') ?? 'NOT-FOUND'
    return {
      lite: fillOf('.vditor-ir__preview .language-vega-lite .mark-rect path'),
      // The fenced ```vega block carries ONLY `language-vega`, never `-lite` — exclude it
      // explicitly since `.language-vega` alone would also match the vega-lite block's
      // `<div class="language-vega-lite">`… no: CSS class-token matching is exact, so
      // `.language-vega` never matches an element whose class is `language-vega-lite` only.
      // The :not() stays as a readable belt-and-braces guard, not a required fix.
      vega: fillOf(
        '.vditor-ir__preview .language-vega:not(.language-vega-lite) .mark-rect path',
      ),
    }
  })

  const SALMON = '224,128,128' // #d87c7c bucketed to nearest 32, same bucketing as `dominant`
  expect(chart).toBe(SALMON)
  expect(marks.lite).toBe('#d87c7c')
  expect(marks.vega).toBe('#d87c7c')
})
