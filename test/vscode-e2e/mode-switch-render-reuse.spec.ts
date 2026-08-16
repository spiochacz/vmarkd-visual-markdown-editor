import { type EvaluateInVSCode, wf } from './webview-helpers'
// NET (task 365) — a diagram must look the SAME in IR and in the full Preview pane.
//
// It did not. The render cache's reserve+request is a ONE-SHOT at open, and the full Preview pane
// does not exist yet at that point, so every cacheable block it later builds bypassed the cache
// entirely (measured: `data-vmarkd-cache-reserve` and `-hit` both null on all 12 Preview d2 blocks)
// and was laid out a SECOND time by the engine. Two independent text measurements disagreed on 3 of
// the 12 — widths 375→342, 247→197, 863→851 — which the user saw as "diagrams shift left, labels
// have no background so the line underneath shows through, boxes get a horizontal scrollbar".
//
// The assertion that actually pins this is NOT "a cache-hit attribute is present" (a hit that
// painted a re-sized SVG would still be the bug). It is pane-to-pane output IDENTITY: the same
// block's innerHTML, byte for byte — modulo the per-paint id namespace, which task 373 made
// DELIBERATELY different between panes (duplicate ids sent url(#…) into the hidden pane and killed
// mermaid/flowchart arrowheads). Everything else must still match exactly.
//
// Task 450 — collapsed from 6 test()s (one VS Code boot + one 12s open-settle EACH, task 448) into
// 2, grouped by what they can share without changing what's asserted:
//   - the 4 tests that only ever need "open, switch to Preview once, wait once, then read" (byte
//     identity, the reuse mechanism, graphviz's SVG comments, and the sanitiser-proofed HTML
//     comments) now share ONE open + ONE switch + ONE settle instead of 4 of each — this is most
//     of task 451's win on this file too, since 3 of the 4 15s Preview-settles disappear as a
//     side effect of the merge itself, not a poll conversion.
//   - the round-trip-stability test and the non-reused-engines test share the second boot: the
//     non-reused comparison needs an IR-pane read BEFORE any switch, which the round-trip test
//     doesn't have and can't retrofit into the first group without moving ITS read earlier too, so
//     it stays in its own test().
// `expect.soft()` throughout — every sub-check that used to be its own test() keeps its own
// message, so a merge failure still names exactly which one broke.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

// The reusable-SVG CUSTOM engines (CACHEABLE_LANGS in render-cache-client) present in the fixture,
// plus the Vditor-NATIVE ones the reuse map also covers in the full Preview pane. The natives
// diverged the same way d2 did — abc came out 451.99x98.83 in IR and 420.02x87.83 in Preview.
// NOT graphviz: reserving it would make Viz.js double-invoke and hang the webview (task 184), so it
// still renders fresh per pane. NOT markmap/echarts/mindmap either — a live d3 instance and two
// canvases, none of them a reusable static SVG.
const LANGS = [
  'd2',
  'wavedrom',
  'nomnoml',
  'vega-lite',
  'mermaid',
  'abc',
  'flowchart',
  'plantuml',
]

// task 451: replaces the blind 12s/15s×N "let everything settle" sleeps below. This is a
// markup/attribute-EXISTENCE check ("has this block produced its svg/canvas yet"), not a geometry
// measurement — see task 451's discriminator — so there is no "still growing, might report a
// mid-reflow false-stable" risk the way there is for wysiwyg-parity/mode-switch-parity's px-based
// waits. Counts are the fixture's own known block counts per lang (measured directly from
// all-renderers.md: 4 wavedrom, 2 nomnoml, 2 vega-lite, 2 mermaid, 1 each of the rest) plus the
// reliably-drawing non-cacheable engines (FRESH_LANGS below, minus `stl` — needs WebGL and may
// legitimately draw nothing headless, see the non-reused-engines test). d2 is 12, not the fixture's
// 13 fences — one deliberately falls back LOUDLY to raw source (`shape: sequence_diagram`, not
// renderable by our layout) and never produces an svg; the file's own header comment already names
// "12 Preview d2 blocks" for the same reason.
const RENDER_TARGETS: Record<string, number> = {
  d2: 12,
  wavedrom: 4,
  nomnoml: 2,
  'vega-lite': 2,
  mermaid: 2,
  abc: 1,
  flowchart: 1,
  plantuml: 1,
  graphviz: 1,
  smiles: 1,
  markmap: 1,
  echarts: 1,
  mindmap: 1,
  geojson: 1,
}

// `paneExpr` is a JS expression string (evaluated inside the webview) that resolves the root
// element to search — the IR/WYSIWYG element or the Preview pane's element.
function renderReady(paneExpr: string) {
  return `((targets) => {
    const v = window.vditor
    const root = ${paneExpr}
    if (!root) return false
    for (const lang in targets) {
      const els = Array.from(root.querySelectorAll('.language-' + lang))
        .filter((el) => !el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre'))
        .filter((el) => el.querySelector('svg') || el.querySelector('canvas') || el.querySelector('.leaflet-container'))
      if (els.length < targets[lang]) return false
    }
    return true
  })(${JSON.stringify(RENDER_TARGETS)})`
}

// Per lang, the rendered blocks in each pane: their markup + the width the engine settled on.
const SNAP = `((langs) => {
  const v = window.vditor
  const irEl = v.vditor[v.getCurrentMode()].element
  const pvEl = v.vditor.preview.previewElement
  const grab = (root) => {
    const out = {}
    for (const lang of langs) {
      out[lang] = Array.from(root ? root.querySelectorAll('.language-' + lang) : [])
        .filter((el) => !el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre'))
        .filter((el) => el.querySelector('svg'))
        .map((el) => ({
          html: el.innerHTML,
          w: el.querySelector('svg').getAttribute('width'),
          hit: el.getAttribute('data-vmarkd-cache-hit'),
        }))
    }
    return out
  }
  return { ir: grab(irEl), pv: grab(pvEl) }
})(${JSON.stringify(LANGS)})`

const TO_PREVIEW = () => {
  const inst = (window as any).vditor
  const v = inst.vditor
  v.preview.element.style.display = 'block'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
  v.preview.render(v)
}

const TO_EDIT = () => {
  const inst = (window as any).vditor
  const v = inst.vditor
  v.preview.element.style.display = 'none'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'block'
}

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
) {
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
  // The engines must FINISH in IR — their output is the reference the Preview pane reuses.
  // task 451: was a blind 12s sleep — poll for every engine's block count instead (RENDER_TARGETS).
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(renderReady('v.vditor[v.getCurrentMode()].element')),
      {
        message:
          'IR pane finished rendering every engine (cacheable + non-cacheable)',
        timeout: 30_000,
      },
    )
    .toBe(true)
  return frame
}

type Snap = Record<string, { html: string; w: string; hit: string | null }[]>

// Ids MUST differ between panes since task 373: a verbatim copy duplicated every id, and url(#…)
// resolves to the first match in document order — the hidden pane's copy — so mermaid/flowchart lost
// their arrowheads. Each paint namespaces its ids with `-vmN`; strip that before comparing, so this
// still asserts byte-identity of everything that is supposed to be identical.
const stripIdNs = (html: string) => html.replace(/-vm\d+(?=["')])/g, '')
function compare(ir: Snap, pv: Snap): { compared: number; diffs: string[] } {
  const diffs: string[] = []
  let compared = 0
  for (const lang of LANGS) {
    const a = ir[lang] ?? []
    const b = pv[lang] ?? []
    if (a.length !== b.length) {
      diffs.push(
        `${lang}: rendered ${a.length} in IR but ${b.length} in Preview`,
      )
      continue
    }
    a.forEach((blk, i) => {
      compared++
      // Locate the difference in the SAME strings the comparison judges — the stripped ones. Reading
      // the position off the raw markup instead pointed at the first `-vmN` id suffix, which
      // `stripIdNs` had already normalised away, so the message named a difference that could not be
      // the cause and hid the real one (2026-08-15, the flake in run 6 of the full suite).
      const [sa, sb] = [stripIdNs(blk.html), stripIdNs(b[i].html)]
      if (sa !== sb) {
        let at = 0
        while (at < sa.length && sa[at] === sb[at]) at++
        // Dump BOTH normalised strings whole. This difference has been seen exactly once, in a 1.1h
        // full-suite run, and never reproduced (20/20 solo, 16/16 under 8×`yes`, a clean replay of
        // the real 11-spec predecessor chain) — so the next occurrence has to be conclusive on its
        // own. A 120-char excerpt is not: the previous one pointed at an id suffix that `stripIdNs`
        // had already removed, because the position was measured on the RAW markup.
        const dump = path.join(
          __dirname,
          '..',
          '..',
          'tmp',
          `mode-switch-diff-${lang}-${i}.txt`,
        )
        try {
          mkdirSync(path.dirname(dump), { recursive: true })
          writeFileSync(dump, `IR:\n${sa}\n\n=====\n\nPV:\n${sb}\n`)
        } catch {
          // A dump failure must not replace the real assertion message with an fs error.
        }
        diffs.push(
          `${lang}#${i}: markup differs (width ${blk.w} → ${b[i].w}, preview cache-hit=${b[i].hit}, ` +
            `len ${sa.length} vs ${sb.length}) at ${at}, full dump in ${dump}: ` +
            `IR …${sa.slice(Math.max(0, at - 60), at + 60)}… vs PV …${sb.slice(Math.max(0, at - 60), at + 60)}…`,
        )
      }
    })
  }
  return { compared, diffs }
}

test('every cacheable diagram matches in IR ↔ Preview (identity, reuse, SVG/HTML comments)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const frame = await open(workbox, evaluateInVSCode)
  await frame.locator('body').evaluate(TO_PREVIEW)
  // task 451: was a blind 15s sleep — poll for the same render-readiness the sub-checks below need
  // (SNAP's LANGS + the graphviz/html-comment sub-checks' non-cacheable engines).
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(renderReady('v.vditor.preview.previewElement')),
      {
        message:
          'Preview pane finished rendering every engine after the switch',
        timeout: 30_000,
      },
    )
    .toBe(true)

  // Sub-check 1 (was its own test: "every cacheable diagram is byte-identical in IR and in
  // Preview") + sub-check 2 (was "the Preview pane REUSES the IR render instead of re-running the
  // engine") — both read off the SAME snapshot, taken once.
  const { ir, pv } = (await frame.locator('body').evaluate(SNAP)) as {
    ir: Snap
    pv: Snap
  }
  const { compared, diffs } = compare(ir, pv)
  // Never let an empty fixture (or a pane that rendered nothing) pass as "everything matched" —
  // the vacuous-assertion trap that hid task 361 for a whole round.
  expect
    .soft(compared, 'no rendered diagram pairs were compared at all')
    .toBeGreaterThan(10)
  expect
    .soft(diffs, 'a diagram was laid out differently in the two panes')
    .toEqual([])
  // Identity alone could in principle be reached by two engine runs agreeing; this pins the
  // MECHANISM, so a future change that silently drops back to re-rendering is caught even on a doc
  // where both runs happen to agree.
  const d2 = pv.d2 ?? []
  expect
    .soft(d2.length, 'no d2 blocks rendered in the Preview pane')
    .toBeGreaterThan(5)
  expect
    .soft(
      d2.filter((b) => b.hit !== '1').length,
      'a Preview d2 block was rendered by the engine rather than reused',
    )
    .toBe(0)

  // Sub-check 3 (was "a rendered diagram keeps its own SVG comments in Preview", task 366) —
  // graphviz is NOT reused (Viz.js would double-invoke and hang), so it renders fresh in each pane
  // and its markup has to be compared rather than guaranteed. It differed: graphviz carries the DOT
  // source's own comments into its SVG output (`<!-- A -->` per node), and the Preview pane's
  // comment-reveal pass rewrote those into `<div class="vmarkd-comment">` — invalid inside an
  // <svg>, and absent from the IR pane where that pass never runs.
  const gv = await frame.locator('body').evaluate(`(() => {
    const pv = window.vditor.vditor.preview.previewElement
    const g = pv.querySelector('.language-graphviz svg')
    return {
      drawn: !!g,
      injected: g ? g.querySelectorAll('.vmarkd-comment').length : -1,
      // The authored comment OUTSIDE any diagram must still be shown — this fix is a skip, not a
      // disable.
      authored: pv.innerHTML.includes('should be visible as muted text'),
    }
  })()`)
  expect
    .soft(gv, 'graphviz SVG comments in Preview')
    .toEqual({ drawn: true, injected: 0, authored: true })

  // Sub-check 4 (was "authored HTML comments appear in Preview, and only outside code fences",
  // task 367) — the preview render runs Lute with sanitize:true and Lute's sanitiser drops
  // comments outright, so the text was absent from the DOM entirely (not merely invisible) while
  // IR showed it. Fixed by rewriting block comments into a sanitiser-proof element BEFORE Lute sees
  // them, rather than by switching sanitising off.
  const htmlComments = await frame.locator('body').evaluate(`(() => {
    const pv = window.vditor.vditor.preview.previewElement
    const marks = Array.from(pv.querySelectorAll('.vmarkd-comment'))
    return {
      count: marks.length,
      shown: pv.innerHTML.indexOf('should be visible as muted text') >= 0,
      // The masking runs on the markdown SOURCE, so the one thing that could go wrong silently is
      // eating a comment that lives inside a fence, where it is literal text the reader wants.
      insideFence: marks.filter((m) => m.closest('pre, code')).length,
      // It must not have leaked into the editable document either.
      inSource: window.vditor.getValue().indexOf('vmarkd-comment') >= 0,
    }
  })()`)
  expect.soft(htmlComments, 'authored HTML comments in Preview').toEqual({
    count: 3,
    shown: true,
    insideFence: 0,
    inSource: false,
  })
})

// The engines the reuse map does NOT cover — a live d3 instance (markmap), two canvases (echarts,
// mindmap), a Leaflet map (geojson) and a WebGL scene (stl), plus graphviz and smiles, which render
// fresh in each pane. Byte-identity is impossible for them, so assert the two things a reader would
// notice: it DREW in both panes, at the same intrinsic size, in the same colour.
//
// Colour is the reason this test exists. smiles paints from currentColor and came out
// rgb(215,186,125) in the full Preview against rgb(209,213,218) in IR — VS Code's injected default
// CSS colours a bare <code> with --vscode-textPreformat-foreground (#d7ba7d on dark), which IR
// escapes only because its <code> sits under a class we colour ourselves. Nothing in the harness
// injects that stylesheet, so this is only observable here.
const FRESH_LANGS = [
  'graphviz',
  'smiles',
  'markmap',
  'echarts',
  'mindmap',
  'geojson',
  'stl',
]

// Two separate reads: the IR pane is display:none once Preview is up, so its metrics must be taken
// BEFORE the switch (a rect read afterwards is all zeroes).
const READ = (paneExpr: string) => `((langs) => {
  const v = window.vditor
  const root = ${paneExpr}
  const out = {}
  for (const lang of langs) {
    out[lang] = Array.from(root ? root.querySelectorAll('.language-' + lang) : [])
      .filter((el) => !el.closest('.vditor-ir__marker--pre, .vditor-wysiwyg__pre'))
      .map((el) => {
        const svg = el.querySelector('svg')
        const cv = el.querySelector('canvas')
        const leaflet = el.querySelector('.leaflet-container')
        return {
          drawn: !!(svg || cv || leaflet),
          size: svg
            ? svg.getAttribute('width') + 'x' + svg.getAttribute('height')
            : cv
              ? cv.width + 'x' + cv.height
              : leaflet
                ? Math.round(leaflet.clientWidth) + 'x' + Math.round(leaflet.clientHeight)
                : null,
          color: getComputedStyle(el).color,
        }
      })
  }
  return out
})(${JSON.stringify(FRESH_LANGS)})`

test('non-reused engines match across panes, and a round trip stays identical', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const frame = await open(workbox, evaluateInVSCode)

  // Sub-check 1 (was "engines that are NOT reused still draw the same in both panes") — the IR read
  // MUST happen before any switch (the IR pane goes display:none once Preview is up, and a rect
  // read afterwards is all zeroes), so this half of the merged test runs first.
  const ir = (await frame
    .locator('body')
    .evaluate(READ('v.vditor[v.getCurrentMode()].element'))) as Record<
    string,
    { drawn: boolean; size: string; color: string }[]
  >

  await frame.locator('body').evaluate(TO_PREVIEW)
  // task 451: was a blind 15s sleep — poll for the same render-readiness the read below needs.
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(renderReady('v.vditor.preview.previewElement')),
      {
        message:
          'Preview pane finished rendering every engine after the switch',
        timeout: 30_000,
      },
    )
    .toBe(true)
  const pv = (await frame
    .locator('body')
    .evaluate(READ('v.vditor.preview.previewElement'))) as typeof ir

  const problems: string[] = []
  let comparedFresh = 0
  for (const lang of FRESH_LANGS) {
    const a = (ir[lang] ?? []).filter((b) => b.drawn)
    const b = (pv[lang] ?? []).filter((b) => b.drawn)
    // An engine that drew in IR must draw in Preview too — "nothing equals nothing" must never pass.
    if (a.length !== b.length) {
      problems.push(
        `${lang}: drew ${a.length} in IR but ${b.length} in Preview`,
      )
      continue
    }
    a.forEach((blk, i) => {
      comparedFresh++
      if (blk.size !== b[i].size)
        problems.push(`${lang}#${i}: size ${blk.size} -> ${b[i].size}`)
      if (blk.color !== b[i].color)
        problems.push(`${lang}#${i}: colour ${blk.color} -> ${b[i].color}`)
    })
  }
  // stl needs WebGL and may legitimately draw nothing headless, so do not demand all 7 — but do
  // demand that most of them were actually measured, or this test proves nothing.
  expect
    .soft(comparedFresh, 'too few non-reused engines drew to compare')
    .toBeGreaterThan(4)
  expect
    .soft(problems, 'a non-reused engine differs between the panes')
    .toEqual([])

  // Sub-check 2 (was "a round trip IR → Preview → IR → Preview stays identical") — continues from
  // wherever the read above left off (already in Preview); the loop's own first TO_PREVIEW is a
  // harmless idempotent re-application.
  // task 451: each TO_PREVIEW settle was a blind 10s sleep — poll render-readiness instead. Each
  // TO_EDIT settle was a blind 2s sleep guarding nothing observable: TO_EDIT only flips `display`
  // back, it triggers no render — poll the SAME IR readiness anyway (cheap, near-instant once
  // content already exists) rather than dropping the wait outright, so a future TO_EDIT that DOES
  // start doing real work is still covered.
  for (let i = 0; i < 2; i++) {
    await frame.locator('body').evaluate(TO_PREVIEW)
    await expect
      .poll(
        () =>
          frame
            .locator('body')
            .evaluate(renderReady('v.vditor.preview.previewElement')),
        {
          message:
            'Preview pane finished rendering every engine after the switch',
          timeout: 30_000,
        },
      )
      .toBe(true)
    await frame.locator('body').evaluate(TO_EDIT)
    await expect
      .poll(
        () =>
          frame
            .locator('body')
            .evaluate(renderReady('v.vditor[v.getCurrentMode()].element')),
        {
          message:
            'IR pane still has its rendered content after switching back',
          timeout: 5_000,
        },
      )
      .toBe(true)
  }
  await frame.locator('body').evaluate(TO_PREVIEW)
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(renderReady('v.vditor.preview.previewElement')),
      {
        message:
          'Preview pane finished rendering every engine after the switch',
        timeout: 30_000,
      },
    )
    .toBe(true)

  const { ir: ir2, pv: pv2 } = (await frame.locator('body').evaluate(SNAP)) as {
    ir: Snap
    pv: Snap
  }
  const { compared, diffs } = compare(ir2, pv2)
  expect
    .soft(compared, 'round trip: too few pairs compared')
    .toBeGreaterThan(10)
  expect
    .soft(diffs, 'the panes drifted apart across repeated switching')
    .toEqual([])
})
