import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { type EvaluateInVSCode, wf } from './webview-helpers'

// Every Global key any case in this sweep writes (label-halo's theme.content, multiline-label's
// and parallel-lane's diagram.d2.layout, code-highlight's diagram.d2.theme/theme.content/
// theme.code). Case 7 (code-highlight) already resets its three keys itself before this was added
// (see its own comment); this is the safety net for a failure that happens before case 7's
// cleanup runs, and for diagram.d2.layout, which the sweep deliberately never reset (see case 5/6
// comments — writing the default value is a no-op WITHIN this test, but a real Global override
// all the same).
useSettingsRestore(test, [
  'vmarkd.theme.content',
  'vmarkd.diagram.d2.layout',
  'vmarkd.diagram.d2.theme',
  'vmarkd.theme.code',
])

// Task 511 cross-file boot merge. One shared VS Code boot for 7 D2 render-and-assert specs, none of
// which mutate a document and whose only settings mutations are either no-ops (equal to the
// default) or self-resetting. Donor files, IN THE RUN ORDER BELOW — the order is LOAD-BEARING, see
// case 7's comment and tasks/511-e2e-cross-file-shared-boot.md's "D2 audit" table:
//   1. d2-explicit-dimensions.spec.ts
//   2. d2-feature-parity.spec.ts
//   3. d2-imports.spec.ts
//   4. d2-label-halo.spec.ts
//   5. d2-multiline-label.spec.ts
//   6. d2-parallel-lane.spec.ts
//   7. d2-code-highlight.spec.ts (MUST run LAST — the only case that sets non-default settings
//      mid-test; it resets them itself, in a `finally`, before the sweep continues)
//
// D2's theme/engine-settings-driven tests — the MAJORITY of the family — could NOT be merged this
// way and were audited and excluded in that same table: `d2-container-edge`, `d2-md-content-theme`,
// `d2-content-theme-flip`, `d2-lazy-load`, `d2-sketch`, `d2-theme`, `d2-table-chrome`. Do not fold
// those in here; each has a documented, still-valid reason to stay isolated.

const FIXTURES = {
  explicitDimensions: path.join(
    __dirname,
    'fixtures',
    'd2-explicit-dimensions.md',
  ),
  allRenderers: path.join(__dirname, 'fixtures', 'all-renderers.md'),
  imports: path.join(__dirname, 'fixtures', 'd2-imports.md'),
  multilineLabel: path.join(__dirname, 'fixtures', 'd2-multiline-label.md'),
  parallelLane: path.join(__dirname, 'fixtures', 'd2-parallel-lane.md'),
  codeHighlight: path.join(__dirname, 'fixtures', 'd2-code-highlight.md'),
}

// Close-all + reopen a fresh fixture — same pattern as clipboard-elements.spec.ts's local `boot()`
// (task 450): a fresh close-all + reopen INSIDE the shared test(), not a new VS Code launch (that
// only happens once, at this test()'s own boot, task 448).
async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  fixture: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
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
    [fixture] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

// ---- case 1: d2-explicit-dimensions.spec.ts ------------------------------------------------

async function runExplicitDimensions(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(
    evaluateInVSCode,
    workbox,
    FIXTURES.explicitDimensions,
  )
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((resolve) => setTimeout(resolve, 4000)))

  const boxes = await frame
    .locator('.language-d2 svg')
    .first()
    .evaluate((svg) =>
      [...svg.querySelectorAll('rect')]
        .map((rect) => ({
          width: Number(rect.getAttribute('width')),
          height: Number(rect.getAttribute('height')),
        }))
        .filter(
          ({ width, height }) =>
            Number.isFinite(width) && Number.isFinite(height),
        ),
    )

  expect
    .soft(
      boxes,
      '[d2-explicit-dimensions] a 200x80 box reached the SVG unscaled',
    )
    .toContainEqual({ width: 200, height: 80 })
  expect
    .soft(
      boxes,
      '[d2-explicit-dimensions] a 20x10 box reached the SVG unscaled',
    )
    .toContainEqual({ width: 20, height: 10 })
}

// ---- case 2: d2-feature-parity.spec.ts ------------------------------------------------------
// Task 124 in the REAL VS Code webview — the renderer path the Playwright harness can't exercise
// (Vditor's .language-d2 + the real resource/CSP pipeline). Verifies the features that are
// SVG-structural (shape:text/code, connection styles + animation, shape:image, decorative icons,
// tooltip <title>) AND the one thing that is real-VS-Code-only: an SVG <a> link is intercepted by
// fixLinkClick on click (its href is an SVGAnimatedString — the bug fixed in utils.ts). Drives the
// section-18 D2 blocks in fixtures/all-renderers.md.

async function runFeatureParity(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.allRenderers)
  // d2 compiles via WASM + lays out + renders SVG asynchronously — wait for at least one, then settle.
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // Aggregate every rendered d2 SVG's markup; the section-18 blocks together exercise all features.
  const d2 = await frame.locator('body').evaluate(() => {
    const svgs = [...document.querySelectorAll('.language-d2 svg')]
    const html = svgs.map((s) => s.outerHTML).join('\n')
    return {
      svgCount: svgs.length,
      // shape:text / code (task 124 #2)
      hasTspan: /<tspan/.test(html),
      hasMonoFont: /font-family="ui-monospace/.test(html),
      // a STYLED text shape (|md| / text label + explicit fill) paints a box — real-d2 parity, not
      // borderless; regression: md-label nodes with a class fill were invisible on a dark theme.
      hasStyledTextBox: /fill="#2bd4a8"/.test(html),
      // connection styles (task 124 #1)
      hasRedStroke: /stroke="#e03131"/.test(html),
      hasDash: /stroke-dasharray=/.test(html),
      hasAnimClass: /class="d2-anim"/.test(html),
      hasAnimKeyframes: /@keyframes d2dash/.test(html),
      hasReducedMotion: /prefers-reduced-motion/.test(html),
      // shape:image + decorative icon (task 124 #3) — the fixture uses data: URIs
      imageCount: (html.match(/<image\b/g) || []).length,
      hasDataImg: /href="data:image\/svg\+xml/.test(html),
      // tooltip + link (task 124 #5)
      hasTooltip: /<title>The main API server<\/title>/.test(html),
      hasDbTooltip: /<title>Postgres 16<\/title>/.test(html),
      hasLinkAnchor: /<a[^>]*href="https:\/\/example\.com\/docs"/.test(html),
      // |md| markdown labels (task 154): the fixture's `notes:` block must render FORMATTED
      // (h1/strong/list/link inside a foreignObject) at a real on-screen size — not as the
      // literal `# Release checklist - **unit** …` flat text of the pre-154 renderer.
      mdLabel: (() => {
        // TWO |md| shapes render via foreignObject now: the styled `boxed` one (line ~619,
        // inline **bold** only) and the task-154 `notes:` block — select the latter BY CONTENT
        // (document.querySelector would return whichever comes first).
        const nodes = [
          ...document.querySelectorAll(
            '.language-d2 svg foreignObject .vmarkd-d2-md',
          ),
        ] as HTMLElement[]
        const md =
          nodes.find((n) =>
            (n.textContent ?? '').includes('Release checklist'),
          ) ?? null
        if (!md) return null
        const r = md.getBoundingClientRect()
        return {
          mdNodeCount: nodes.length, // boxed + notes = 2
          hasH1: !!md.querySelector('h1'),
          hasStrong: !!md.querySelector('strong'),
          hasListItem: !!md.querySelector('ul li'),
          hasRunbookLink: !!md.querySelector(
            'a[href="https://example.com/runbook"]',
          ),
          // The raw md markers must be GONE (formatted, not escaped-literal).
          rawMarkerLeak: /\*\*unit\*\*|^# /m.test(md.textContent ?? ''),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }
      })(),
      // Full GFM surface across ALL md nodes (the two showcase blocks): tables (||md fence),
      // blockquote, ordered list, strikethrough, GFM task-list checkboxes, indented code.
      mdGfm: (() => {
        const all = [
          ...document.querySelectorAll(
            '.language-d2 svg foreignObject .vmarkd-d2-md',
          ),
        ]
        const has = (sel: string) => all.some((n) => !!n.querySelector(sel))
        return {
          nodes: all.length,
          table: has('table thead th'),
          blockquote: has('blockquote em'),
          orderedList: has('ol li'),
          strikethrough: has('del'),
          taskCheckbox: has('li input[type="checkbox"][disabled]'),
          codeBlock: has('pre code'),
        }
      })(),
    }
  })
  console.log(`[d2-parity] ${JSON.stringify(d2, null, 2)}`)

  expect
    .soft(d2.svgCount, '[d2-parity] at least one d2 svg rendered')
    .toBeGreaterThan(0)
  // #2 text/code
  expect.soft(d2.hasTspan, '[d2-parity] hasTspan').toBe(true)
  expect.soft(d2.hasMonoFont, '[d2-parity] hasMonoFont').toBe(true)
  expect.soft(d2.hasStyledTextBox, '[d2-parity] hasStyledTextBox').toBe(true)
  // #1 connection styles + accessible animation
  expect.soft(d2.hasRedStroke, '[d2-parity] hasRedStroke').toBe(true)
  expect.soft(d2.hasDash, '[d2-parity] hasDash').toBe(true)
  expect.soft(d2.hasAnimClass, '[d2-parity] hasAnimClass').toBe(true)
  expect.soft(d2.hasAnimKeyframes, '[d2-parity] hasAnimKeyframes').toBe(true)
  expect.soft(d2.hasReducedMotion, '[d2-parity] hasReducedMotion').toBe(true)
  // #3 image + icon
  expect.soft(d2.imageCount, '[d2-parity] imageCount').toBeGreaterThan(0)
  expect.soft(d2.hasDataImg, '[d2-parity] hasDataImg').toBe(true)
  // #5 tooltip + link
  expect.soft(d2.hasTooltip, '[d2-parity] hasTooltip').toBe(true)
  expect.soft(d2.hasDbTooltip, '[d2-parity] hasDbTooltip').toBe(true)
  expect.soft(d2.hasLinkAnchor, '[d2-parity] hasLinkAnchor').toBe(true)
  // task 154: |md| label renders formatted, at a real size, with no raw md markers
  expect
    .soft(d2.mdLabel, '[d2-parity] md-label foreignObject present')
    .not.toBeNull()
  expect
    .soft(d2.mdLabel?.mdNodeCount, '[d2-parity] mdNodeCount')
    .toBeGreaterThanOrEqual(2) // boxed + notes both formatted
  expect.soft(d2.mdLabel?.hasH1, '[d2-parity] mdLabel hasH1').toBe(true)
  expect.soft(d2.mdLabel?.hasStrong, '[d2-parity] mdLabel hasStrong').toBe(true)
  expect
    .soft(d2.mdLabel?.hasListItem, '[d2-parity] mdLabel hasListItem')
    .toBe(true)
  expect
    .soft(d2.mdLabel?.hasRunbookLink, '[d2-parity] mdLabel hasRunbookLink')
    .toBe(true)
  expect
    .soft(d2.mdLabel?.rawMarkerLeak, '[d2-parity] mdLabel rawMarkerLeak')
    .toBe(false)
  expect.soft(d2.mdLabel?.w, '[d2-parity] mdLabel width').toBeGreaterThan(60)
  expect.soft(d2.mdLabel?.h, '[d2-parity] mdLabel height').toBeGreaterThan(40)
  // GFM surface (showcase blocks): every feature class renders somewhere in the md nodes.
  expect
    .soft(d2.mdGfm.nodes, '[d2-parity] mdGfm nodes')
    .toBeGreaterThanOrEqual(6) // boxed+notes+matrix+review+checklist+snippet
  expect.soft(d2.mdGfm.table, '[d2-parity] mdGfm table').toBe(true)
  expect.soft(d2.mdGfm.blockquote, '[d2-parity] mdGfm blockquote').toBe(true)
  expect.soft(d2.mdGfm.orderedList, '[d2-parity] mdGfm orderedList').toBe(true)
  expect
    .soft(d2.mdGfm.strikethrough, '[d2-parity] mdGfm strikethrough')
    .toBe(true)
  expect
    .soft(d2.mdGfm.taskCheckbox, '[d2-parity] mdGfm taskCheckbox')
    .toBe(true)
  expect.soft(d2.mdGfm.codeBlock, '[d2-parity] mdGfm codeBlock').toBe(true)

  // The real-VS-Code-only check: clicking the SVG <a> must be intercepted by fixLinkClick (it reads
  // the href off an SVGAnimatedString and preventDefaults so the panel never navigates). A plain click
  // always preventDefaults once the anchor+href is found, regardless of the edit/modifier policy.
  const click = await frame.locator('body').evaluate(() => {
    const a = document.querySelector(
      '.language-d2 svg a[href="https://example.com/docs"]',
    ) as SVGAElement | null
    if (!a) return { found: false, defaultPrevented: false }
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(ev)
    return { found: true, defaultPrevented: ev.defaultPrevented }
  })
  console.log(`[d2-parity] link click: ${JSON.stringify(click)}`)
  expect.soft(click.found, '[d2-parity] svg anchor found').toBe(true)
  expect
    .soft(
      click.defaultPrevented,
      '[d2-parity] fixLinkClick caught the SVG anchor',
    )
    .toBe(true) // routed to host
}

// ---- case 3: d2-imports.spec.ts --------------------------------------------------------------
// Task 131 in the REAL webview. D2 composes diagrams from sibling FILES (`...@partials/header`,
// `k: @file`); we compile one fenced block through a filesystem-less WASM, so the target can never
// resolve. That already failed SAFE — raw source stayed visible — it just never said why, so it read
// as "the renderer is broken" instead of "this construct cannot work here". The source is checked
// BEFORE compiling and routed through the same loud fallback the other unsupported D2 constructs
// use. The third block in the fixture is self-contained and MUST still render: the detector's real
// risk is a false positive replacing a working diagram with a note, strictly worse than the generic
// compile error it replaces.

async function runImports(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.imports)

  const readBlocks = () =>
    frame.locator('body').evaluate(() => {
      const blocks = [
        ...document.querySelectorAll('.vditor-ir__preview .language-d2'),
      ]
      return {
        unsupported: blocks.filter((b) => b.hasAttribute('data-d2-unsupported'))
          .length,
        rendered: blocks.filter((b) => b.querySelector('svg')).length,
      }
    })

  await expect
    .poll(readBlocks, { timeout: 60_000, intervals: [1000, 2000, 3000] })
    .toMatchObject({ unsupported: 2, rendered: 1 })
    .catch(() => {
      // best-effort (task 450's paste-sweep pattern): a timeout here must NOT throw and abort the
      // whole D2 sweep before the soft assertion below gets to report it with real diagnostics —
      // that would cost every case scheduled after this one its result.
    })
  const blockCounts = await readBlocks()
  expect
    .soft(blockCounts, '[d2-imports] unsupported/rendered block counts')
    .toMatchObject({ unsupported: 2, rendered: 1 })

  const state = await frame.locator('body').evaluate(() => {
    const blocks = [
      ...document.querySelectorAll('.vditor-ir__preview .language-d2'),
    ]
    const flagged = blocks.filter((b) => b.hasAttribute('data-d2-unsupported'))
    return {
      notes: flagged.map(
        (b) => b.querySelector('.d2-unsupported-note')?.textContent ?? '',
      ),
      // The point of a loud fallback: the user can still read and copy what they wrote.
      sourceKept: flagged.every((b) =>
        (
          b.querySelector('pre.language-d2-unsupported')?.textContent ?? ''
        ).includes('service -> db'),
      ),
      // A stated non-support must NOT be reported as a compile failure — that is the confusion
      // this task exists to remove.
      anyCompileError: flagged.some((b) => b.hasAttribute('data-d2-error')),
    }
  })

  expect
    .soft(state.notes[0], '[d2-imports] spread-import note')
    .toContain('...@file spread')
  expect
    .soft(state.notes[1], '[d2-imports] key-import note')
    .toContain('key: @file')
  for (const n of state.notes)
    expect
      .soft(n, '[d2-imports] inline hint present')
      .toContain('inline the imported content')
  expect
    .soft(state.sourceKept, '[d2-imports] the raw source stays readable')
    .toBe(true)
  expect
    .soft(state.anyCompileError, '[d2-imports] not reported as a compile error')
    .toBe(false)
}

// ---- case 4: d2-label-halo.spec.ts -----------------------------------------------------------
// NET — a d2 connection label must not be cut in half by its own line. Reported: "w preview na d2
// labelki na diagramach są przecinane linią jakby tło miało przezroczyste". d2's own renderer draws
// a background rect behind edge labels; ours emitted a bare <text>, so any route passing under a
// label ran straight through the glyphs. The panes were NOT the problem — they are byte-identical
// since the render reuse (measured: all 12 d2 blocks cache-hit, zero markup diffs), so the label was
// cut in IR too; Preview is just where it gets read. The fix is in the SVG we emit.
//
// Sets `theme.content='auto'` GLOBALLY with no reset — this equals the DEFAULT, so per task 511's
// rule 3b it is a no-op for every other case in this sweep and does not need resetting.

type LabelHaloRead = {
  total: number
  edge: number
  haloed: number
  stroke: string | null
  keepsFill: boolean
  edgeFill: string | null
  nodeFill: string | null
}

// Edge labels are the italic ones (d2 draws connection labels in N2 italic); node labels are upright
// and sit inside a filled shape, so they need no halo and must not be required to have one.
const LABEL_HALO_READ = `(() => {
  const root = window.vditor.vditor.ir.element
  const texts = Array.from(root.querySelectorAll('.language-d2 svg text'))
    .filter((t) => !t.closest('.vditor-ir__marker--pre'))
  const edge = texts.filter((t) => (t.getAttribute('font-style') || '') === 'italic')
  // A node label: upright, sits inside a shape (not italic, no paint-order halo) — task 421's
  // reference colour ("same as the box labels" per the user report).
  const node = texts.find((t) => (t.getAttribute('font-style') || '') !== 'italic'
    && t.getAttribute('paint-order') !== 'stroke')
  return {
    total: texts.length,
    edge: edge.length,
    haloed: edge.filter((t) => t.getAttribute('paint-order') === 'stroke').length,
    stroke: edge[0] ? edge[0].getAttribute('stroke') : null,
    // The halo must sit UNDER the glyph fill, or it would smear the text.
    keepsFill: edge.every((t) => !!t.getAttribute('fill')),
    edgeFill: edge[0] ? edge[0].getAttribute('fill') : null,
    nodeFill: node ? node.getAttribute('fill') : null,
  }
})()`

async function runLabelHalo(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'auto', vscode.ConfigurationTarget.Global)
  })
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.allRenderers)

  // Poll instead of a fixed delay (task 419's class of flake — this spec recurred with the same
  // fixed-settle symptom during the 2026-07-28 session: failed attempt 1, passed on retry, under
  // both contended and briefly-quiet machine load). The fixture renders a dozen d2 blocks
  // concurrently; there is no fixed delay that is both fast and reliable.
  let r: LabelHaloRead = {
    total: 0,
    edge: 0,
    haloed: 0,
    stroke: null,
    keepsFill: false,
    edgeFill: null,
    nodeFill: null,
  }
  await expect
    .poll(
      async () => {
        r = (await frame
          .locator('body')
          .evaluate(LABEL_HALO_READ)) as LabelHaloRead
        return r.edge
      },
      {
        timeout: 90_000,
        message: '[d2-label-halo] no d2 connection labels ever rendered',
      },
    )
    .toBeGreaterThan(5)
    .catch(() => {
      // best-effort — see the imports case's comment above for why this must not throw here.
    })

  expect
    .soft(
      r.haloed,
      '[d2-label-halo] a connection label had no halo — the line can cut through it',
    )
    .toBe(r.edge)
  expect
    .soft(
      r.keepsFill,
      '[d2-label-halo] the halo replaced the label fill instead of sitting under it',
    )
    .toBe(true)
  // Transparent-canvas themes have no bg colour of their own, so the halo must follow the SURFACE
  // the page paints — --vmarkd-page-bg, with the editor background as the `auto` fallback. Using
  // the editor colour directly put a dark halo on a light github page (task 394).
  expect
    .soft(r.stroke, '[d2-label-halo] halo follows the page surface colour')
    .toBe('var(--vmarkd-page-bg, var(--vscode-editor-background, transparent))')
  // Task 421 — "kolor labelek na liniach powinien być taki sam jak kolor labelek w boxach": a
  // connection label must paint in the SAME fill as a node label, not d2's own dimmer N2 token.
  expect
    .soft(
      r.nodeFill,
      '[d2-label-halo] no upright node label found to compare against',
    )
    .not.toBeNull()
  expect
    .soft(
      r.edgeFill,
      '[d2-label-halo] connection label matches node label fill',
    )
    .toBe(r.nodeFill)
}

// ---- case 5: d2-multiline-label.spec.ts ------------------------------------------------------
// Task 493, in the REAL webview: the d2 compiler keeps a real newline inside a label and d2 itself
// draws one row per line, but SVG <text> does not break on \n — so a 2-line label used to be drawn
// as ONE run, wider than the box canvasMeasure had already sized for the widest line, spilling out
// of the shape. The payoff assertion here is geometric and only meaningful in a real renderer:
// measure each label's laid-out bbox and require a shape box to CONTAIN it. A unit test can count
// <tspan>s; only a browser can say the text fits.
//
// Pins the DEFAULT engine (`diagram.d2.layout='vmarkd'`) explicitly — the setting is Global and
// persists in the test profile, so per task 511's rule 3b this is a no-op for every other
// default-assuming case in the sweep and needs no reset.

async function readD2Ready(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    // IR is dual-node: the editable SOURCE <code class="language-d2"> also carries the class and
    // comes first in the document — scan for the wrapper that actually holds the render.
    const w = [...document.querySelectorAll('.language-d2')].find(
      (n) => n.querySelector('svg') || n.hasAttribute('data-d2-error'),
    )
    return {
      hasSvg: !!w?.querySelector('svg'),
      err: w?.getAttribute('data-d2-error') ?? null,
    }
  })
}

async function runMultilineLabel(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('diagram.d2.layout', 'vmarkd', vscode.ConfigurationTarget.Global)
  })
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.multilineLabel)

  await expect
    .poll(() => readD2Ready(frame), {
      timeout: 60_000,
      intervals: [1000, 2000, 3000],
    })
    .toMatchObject({ hasSvg: true, err: null })
    .catch(() => {
      // best-effort — see d2-imports's comment above for why this must not throw here.
    })
  const ready = await readD2Ready(frame)
  expect
    .soft(ready, '[d2-multiline-label] the block rendered without a d2 error')
    .toMatchObject({ hasSvg: true, err: null })

  const shot = await frame.locator('body').evaluate(() => {
    const wrap = [...document.querySelectorAll('.language-d2')].find((n) =>
      n.querySelector('svg'),
    )!
    const svg = wrap.querySelector('svg')!
    const texts = [...svg.querySelectorAll('text')]
    const rows = (t: SVGTextElement) => [...t.querySelectorAll('tspan')]
    // Laid-out boxes of everything that can BE a shape outline (the label has to sit in one of them).
    const boxes = [...svg.querySelectorAll('rect, ellipse, path, polygon')].map(
      (n) => (n as SVGGraphicsElement).getBBox(),
    )
    // 2px slack: stroke width + sub-pixel text metrics, nothing near a spilling label's overhang.
    const fits = (b: SVGRect) =>
      boxes.some(
        (r) =>
          b.x >= r.x - 2 &&
          b.y >= r.y - 2 &&
          b.x + b.width <= r.x + r.width + 2 &&
          b.y + b.height <= r.y + r.height + 2,
      )
    // Everything the assertions need about the label whose FIRST row reads `first`.
    const label = (first: string) => {
      const t = texts.find((x) => rows(x)[0]?.textContent === first)
      if (!t) return { rows: null, fits: false, gap: 0 }
      const rs = rows(t)
      const y = (i: number) => Number(rs[i]?.getAttribute('y') || 0)
      return {
        rows: rs.map((s) => s.textContent || ''),
        fits: fits(t.getBBox()),
        gap: y(1) - y(0),
      }
    }
    return {
      // The pre-493 signature: the raw \n still sitting in a single text run (SVG renders it as a
      // space, so the label reads as one over-wide line). After the fix each line is its own tspan.
      joined: texts
        .map((t) => t.textContent || '')
        .filter((s) => s.includes('\n')),
      mb: label('Dedicated mailbox'),
      m2: label('Module 2 — message decomposition'),
      edge: label('needs_info'),
      header: label('Module 1 — mailbox ingest'),
    }
  })

  expect
    .soft(shot.joined, '[d2-multiline-label] no label left as a single run')
    .toEqual([])
  expect
    .soft(shot.mb.rows, '[d2-multiline-label] mailbox label rows')
    .toEqual(['Dedicated mailbox', 'Exchange Online'])
  expect
    .soft(shot.m2.rows, '[d2-multiline-label] module 2 label rows')
    .toEqual([
      'Module 2 — message decomposition',
      'decompose, identify, pseudonymise, segment',
    ])
  expect
    .soft(shot.edge.rows, '[d2-multiline-label] edge label rows')
    .toEqual(['needs_info', 'ask_bradbury', 'nothing_new'])
  expect
    .soft(shot.header.rows, '[d2-multiline-label] header label rows')
    .toEqual(['Module 1 — mailbox ingest', 'fetch, deduplicate, queue'])
  // The real point: each block of rows fits INSIDE a drawn shape (this is what regressed).
  expect
    .soft(
      shot.mb.fits,
      '[d2-multiline-label] cylinder label inside the cylinder',
    )
    .toBe(true)
  expect
    .soft(
      shot.m2.fits,
      '[d2-multiline-label] the widest 2-line label inside its box',
    )
    .toBe(true)
  expect
    .soft(
      shot.header.fits,
      '[d2-multiline-label] container header inside the container',
    )
    .toBe(true)
  // The 3-row edge label is drawn beside the line, not in a box — assert its row spacing instead:
  // the 14px edge font at the 1.25 factor canvasMeasure sizes with.
  expect
    .soft(shot.edge.gap, '[d2-multiline-label] edge label row spacing')
    .toBeCloseTo(17.5, 1)
}

// ---- case 6: d2-parallel-lane.spec.ts ---------------------------------------------------------
// Task 494, in the REAL webview: two edges' parallel runs were left ~11 px apart (measured on the
// reported document) and read as one thick line. `spreadCloseRuns` pushes them back to the 24 px
// lane ELK itself reserves — but `toSVG` runs `simplifyRoute` + `straightenEnds` AGAIN at draw time,
// and those only reject a straightening that CROSSES something. So the unit tests prove the pass
// fires; only a measurement on the RENDERED SVG proves the spread survives to the screen. The
// measured value before the fix was 10.9 px and after it 23.8 (a 24 px lane, minus sampling error);
// 20 sits clear of both, so the assertion cannot flip on rounding.
//
// Pins the DEFAULT engine — same rule-3b no-op reasoning as the multiline-label case above.

const D2_PARALLEL_LANE_MIN_GAP = 20

async function runParallelLane(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  // A straight, axis-aligned stretch of one connection: its constant coordinate plus its extent.
  type Run = { path: number; vert: boolean; c: number; lo: number; hi: number }
  const MINRUN = 60 // only stretches long enough to READ as parallel
  // Identity of the straight run a sampled step belongs to; null on a corner arc, which ends the run.
  const runKey = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) < 0.4
      ? `v${a[0].toFixed(1)}`
      : Math.abs(a[1] - b[1]) < 0.4
        ? `h${a[1].toFixed(1)}`
        : null
  // Sampled points of one path → its long straight runs. The page hands back raw samples (it has
  // to, only the browser can walk an SVG path); the analysis stays here, in ordinary testable code.
  function runsOf(pts: number[][], pathIdx: number): Run[] {
    const out: Run[] = []
    let key: string | null = null
    let from = 0
    const close = (to: number) => {
      if (!key) return
      const vert = key[0] === 'v'
      const k = vert ? 1 : 0
      const lo = Math.min(pts[from][k], pts[to][k])
      const hi = Math.max(pts[from][k], pts[to][k])
      if (hi - lo > MINRUN)
        out.push({ path: pathIdx, vert, c: pts[from][vert ? 0 : 1], lo, hi })
      key = null
    }
    for (let i = 1; i < pts.length; i++) {
      const k = runKey(pts[i - 1], pts[i])
      if (k === key) continue
      close(i - 1)
      key = k
      from = i - 1
    }
    close(pts.length - 1)
    return out
  }
  const overlap = (a: Run, b: Run) =>
    Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)
  // The gap between two runs IF they're an eligible parallel pair (different connections, same
  // axis, overlapping for long enough) — null otherwise. Split out of closestPair so the nested
  // search loop below stays under the cognitive-complexity budget.
  const pairGap = (a: Run, b: Run): number | null => {
    if (a.path === b.path || a.vert !== b.vert) return null
    if (overlap(a, b) < MINRUN) return null
    return Math.abs(a.c - b.c)
  }
  // The closest pair of parallel runs belonging to DIFFERENT connections.
  function closestPair(runs: Run[]): { gap: number; a: Run; b: Run } | null {
    let worst: { gap: number; a: Run; b: Run } | null = null
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const gap = pairGap(runs[i], runs[j])
        if (gap === null) continue
        if (!worst || gap < worst.gap) worst = { gap, a: runs[i], b: runs[j] }
      }
    }
    return worst
  }

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('diagram.d2.layout', 'vmarkd', vscode.ConfigurationTarget.Global)
  })
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.parallelLane)

  await expect
    .poll(() => readD2Ready(frame), {
      timeout: 60_000,
      intervals: [1000, 2000, 3000],
    })
    .toMatchObject({ hasSvg: true, err: null })
    .catch(() => {
      // best-effort — see d2-imports's comment above for why this must not throw here.
    })
  const ready = await readD2Ready(frame)
  expect
    .soft(ready, '[d2-parallel-lane] the block rendered without a d2 error')
    .toMatchObject({ hasSvg: true, err: null })

  // The page can only hand back GEOMETRY: sample every connection path (2px steps) rather than
  // parsing its `d` — the routes carry rounded (Q) corners, so a command-level parse silently
  // misses the straight run that FOLLOWS a corner (that mistake hid this very pair while the
  // geometry was being diagnosed).
  const sampled: number[][][] = await frame.locator('body').evaluate(() => {
    const wrap = [...document.querySelectorAll('.language-d2')].find((n) =>
      n.querySelector('svg'),
    )!
    const svg = wrap.querySelector('svg')!
    return [...svg.querySelectorAll('path')].map((p) => {
      const len = p.getTotalLength()
      const pts: number[][] = []
      for (let l = 0; l <= len; l += 2) {
        const q = p.getPointAtLength(l)
        pts.push([Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10])
      }
      return pts
    })
  })

  const runs = sampled.flatMap((pts, i) =>
    pts.length < 10 ? [] : runsOf(pts, i),
  )
  const worst = closestPair(runs)
  const shot = {
    runs: runs.length,
    worstGap: worst ? Math.round(worst.gap * 10) / 10 : null,
    worstPair: worst
      ? `${worst.a.vert ? 'x' : 'y'}=${worst.a.c.toFixed(1)} / ${worst.b.c.toFixed(1)}`
      : null,
  }

  // A vacuous pass would be the real risk here, so pin that the diagram HAS long parallel runs to compare.
  expect
    .soft(
      shot.runs,
      '[d2-parallel-lane] the diagram has long axis-aligned runs to measure',
    )
    .toBeGreaterThan(10)
  expect
    .soft(
      shot.worstGap,
      `[d2-parallel-lane] closest parallel pair (${shot.worstPair}) must keep a lane`,
    )
    .toBeGreaterThanOrEqual(D2_PARALLEL_LANE_MIN_GAP)
}

// ---- case 7: d2-code-highlight.spec.ts (MUST run LAST) -----------------------------------------
// The only case in this sweep that sets NON-default settings mid-test (`diagram.d2.theme='auto'`,
// `theme.code='auto'` — task 516, see below — `theme.content='github-dark'`, then later
// `theme.content='material-dark'`). Ordering it last means nothing else in the sweep ever
// observes the non-default state; cleanup for all three keys is now handled by the
// `useSettingsRestore` afterEach declared at the top of this file (used to be a manual `finally`
// reset here — the helper subsumes it, including the failure case). Do NOT reorder this case
// ahead of the others.

type CodeShapeState = { tokens: number; fill: string }

async function codeShapeState(
  frame: ReturnType<typeof wf>,
): Promise<CodeShapeState> {
  return frame
    .locator('.language-d2 svg')
    .first()
    .evaluate((svg) => {
      const tokens = [
        ...svg.querySelectorAll<SVGTSpanElement>('tspan[class*="hljs-"]'),
      ]
      const first = tokens[0]
      return {
        tokens: tokens.length,
        fill: first ? getComputedStyle(first).fill : '',
      }
    })
}

async function runCodeHighlight(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    const cfg = vscode.workspace.getConfiguration('vmarkd')
    await cfg.update('diagram.d2.theme', 'auto', true)
    await cfg.update('theme.content', 'github-dark', true)
    // Task 516 root cause — this case's WHOLE assertion is "the code-shape token colour follows
    // `theme.content`'s PAIRED hljs style" (resolveCodeStyle: an explicit, non-'auto' `theme.code`
    // wins outright and makes a content-theme flip a no-op for this colour, regardless of how long
    // you poll). `theme.code` was left at its ambient value here — normally 'auto', the default,
    // so this held silently — but a FULL-SUITE run shares one VS Code profile across every spec
    // (`vscode-test-playwright` copies `process.env`/the temp dir once per WORKER, not per test),
    // and `caret-empty-typing.spec.ts` sets `theme.code='a11y-light'` via
    // `ConfigurationTarget.Global` and never resets it. When that spec runs before this one in the
    // same worker, this case silently inherited the pin: reproduced deterministically (task 516,
    // zero timing/contention involved) — `before.fill` and `after.fill` both read a11y-light's own
    // #7928a1 = `rgb(121, 40, 161)`, the exact value from the reported flake, and `after` never
    // differs from `before` no matter how long the poll below runs. Pinning `theme.code` to 'auto'
    // here — explicitly, not by assumption — makes this case self-sufficient regardless of what any
    // other spec in the suite leaks.
    await cfg.update('theme.code', 'auto', true)
  })
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.codeHighlight)
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })

  await expect
    .poll(async () => (await codeShapeState(frame)).tokens, {
      timeout: 30_000,
    })
    .toBeGreaterThan(1)
    .catch(() => {
      // best-effort — see d2-imports's comment above for why this must not throw here.
    })
  const before = await codeShapeState(frame)
  expect
    .soft(before.tokens, '[d2-code-highlight] hljs tokens present')
    .toBeGreaterThan(1)
  expect
    .soft(before.fill, '[d2-code-highlight] token fill resolved')
    .not.toBe('')

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'material-dark', true)
  })
  await expect
    .poll(async () => (await codeShapeState(frame)).fill, { timeout: 45_000 })
    .not.toBe(before.fill)
    .catch(() => {
      // best-effort — see d2-imports's comment above for why this must not throw here.
    })
  const after = await codeShapeState(frame)
  expect
    .soft(
      after.fill,
      '[d2-code-highlight] token fill followed the content-theme flip',
    )
    .not.toBe(before.fill)
}

test('D2 render sweep: dimensions, feature parity, imports, label halo, multiline labels, parallel lanes, code highlight', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // 7 cases, each a real D2 WASM compile + ELK layout render with its own geometry-settle waits
  // (some up to 90s). Sized off the sum of the 7 donor files' own test.setTimeout values (90s
  // default x2 + 120s x3 + 180s x2 = 900s) plus headroom for the extra close-all + reopen boot()
  // between every case. Generous on purpose (task 450's post-merge correction): an under-sized
  // merged test can be killed mid-loop by Playwright's own timeout, which would silently drop the
  // expect.soft() reports for every case scheduled after that point — exactly the failure-isolation
  // loss expect.soft() exists to avoid.
  test.setTimeout(1_200_000)

  await runExplicitDimensions(evaluateInVSCode, workbox)
  await runFeatureParity(evaluateInVSCode, workbox)
  await runImports(evaluateInVSCode, workbox)
  await runLabelHalo(evaluateInVSCode, workbox)
  await runMultilineLabel(evaluateInVSCode, workbox)
  await runParallelLane(evaluateInVSCode, workbox)
  // MUST run last — see the comment on runCodeHighlight above.
  await runCodeHighlight(evaluateInVSCode, workbox)
})
