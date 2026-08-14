import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// NET+PROBE (task 190 P1) — a VS Code theme flip must (a) re-colour the diagram engines and
// (b) NOT duplicate or drop any render (the same "a global re-render event corrupts family Y"
// class task 189 caught for edits, here on the theme-flip trigger, across all 14 families —
// including plantuml/graphviz/abc/markmap/smiles/mindmap whose dark path had no coverage).
// Flipping workbench.colorTheme fires onDidChangeActiveColorTheme → set-theme → rethemeDiagrams.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const LANGS = [
  'mermaid',
  'echarts',
  'mindmap',
  'markmap',
  'flowchart',
  'graphviz',
  'plantuml',
  'abc',
  'smiles',
  'wavedrom',
  'nomnoml',
  'd2',
  'vega-lite',
  'geojson',
] as const

// Per-family census (counts) + a colour digest (every fill/stroke attr under the family's
// elements). Counts guard against dup/lost renders; the digest detects a re-colour.
const CENSUS = `(() => {
  const pv = document.querySelector('.vditor-preview, .vditor-ir') || document.body
  const out = {}
  let colours = ''
  for (const lang of ${JSON.stringify(LANGS)}) {
    const els = [...pv.querySelectorAll('.language-' + lang)]
    out[lang] = {
      els: els.length,
      svgs: pv.querySelectorAll('.language-' + lang + ' svg').length,
      canvases: pv.querySelectorAll('.language-' + lang + ' canvas').length,
    }
    for (const el of els)
      for (const n of el.querySelectorAll('[fill],[stroke]'))
        colours += (n.getAttribute('fill')||'') + (n.getAttribute('stroke')||'') + ';'
  }
  return { out, colourLen: colours.length, colourDigest: colours.slice(0, 4000) }
})()`

// PRECONDITION: the content theme must FOLLOW the editor ('auto') — this spec asserts that a
// workbench flip re-colours the engines, which only holds when the flip moves the webview
// foreground. Sibling specs (echarts-theme, d2-theme, …) PIN `theme.content` globally and never
// restore it, so in a full-suite run this spec would otherwise inherit a pinned theme, the flip
// would legitimately re-colour nothing, and assertion (b) would fail on the product's correct
// behaviour. Pinned here so the spec does not depend on what ran before it — never changed again
// mid-test, unlike `workbench.colorTheme` below.
usePinnedSettings(test, {
  'vmarkd.theme.content': 'auto',
})
// `workbench.colorTheme` and `vmarkd.diagram.d2.layout` are flipped mid-test (the theme flip and
// the D2-cache-scope change are the behaviour under test), so they can't be pinned — just declare
// them for cleanup.
useSettingsRestore(test, ['workbench.colorTheme', 'vmarkd.diagram.d2.layout'])

test('a theme flip re-colours engines without duplicating or dropping any render', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  // Set the WORKBENCH theme before opening too (task 436). The two flips below now mean
  // something specific — the first is a no-op, the second a real light/dark change — and that
  // only holds if the starting theme is known. Global config persists in the test profile
  // between runs, so without this the document could open in either mode.
  //
  // Set it BEFORE opening the document, not after: a content-theme switch triggers the mono
  // re-theme, and reRenderLang clears a block (innerHTML='') before re-rendering it. Landing that on
  // a block whose FIRST render hasn't finished throws away the only copy of its source, and the
  // block stays empty forever — observed with the two slowest WASM engines (graphviz's Viz.js and
  // plantuml's TeaVM), which then never drew at all, even given 120s.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Dark Modern',
        vscode.ConfigurationTarget.Global,
      )
  })
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
  await frame
    .locator('.vditor-ir .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const census = () =>
    frame
      .locator('body')
      .evaluate(
        (_b, src) => new Function(`return ${src}`)(),
        CENSUS,
      ) as Promise<{
      out: Record<string, { els: number; svgs: number; canvases: number }>
      colourLen: number
      colourDigest: string
    }>

  // Task 412's viewport gate (diagram-retheme.ts's gateAndRender) defers ECharts/mindmap, the mono
  // SVG group (plantuml/graphviz/abc/wavedrom/nomnoml), geo, and D2 re-renders for anything more than
  // 200px outside the viewport, queuing them on a shared IntersectionObserver instead. all-renderers.md
  // is a long, many-section fixture — every family below the first couple of sections sits well
  // outside a ~786px window at document-top (task 475's own measurement: mermaid/echarts already
  // 1800-2557px in by section 3-5) — so without scrolling through the document, every deferred family's
  // "after" census would just be its STALE pre-flip render, not a real re-colour. Scroll every
  // diagram instance (not just the first-of-lang — several langs have >1 copy in this fixture, e.g.
  // 12 D2 blocks, 2 mermaid, 4 wavedrom) into view in turn so each one's IntersectionObserver entry
  // actually fires before the viewport moves past it again (a single bulk pass of back-to-back
  // scrollIntoView calls does not give the observer time to fire on the earlier elements — see
  // d2-content-theme-flip.spec.ts's identical fix, measured there).
  const scrollEveryDiagramIntoView = async () => {
    const count = await frame.locator('body').evaluate(
      (_b, langs: string[]) => {
        const pv =
          document.querySelector('.vditor-preview, .vditor-ir') || document.body
        return pv.querySelectorAll(langs.map((l) => `.language-${l}`).join(','))
          .length
      },
      LANGS as unknown as string[],
    )
    for (let i = 0; i < count; i++) {
      await frame.locator('body').evaluate(
        (_b, args) => {
          const { langs, idx } = args as { langs: string[]; idx: number }
          const pv =
            document.querySelector('.vditor-preview, .vditor-ir') ||
            document.body
          const els = pv.querySelectorAll(
            langs.map((l) => `.language-${l}`).join(','),
          )
          ;(els[idx] as HTMLElement | undefined)?.scrollIntoView({
            block: 'center',
          })
        },
        { langs: LANGS as unknown as string[], idx: i },
      )
      await frame
        .locator('body')
        .evaluate(() => new Promise((r) => setTimeout(r, 120)))
    }
  }

  const setTheme = async (name: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('workbench')
          .update('colorTheme', args[0], vscode.ConfigurationTarget.Global)
      },
      [name] as [string],
    )
    await scrollEveryDiagramIntoView()
    // rAF + 400ms deferral + foreground polling (~2s) + engine re-render.
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 4000)))
  }

  // Every family must have FINISHED its first render before the baseline census, or a slow engine
  // reads as "never rendered" and the drop check below compares against a bogus zero. graphviz is the
  // straggler (Viz.js WASM cold start, deliberately excluded from the offscreen path) and misses a
  // fixed wait under full-suite load. Poll instead of sleeping longer.
  await expect
    .poll(
      async () => {
        const c = await census()
        return LANGS.filter((l) => c.out[l].svgs + c.out[l].canvases === 0)
      },
      { timeout: 120_000, intervals: [1000, 2000, 3000] },
    )
    .toEqual([])

  // Task 411 — how many D2 blocks the engine actually compiled. The double-fire was invisible in
  // the DOM (both fires produce the same SVG, the second overwriting the first), so the census
  // above could never have caught it; this counter can.
  // `targets` is counted with the selector the ENGINE walks (findBlocks' code→div render targets),
  // NOT the census's `.language-d2`, which also matches the editable <code> marker of every block
  // and so reports exactly double.
  const d2Colours = () =>
    frame.locator('body').evaluate(() => {
      let c = ''
      for (const n of document.querySelectorAll(
        '.vditor-ir div.language-d2 [fill],.vditor-ir div.language-d2 [stroke]',
      ))
        c += `${n.getAttribute('fill') ?? ''}${n.getAttribute('stroke') ?? ''};`
      return c
    })
  const d2Probe = () =>
    frame.locator('body').evaluate(() => ({
      compiles:
        (
          window as unknown as {
            __vmarkdD2RenderStats?: { compiles: number }
          }
        ).__vmarkdD2RenderStats?.compiles ?? -1,
      targets: document.querySelectorAll('.vditor-ir div.language-d2').length,
    }))

  const d2Before = (await d2Probe()).compiles
  await setTheme('Default Dark Modern')
  const dark = await census()
  const coloursDark = await d2Colours()
  const first = await d2Probe()
  const d2AfterFirst = first.compiles
  await setTheme('Default Light Modern')
  const light = await census()
  const d2AfterSecond = (await d2Probe()).compiles
  const coloursAfter = await d2Colours()

  // The flip must re-render each D2 block EXACTLY once. Was: twice per flip (an unconditional rAF
  // leg AND a setTimeout(400) leg), i.e. two WASM compiles + layouts per diagram per flip, the
  // first painted with the pre-flip palette and immediately overwritten.
  const d2Blocks = first.targets
  expect(d2Blocks, 'the fixture has D2 blocks to count').toBeGreaterThan(0)
  expect(d2Before, 'the D2 render counter is exposed').toBeGreaterThanOrEqual(0)
  // eslint-disable-next-line no-console
  console.log(
    `[retheme] d2 compiles: before=${d2Before} afterFirstFlip=${d2AfterFirst} afterSecondFlip=${d2AfterSecond} blocks=${d2Blocks}`,
  )
  // Task 436 — a flip to the theme ALREADY showing must cost nothing: the cache serves every block
  // and the WASM engine never runs. Was: a full compile + layout per diagram, per flip, always.
  expect(
    d2AfterFirst - d2Before,
    'a no-op flip runs the D2 engine zero times',
  ).toBe(0)
  // …and a REAL light/dark change must still re-render every drawn block exactly once — not zero
  // (that was the 436 regression: the pre-flip render got filed under the post-flip key and was
  // painted straight back, so the diagrams stopped following the theme), and not twice (that was
  // task 411's double-fire). `svgs` counts the blocks that actually drew.
  const drawnD2 = dark.out.d2.svgs
  expect(drawnD2, 'D2 blocks drew at all').toBeGreaterThan(0)
  // Compared against `d2Blocks` (blocks HANDED to the engine), not `drawnD2` (blocks that drew an
  // svg) — the two differ by exactly one in this fixture. `d2RenderStats.compiles`
  // (diagram-engines/d2.ts) increments once per block the engine is asked to compile, regardless of
  // outcome; all-renderers.md's `shape: sequence_diagram` block is INTENTIONALLY unrenderable by our
  // dagre/ELK layout (task 154's loud-fallback contract) and so is recompiled — and re-fails — on
  // every flip without ever producing an `<svg>`. Comparing the compile counter to `drawnD2` (task
  // 475 audit, 2026-07-31) was wrong before task 412 too; it only ever held because no fixture this
  // spec used exercised the fallback block until this one did.
  expect(
    d2AfterSecond - d2AfterFirst,
    'a real theme change re-renders every D2 block handed to the engine exactly once',
  ).toBe(d2Blocks)
  // The user-visible half of the same guarantee, asserted on the PIXEL-level output rather than a
  // counter: D2's colours are baked into the SVG, so a light/dark change must change them.
  expect(
    coloursDark !== coloursAfter,
    'D2 re-coloured across the dark→light flip',
  ).toBe(true)
  // eslint-disable-next-line no-console
  console.log(
    `[retheme] darkColourLen=${dark.colourLen} lightColourLen=${light.colourLen} digestsDiffer=${dark.colourDigest !== light.colourDigest}`,
  )
  // eslint-disable-next-line no-console
  console.log(
    `[retheme] per-lang dark→light:\n` +
      LANGS.map(
        (l) =>
          `   ${l}: els ${dark.out[l].els}→${light.out[l].els}` +
          ` svgs ${dark.out[l].svgs}→${light.out[l].svgs}` +
          ` canv ${dark.out[l].canvases}→${light.out[l].canvases}`,
      ).join('\n'),
  )

  // (a0) Every family still HAS a render after the flip. The pre-flip poll above guarantees all 14
  // drew to begin with, so this is a real drop check — and it closes the hole that let the stability
  // assertion below pass VACUOUSLY: for an engine that rendered nothing at all, 0 svgs before == 0
  // svgs after reads as "stable". That hole hid a real bug — the flip destroyed the abc score (its
  // source was lost, so the re-render drew an empty one, task 361) and the spec still went green
  // whenever abc had already been destroyed before the baseline census, which is what made the
  // failure look like order-dependent flake.
  for (const lang of LANGS) {
    const drew = (c: { svgs: number; canvases: number }) => c.svgs + c.canvases
    expect(
      drew(light.out[lang]),
      `${lang} lost its render in the flip`,
    ).toBeGreaterThan(0)
  }

  // (a) Every family rendered, and its render count is IDENTICAL across the flip — no engine
  // grew a duplicate or lost its render when the theme changed (the task-189 corruption class).
  for (const lang of LANGS) {
    expect(dark.out[lang].els, `${lang} present`).toBeGreaterThan(0)
    expect(light.out[lang].els, `${lang} els stable`).toBe(dark.out[lang].els)
    expect(light.out[lang].svgs, `${lang} svgs stable`).toBe(
      dark.out[lang].svgs,
    )
    expect(light.out[lang].canvases, `${lang} canvases stable`).toBe(
      dark.out[lang].canvases,
    )
  }
  // (b) The flip actually re-coloured something (the fill/stroke digest changed).
  expect(
    dark.colourDigest !== light.colourDigest,
    'theme flip must re-colour the diagrams',
  ).toBe(true)
})

// Task 408 — the CACHE-KEY narrowing (as opposed to the live retheme DISPATCH, which
// rethemeDiagrams already scoped correctly per-engine before this task — mermaid's own hand-
// written `mermaidThemeChanged || mermaidLayoutChanged || contentThemeChanged` was already
// independent of d2Layout, so a live-DOM-touch assertion on a single config-changed round trip
// would pass identically pre- and post-408 and prove nothing about it). The actual regression 408
// fixes only shows up ACROSS A REOPEN: before 408, `renderCacheThemeKey` folded EVERY engine's
// settings (mermaidTheme, d2Layout, …) into ONE flat string used as part of every engine's cache
// hash, so changing d2Layout flipped that shared string and made every OTHER engine's persisted
// hash unreachable too — mermaid, which never changed, would have MISSED the cache on the next
// open and paid a needless live re-render. Reusing diagram-cache.spec.ts's fixture (which already
// has 3 d2 diagrams + mermaid/graphviz/abc/flowchart) and its open/close/reopen/cache-hit-marker
// pattern, with a d2Layout change inserted between close and reopen.
test('a D2-only setting change invalidates D2 alone on reopen, not mermaid (task 408 cache scope)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const CACHE_FIXTURE = path.join(__dirname, 'fixtures', 'diagram-cache.md')

  const setD2Layout = async (value: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update(
            'diagram.d2.layout',
            args[0],
            vscode.ConfigurationTarget.Global,
          )
      },
      [value] as [string],
    )
  }
  const openCacheFixture = async () => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [CACHE_FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame
      .locator('div.language-d2 svg')
      .nth(2)
      .waitFor({ timeout: 60_000 })
    await frame
      .locator('.language-mermaid svg')
      .first()
      .waitFor({ timeout: 60_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
    return frame
  }
  const closeActive = async () => {
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      )
    })
  }
  const snapshot = (frame: ReturnType<typeof wf>) =>
    frame.locator('body').evaluate(() => {
      const d2 = Array.from(
        document.querySelectorAll<HTMLElement>('div.language-d2'),
      )
      // mermaid is a NATIVE (not custom/findBlocks) engine: unlike d2's code→div swap, its
      // editable-marker copy (`.vditor-ir__marker--pre code.language-mermaid`, plain source text,
      // no svg) and its rendered preview copy (`.vditor-ir__preview code.language-mermaid`, holds
      // the svg + the cache-hit attribute) are the SAME tag/class — an unscoped querySelector can
      // pick either. Scope to the one that actually contains an <svg>, mirroring render-cache-
      // client.ts's own PREVIEW_PANE_SEL discipline (never grep this bare, always pane-scoped).
      const mermaid = Array.from(
        document.querySelectorAll<HTMLElement>('.language-mermaid'),
      ).find((el) => el.querySelector('svg'))
      return {
        d2CacheHit: d2.map(
          (w) => w.getAttribute('data-vmarkd-cache-hit') === '1',
        ),
        d2EngineMarker: d2.map((w) => w.hasAttribute('data-d2-engine')),
        mermaidCacheHit: mermaid?.getAttribute('data-vmarkd-cache-hit') === '1',
      }
    })

  // Known starting value, then a first open populates the host cache under it.
  await setD2Layout('dagre')
  const frame1 = await openCacheFixture()
  const before = await snapshot(frame1)
  expect(before.d2CacheHit).toHaveLength(3)

  await closeActive()
  await new Promise((r) => setTimeout(r, 500))
  // The D2-only change: the next open hashes every d2 block under a DIFFERENT engine setting.
  await setD2Layout('vmarkd')
  const frame2 = await openCacheFixture()
  const after = await snapshot(frame2)

  // eslint-disable-next-line no-console
  console.log(
    `[retheme-cache-scope] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  )

  // D2 correctly MISSES (its own setting changed) — every d2 block gets a fresh engine render.
  expect(
    after.d2CacheHit.every((h) => h === false),
    'd2 must NOT hit the now-stale cache for its own changed setting',
  ).toBe(true)
  expect(
    after.d2EngineMarker.every((m) => m === true),
    'd2 must have actually re-rendered (data-d2-engine present)',
  ).toBe(true)
  // mermaid — UNRELATED to d2Layout — still HITS. Pre-408 this would have been FALSE: the flat
  // global themeKey folded d2Layout into every engine's hash, so mermaid missed too and paid a
  // needless live re-render on reopen even though nothing about mermaid changed.
  expect(
    after.mermaidCacheHit,
    'mermaid (unrelated to d2Layout) must still be served from cache',
  ).toBe(true)
})
