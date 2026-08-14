import { wf } from './webview-helpers'
// NET (task 375) — PIXEL goldens for every reusable diagram engine, in the real webview.
//
// Why here and not in the chromium harness: both regressions this suite was built for (373 lost
// arrowheads, 374 black mermaid) live in the PAINT-A-COPY path — the Preview pane reusing the edit
// pane's render. The harness has no cross-pane reuse, so it could not have caught either. This spec
// captures the surface where they actually appear.
//
// Two assertions per engine, and they fail for different reasons:
//   1. CROSS-PANE — the Preview render must be pixel-equal to the edit-pane render it was copied
//      from. Needs NO baseline, so it is immune to font drift and works on any machine: it compares
//      two images produced in the SAME run, in the same page, at the same DPR. Every "Preview looks
//      different from the editor" bug is exactly this.
//   2. GOLDEN — the Preview render must match a committed baseline. Catches the case both panes
//      break identically (a theme/engine change), which (1) cannot see by construction.
//
// The goldens are LOCAL and opt-in (`@visual`, skipped unless VMARKD_VISUAL=1) for the reason the
// suite config states: linux-electron font rendering is machine-dependent, and the nightly release
// gate must not go red because a runner has different fonts. (1) is the part that is safe anywhere,
// but both live here together so one command tells the whole story.
//
// Regenerate deliberately, never reflexively: `npm run test:vscode:visual -- --update-snapshots`,
// then LOOK at every changed PNG before committing it. A baseline refreshed on autopilot is how a
// broken render becomes the reference.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Each of the 5 generated tests below sets a DIFFERENT `workbench.colorTheme` / `vmarkd.theme.content`
// pair (that's the whole point of the loop), so neither key can be pinned to one shared value.
useSettingsRestore(test, ['workbench.colorTheme', 'vmarkd.theme.content'])

// The engines whose render is a reusable static SVG, i.e. the ones the cache paints as a COPY into a
// second pane: CACHEABLE_LANGS (custom + cacheable) + NATIVE_CACHE_LANGS. Engines excluded from
// reuse (echarts/mindmap canvas, markmap live d3, graphviz worker, stl WebGL, geojson/topojson
// Leaflet) are deliberately absent — they re-render per pane, so cross-pane equality is not their
// contract. plantuml is excluded too: its miss path renders LIVE and asynchronously.
const ENGINES = [
  'd2',
  'nomnoml',
  'wavedrom',
  'vega',
  'vega-lite',
  'mermaid',
  'flowchart',
  'abc',
] as const

// The REST of the fixture's engines. They are excluded from the reuse machinery (canvas, WebGL, a
// live d3/Leaflet instance, or a live-miss render), so "the Preview copy equals the edit render" is
// not their contract and asserting it would be inventing a rule. A GOLDEN still applies to every one
// of them — that half needs nothing but a render — so they are covered here, golden-only.
// This is the difference between "not covered" and "covered by the half that applies".
const RENDER_ONLY = [
  'plantuml',
  'graphviz',
  'smiles',
  'echarts',
  'mindmap',
  'markmap',
  'geojson',
  'topojson',
] as const
// stl is deliberately NOT here. Under xvfb there is no GPU, so three.js reports "Error creating
// WebGL context" and the element renders as the shared error box — committing THAT as the reference
// would lock in a broken render and never fail on a real STL regression. A golden of an environment
// failure is worse than no golden. Covering it needs a GPU or a swiftshader-enabled run.

// Pixel difference between two PNG buffers, as a RATIO of the frame. Reports a size mismatch
// separately: a pane rendered at a different width is a failure in its own right, and saying so
// beats a meaningless diff count over mis-registered images.
//
// The comparison tolerates a ONE-PIXEL displacement: a pixel counts as different only if it matches
// no pixel in the other image's 3x3 neighbourhood. Measured, not assumed — with a strict
// pixel-for-pixel diff, mermaid and vega came out 0.9% / 1.3% different while every stroke and glyph
// was merely outlined in the diff (the bar BODIES matched, only their edges moved). The two panes
// place the same SVG at a different sub-pixel phase, so every edge lands on a different pixel
// boundary. Absorbing that keeps the threshold TIGHT enough to be worth having; loosening the
// threshold to ~2% instead would have left no room to catch anything real.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pixel-diff ratio with the anti-alias-boundary tolerance band; pre-existing (task 469 baseline)
function diffRatio(
  a: Buffer,
  b: Buffer,
  outPath?: string,
): { ratio: number } | { sizes: string } {
  const pa = PNG.sync.read(a)
  const pb = PNG.sync.read(b)
  // A ONE device-pixel difference in either dimension is rounding, not layout. Measured under
  // github-dark, where d2's screenshots came out 545x247 vs 545x246: the element boxes are IDENTICAL
  // in both panes (545 x 245.390625) and only their fractional TOP differs (…​.64 vs …​.33), so a
  // fractional-height box rounds to a different number of device rows. Compare the common region
  // instead of failing; anything larger really is a pane laying the diagram out differently.
  if (Math.abs(pa.width - pb.width) > 1 || Math.abs(pa.height - pb.height) > 1)
    return { sizes: `${pa.width}x${pa.height} vs ${pb.width}x${pb.height}` }
  const w = Math.min(pa.width, pb.width)
  const h = Math.min(pa.height, pb.height)
  const TOL = 40 // per-channel distance that still counts as the same colour
  // Separate strides — the two images may differ by the one rounded pixel allowed above.
  const atA = (x: number, y: number) => (y * pa.width + x) << 2
  const atB = (x: number, y: number) => (y * pb.width + x) << 2
  const near = (d: Buffer, i: number, e: Buffer, j: number) =>
    Math.abs(d[i] - e[j]) <= TOL &&
    Math.abs(d[i + 1] - e[j + 1]) <= TOL &&
    Math.abs(d[i + 2] - e[j + 2]) <= TOL
  let differing = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = atA(x, y)
      if (near(pa.data, i, pb.data, atB(x, y))) continue
      let found = false
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (let dx = -1; dx <= 1 && !found; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (near(pa.data, i, pb.data, atB(nx, ny))) found = true
        }
      }
      if (!found) differing++
    }
  }
  // The artifact PNG is the strict diff — for a human looking at a failure, seeing the moved edges
  // too is information, not noise.
  // pixelmatch needs the two buffers to share a stride, so the artifact is only written when the
  // sizes match exactly (they do in every case except the rounded-pixel one handled above).
  if (
    outPath &&
    differing &&
    pa.width === pb.width &&
    pa.height === pb.height
  ) {
    const out = new PNG({ width: w, height: h })
    pixelmatch(pa.data, pb.data, out.data, w, h, { threshold: 0.15 })
    fs.writeFileSync(outPath, PNG.sync.write(out))
  }
  return { ratio: differing / (w * h) }
}

// Screenshot only once the element has STOPPED MOVING. Diagram renders land at different times and
// each one reflows what follows, so a capture taken mid-settle catches a stale box — measured: an abc
// capture came back with a neighbouring block's content bleeding into it, and the same element was
// clean on the retry. Two identical bounding boxes 250 ms apart is the cheapest reliable signal.
async function stableShot(
  el: import('@playwright/test').Locator,
): Promise<Buffer> {
  let prev = JSON.stringify(await el.boundingBox())
  for (let i = 0; i < 20; i++) {
    await el.page().waitForTimeout(250)
    const now = JSON.stringify(await el.boundingBox())
    if (now === prev) break
    prev = now
  }
  return el.screenshot({ animations: 'disabled' })
}

// Every content theme, each paired with the VS Code colour theme of the same mode. The pairing is
// load-bearing, not decoration: the webview body is TRANSPARENT, so the page background behind a
// diagram comes from `editor.background` — a light content theme on a dark workbench would bake a
// light-on-dark hybrid no user ever sees into the baseline.
// All 8 engines here react to the content theme (full palette-pairing for mermaid/d2, themed
// foreground for the monochrome tier — ADR-0006), so every one of them is captured in every theme.
// Engines that ignore theming entirely (markmap) are not in this suite at all.
const THEMES = [
  { content: 'vscode-dark-2026', vscode: 'Default Dark Modern' },
  { content: 'vscode-light-2026', vscode: 'Default Light Modern' },
  { content: 'github-dark', vscode: 'Default Dark Modern' },
  { content: 'github-light', vscode: 'Default Light Modern' },
  { content: 'material-dark', vscode: 'Default Dark Modern' },
] as const

for (const theme of THEMES) {
  test(`every reusable diagram looks the same in the editor and in Preview — ${theme.content}`, {
    tag: '@visual',
  }, async ({ workbox, evaluateInVSCode }) => {
    test.setTimeout(300_000)
    // Both themes go in BEFORE the editor opens, so the first render is already the themed one —
    // this spec is about what the render looks like, not about the live-flip path (that is task 363's).
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('workbench')
          .update('colorTheme', args[1], vscode.ConfigurationTarget.Global)
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', args[0], vscode.ConfigurationTarget.Global)
      },
      [theme.content, theme.vscode] as [string, string],
    )
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
    // Every engine on the page must have finished; the slow ones (plantuml, d2) gate this.
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 20_000)))

    // ALL 16 engines, captured in each of the three surfaces the user can be looking at.
    const ALL = [...ENGINES, ...RENDER_ONLY]
    const ir: Record<string, Buffer> = {}
    const missing: string[] = []
    for (const lang of ALL) {
      const el = frame
        .locator(`.vditor-ir .vditor-ir__preview .language-${lang}`)
        .first()
      if (!(await el.count())) {
        missing.push(lang)
        continue
      }
      ir[lang] = await stableShot(el)
    }
    // An engine silently absent from the fixture would make its comparisons vacuously pass.
    expect(missing, 'engines with no rendered block in the edit pane').toEqual(
      [],
    )

    // WYSIWYG — the third surface, and the one no pixel test covered before. Switched through the
    // toolbar exactly as a user would, not by poking the mode field.
    await frame.locator('body').evaluate(() => {
      const v = (window as any).vditor.vditor
      v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      document
        .querySelector('button[data-mode="wysiwyg"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 20_000)))
    // Hide Vditor's block popover (the "⌄ 🗑 IR<Alt+Enter>" panel). It is EDITING CHROME painted over
    // the top-left of a block, not part of the render, and it made the vega-lite comparison fail at a
    // stable 0.60% — measured, and confirmed by dumping the capture: the same element screenshotted
    // outside the full run is pixel-identical to Preview. Hiding it is what makes this compare
    // RENDERS; leaving it would have meant loosening the threshold until the check stopped meaning
    // anything.
    await frame.locator('body').evaluate(() => {
      const s = document.createElement('style')
      s.id = 'vmarkd-visual-suite'
      s.textContent = '.vditor-panel { display: none !important; }'
      document.head.appendChild(s)
    })
    const wys: Record<string, Buffer> = {}
    for (const lang of ALL) {
      const el = frame
        .locator(`.vditor-wysiwyg .vditor-wysiwyg__preview .language-${lang}`)
        .first()
      if (!(await el.count())) continue
      wys[lang] = await stableShot(el)
    }
    expect(
      Object.keys(wys).sort(),
      'engines that did not render in the WYSIWYG pane',
    ).toEqual([...ALL].sort())

    // Full Preview — for the reusable engines this is the paint that REUSES the edit render.
    await frame.locator('body').evaluate(() => {
      const inst = (window as any).vditor
      const v = inst.vditor
      v.preview.element.style.display = 'block'
      v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
      v.preview.render(v)
    })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 20_000)))

    const diffDir = test.info().outputPath()
    for (const lang of ALL) {
      const el = frame.locator(`.vditor-preview .language-${lang}`).first()
      expect(
        await el.count(),
        `${lang} did not render in the Preview pane at all`,
      ).toBeGreaterThan(0)
      const preview = await stableShot(el)

      // 1. cross-pane, BOTH editing surfaces against Preview. No baseline involved, so this half is
      // font-drift-immune and valid on any machine. For the reusable engines it is byte-identity by
      // construction; for the rest the two renders are independent — asserted only because it was
      // MEASURED first, at a delta of exactly 0.0000 for all of them.
      for (const [name, shot] of [
        ['editor', ir[lang]],
        ['WYSIWYG', wys[lang]],
      ] as [string, Buffer][]) {
        const d = diffRatio(
          shot,
          preview,
          path.join(diffDir, `${lang}-${theme.content}-${name}.png`),
        )
        if ('sizes' in d) {
          expect
            .soft(
              d.sizes,
              `${lang}: ${name} rendered at a different SIZE than Preview`,
            )
            .toBe('')
        } else {
          // Anti-aliasing at a different sub-pixel offset accounts for a few pixels; a lost
          // stylesheet, a missing arrowhead or a shifted layout is orders of magnitude more.
          expect
            .soft(
              d.ratio,
              `${lang}: ${name} does not look like Preview (diff PNG in ${diffDir})`,
            )
            .toBeLessThan(0.005)
        }
      }

      // 2. golden — ONE per engine+theme. The equality above pins the other two surfaces to it, so a
      // golden per pane would be three files saying the same thing.
      await expect
        .soft(el)
        .toHaveScreenshot(`diagram-${lang}-${theme.content}.png`, {
          maxDiffPixelRatio: 0.005,
          animations: 'disabled',
        })
    }
  })
}
