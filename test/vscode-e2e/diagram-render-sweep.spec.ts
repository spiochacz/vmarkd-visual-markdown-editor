import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { type EvaluateInVSCode, wf } from './webview-helpers'

// Task 511 cross-file boot merge. One shared VS Code boot for the 4 `diagram-*` specs that survived
// the family audit (tasks/511-e2e-cross-file-shared-boot.md, "`diagram-*` audit" table) — none of
// them mutate the document, none mutate settings, and none assert on cache/engine-instance state.
// Donor files, IN THE RUN ORDER BELOW — the order is LOAD-BEARING, see the cache note just below:
//   1. diagram-bg.spec.ts          — no rendered diagram wrapper carries `.hljs` / a panel bg
//   2. diagram-zoom.spec.ts        — Ctrl-to-interact wheel gate (markmap + ECharts mindmap)
//   3. diagram-inline-zoom.spec.ts — inline wheel/drag zoom+pan + re-render survival on static SVGs
//   4. diagram-zoom-keys.spec.ts   — `+`/`-`/`0` keyboard zoom (static SVG / markmap / geojson)
//
// CACHE CONSEQUENCE — READ BEFORE REORDERING OR ADDING A CASE. Under VMARKD_E2E=1 the DiagramCache
// wipes its disk store ONCE PER VS CODE BOOT (traced in 511: markdown-editor-provider.ts:110's
// `freshStart: !!process.env.VMARKD_E2E` is read at DiagramCacheHost construction time, i.e. once per
// extension activation), NOT once per document open. Cache keys hash the diagram SOURCE. Cases 1-3
// all open the SAME fixture (`all-renderers.md`), so inside this one shared boot cases 2 and 3 are
// served from the render cache case 1 populated, instead of a fresh engine render — copying the
// fixture to a new filename would not change this, since the key is the source, not the path.
// This was flagged as a real risk before implementation and tested empirically, not assumed away:
// all three cases assert on the DECORATION layer (wrapper classes/background, zoom-gate handlers,
// `data-vmarkd-zoom` markers), not on the render itself, and the decoration observers re-run over
// whatever painted, cache-hit or not. Running `diagram-bg` FIRST guarantees at least one case in the
// sweep runs against a genuinely cold cache. If a future case-2/case-3-style addition here ever fails
// after this merge, that is a real finding about the decoration path not covering cache-painted
// diagrams — investigate it, do not reorder the sweep or loosen an assertion to hide it.
//
// The rest of the `diagram-*` family (13 files, 17 tests total) was audited and stays excluded: edit
// specs (`diagram-errors`, `diagram-edit-monitor`, `diagram-edit-scroll`, `diagram-fast-edit-safety`
// — rule 1, document mutation), cache-freshness specs (`diagram-cache`, `diagram-cache-mermaid`,
// `diagram-cache-reply-source` — rule 2, cold-vs-cache IS the assertion), viewport/settings-mutating
// specs (`diagram-resize`, `diagram-sizing` — rule 7, no reset seen), a theme-state spec
// (`diagram-retheme-viewport-gate`), and timing instruments (`diagram-sizing-audit` — rule 5,
// explicitly "measurement, not an assertion gate"). `diagram-visual` is `@visual`-tagged and
// `diagram-175spike-all`/`diagram-resettle-spike` are `**/*spike*`-excluded — neither runs in the
// default tier at all. See the task file's `diagram-*` audit table for the full per-file reasoning.

const FIXTURES = {
  allRenderers: path.join(__dirname, 'fixtures', 'all-renderers.md'),
  zoomKeys: path.join(__dirname, 'fixtures', 'diagram-zoom-keys.md'),
}

// Close-all + reopen a fresh fixture — same pattern as clipboard-elements.spec.ts's local `boot()`
// (task 450) and the d2/plantuml sweeps this task copies: a fresh close-all + reopen INSIDE the
// shared test(), not a new VS Code launch (that only happens once, at this test()'s own boot, task
// 448).
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

// ---- case 1: diagram-bg.spec.ts ----------------------------------------------------------------
// Regression: a custom-observer diagram (d2/wavedrom/nomnoml/geojson/topojson/vega/stl) must sit on
// the PAGE background, not a code-block panel. Vditor highlights these unknown-language blocks as
// code first (adds `.hljs` to the <code>); our findBlocks used to copy that class onto the rendered
// diagram <div>, so the highlight.js theme painted the code-panel bg behind the (often transparent)
// svg. findBlocks now strips `hljs` — assert no rendered diagram wrapper carries it and its
// background is transparent.
//
// Runs FIRST in this sweep — see the CACHE CONSEQUENCE comment at the top of the file.

async function runDiagramBg(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.allRenderers)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 6000)))

  const bad = await frame.locator('body').evaluate(() => {
    const transparent = (c: string) =>
      c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
    const offenders: { lang: string; bg: string; hljs: boolean }[] = []
    const wrappers = document.querySelectorAll(
      '.vditor-ir .vditor-ir__preview [class*="language-"]',
    )
    for (const w of Array.from(wrappers)) {
      const el = w as HTMLElement
      const lang = el.className.match(/language-([\w-]+)/)?.[1] ?? '?'
      // only the rendered diagram wrappers (hold an svg/canvas), not raw code/text previews
      if (!el.querySelector('svg, canvas')) continue
      const bg = getComputedStyle(el).backgroundColor
      const hljs = el.classList.contains('hljs')
      if (hljs || !transparent(bg)) offenders.push({ lang, bg, hljs })
    }
    return offenders
  })
  console.log(`[diagram-bg] offenders=${JSON.stringify(bad)}`)
  expect
    .soft(
      bad,
      `[diagram-bg] diagram wrappers with a panel bg / hljs class: ${JSON.stringify(bad)}`,
    )
    .toEqual([])
}

// ---- case 2: diagram-zoom.spec.ts --------------------------------------------------------------
// Ctrl-to-interact gate for diagrams (markmap + ECharts mindmap): a PLAIN wheel over a diagram must
// scroll the page (the diagram must NOT capture it — "przechwytuje kursor"), and Ctrl+wheel must
// zoom the diagram. We assert the deterministic signal of that gate: WheelEvent.defaultPrevented.
//   - plain wheel  → defaultPrevented === false  (diagram ignored it → the document scrolls)
//   - Ctrl + wheel → defaultPrevented === true   (the diagram's zoom handler ran + preventDefault'd)
// markmap is gated by overriding its d3-zoom `.filter` (esbuild patch); the ECharts mindmap by a
// capture-phase document listener (diagram-zoom-gate.ts). This is a real-VS-Code test because the
// behaviour lives entirely in the webview's native event path (not reproducible in the harness).
//
// This case forces the full-Preview overlay by hiding the edit panes and calling `preview.render()`
// directly — that is webview-local DOM state on THIS panel, discarded the moment the next case's
// `boot()` closes and reopens a fresh one, so it cannot leak into case 3 or 4.

async function runDiagramZoom(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.allRenderers)
  await frame
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  // Full Preview overlay — every diagram renders there at real size.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor?: {
          vditor?: {
            preview?: { element?: HTMLElement; render?: (x: unknown) => void }
          }
        }
      }
    ).vditor
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

  // markmap renders an <svg>, the mindmap a <canvas>; wait for both, then let them settle.
  await frame
    .locator('.vditor-preview .language-markmap svg')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('.vditor-preview .language-mindmap canvas')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      /* mindmap canvas may lag; don't hard-fail the wait — sample whatever painted */
    })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  const result = await frame.locator('body').evaluate(() => {
    const fire = (el: Element | null, ctrlKey: boolean): string => {
      if (!el) return 'NO-EL'
      const ev = new WheelEvent('wheel', {
        deltaY: 120,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      })
      el.dispatchEvent(ev)
      return ev.defaultPrevented ? 'PREVENTED' : 'passed'
    }
    // Dispatch on the deepest painted node so the diagram's own (deep-bound) handler is on the path.
    const markmap = document.querySelector(
      '.vditor-preview .language-markmap svg',
    )
    const mindmap = document.querySelector(
      '.vditor-preview .language-mindmap canvas',
    )
    return {
      markmapPlain: fire(markmap, false),
      markmapCtrl: fire(markmap, true),
      mindmapPlain: fire(mindmap, false),
      mindmapCtrl: fire(mindmap, true),
    }
  })
  console.log(`[zoom-gate] ${JSON.stringify(result)}`)

  // The core fix: a plain wheel is NOT captured → the document scrolls.
  expect
    .soft(result.markmapPlain, '[zoom-gate] markmap plain wheel')
    .toBe('passed')
  expect
    .soft(result.mindmapPlain, '[zoom-gate] mindmap plain wheel')
    .toBe('passed')
  // Ctrl+wheel reaches the diagram's zoom handler (which preventDefaults).
  expect
    .soft(result.markmapCtrl, '[zoom-gate] markmap Ctrl+wheel')
    .toBe('PREVENTED')
  expect
    .soft(result.mindmapCtrl, '[zoom-gate] mindmap Ctrl+wheel')
    .toBe('PREVENTED')
}

// ---- case 3: diagram-inline-zoom.spec.ts -------------------------------------------------------
// Inline diagram zoom/pan + ⛶ fullscreen button (diagram-zoom.ts) — real-VS-Code only.
//
// Proves, in the real webview: every rendered static-SVG diagram (d2/mermaid/flowchart/graphviz/abc/
// smiles) gets a ⛶ button and the wheel/drag/double-click transform handlers, and that they mutate
// the <svg> transform (zoom toward the cursor, pan, reset). Fullscreen itself is only smoke-checked
// (the Fullscreen API may be blocked inside the webview iframe — the richer overlay is task 157).
// This is a SEPARATE concern from case 2 above, which tests the Ctrl-gate for markmap/mindmap.
//
// The second half deliberately replaces a wrapper's `innerHTML` to simulate a re-render (regression:
// a re-render — reRenderD2 on a theme switch — swaps wrapper.innerHTML for a fresh <svg>, and zoom/
// pan must survive that; the reported "pan stops working after a D2 style reload"). That mutation is
// webview-local DOM on the PREVIEW WRAPPER, not the document source — it is discarded the moment the
// next case's `boot()` closes and reopens a fresh panel.

async function runDiagramInlineZoom(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.allRenderers)
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  // wait for the observer to decorate (the ⛶ button is gated off — task 157 — so key off the marker)
  await frame
    .locator('[data-vmarkd-zoom="1"]')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const info = await frame.locator('body').evaluate(() => {
    const decorated = [...document.querySelectorAll('[data-vmarkd-zoom="1"]')]
    const fsButtons = document.querySelectorAll('.vmarkd-diagram-fs').length
    const wrap = document.querySelector(
      '.language-d2[data-vmarkd-zoom="1"]',
    ) as HTMLElement | null
    const svg = wrap?.querySelector('svg') as SVGElement | null
    const rect = wrap?.getBoundingClientRect()
    const at = (dx: number, dy: number) => ({
      clientX: (rect?.left ?? 0) + dx,
      clientY: (rect?.top ?? 0) + dy,
    })
    // IR is the default mode → the diagram should not be text-selectable (click opens edit instead).
    const userSelectIR = wrap ? getComputedStyle(wrap).userSelect : ''

    // PLAIN wheel (no Ctrl) must NOT zoom — the page scrolls instead (regression guard for the
    // "diagram grabs the wheel while scrolling" bug).
    wrap?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterPlainWheel = svg?.style.transform || ''

    // Ctrl+wheel up (deltaY<0) → zoom in toward the cursor.
    wrap?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterWheel = svg?.style.transform || ''
    const scaleAfterWheel = Number(
      /scale\(([\d.]+)\)/.exec(transformAfterWheel)?.[1] ?? '1',
    )

    // Pan needs Ctrl too: a plain pointerdown must NOT start a pan.
    wrap?.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 2,
        ...at(50, 40),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        ...at(90, 70),
        bubbles: true,
      }),
    )
    const transformAfterPlainDrag = svg?.style.transform || ''
    wrap?.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        ...at(90, 70),
        bubbles: true,
      }),
    )

    // Ctrl + pan: pointerdown → move → up.
    wrap?.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        ctrlKey: true,
        pointerId: 1,
        ...at(50, 40),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        ...at(80, 60),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        ...at(80, 60),
        bubbles: true,
      }),
    )
    const transformAfterPan = svg?.style.transform || ''

    // Double-click → reset.
    wrap?.dispatchEvent(
      new MouseEvent('dblclick', {
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterReset = svg?.style.transform || ''

    // A Ctrl/pan click must be swallowed (so Vditor doesn't open the block for editing); a PLAIN
    // click must pass through (click-to-edit still works).
    const ctrlClick = new MouseEvent('click', {
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...at(50, 40),
    })
    wrap?.dispatchEvent(ctrlClick)
    const ctrlClickSwallowed = ctrlClick.defaultPrevented
    const plainClick = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ...at(50, 40),
    })
    wrap?.dispatchEvent(plainClick)
    const plainClickPassed = !plainClick.defaultPrevented

    return {
      decoratedCount: decorated.length,
      fsButtons,
      userSelectIR,
      transformAfterPlainWheel,
      scaleAfterWheel,
      transformAfterWheel,
      transformAfterPlainDrag,
      transformAfterPan,
      transformAfterReset,
      ctrlClickSwallowed,
      plainClickPassed,
    }
  })
  console.log(`[diagram-inline-zoom] ${JSON.stringify(info, null, 2)}`)

  expect
    .soft(info.decoratedCount, '[diagram-inline-zoom] decoratedCount')
    .toBeGreaterThan(0)
  expect.soft(info.fsButtons, '[diagram-inline-zoom] fsButtons').toBe(0) // ⛶ disabled until task 157 (FULLSCREEN_BUTTON=false)
  expect
    .soft(info.userSelectIR, '[diagram-inline-zoom] userSelectIR')
    .toBe('none') // no text selection on a diagram in IR (click opens edit)
  expect
    .soft(
      info.transformAfterPlainWheel,
      '[diagram-inline-zoom] transformAfterPlainWheel',
    )
    .toMatch(/scale\(1(\.0+)?\)/) // plain wheel did NOT zoom (still 1:1; page scrolls)
  expect
    .soft(info.scaleAfterWheel, '[diagram-inline-zoom] scaleAfterWheel')
    .toBeGreaterThan(1) // Ctrl+wheel zoomed in
  expect
    .soft(
      info.transformAfterPlainDrag,
      '[diagram-inline-zoom] transformAfterPlainDrag',
    )
    .toBe(info.transformAfterWheel) // plain drag did NOT pan
  expect
    .soft(info.transformAfterPan, '[diagram-inline-zoom] transformAfterPan')
    .not.toBe(info.transformAfterWheel) // Ctrl+drag panned it
  expect
    .soft(info.transformAfterReset, '[diagram-inline-zoom] transformAfterReset')
    .toMatch(/scale\(1(\.0+)?\)/) // reset to 1
  expect
    .soft(info.ctrlClickSwallowed, '[diagram-inline-zoom] ctrlClickSwallowed')
    .toBe(true) // Ctrl/pan click does NOT reach Vditor (no edit-expand)
  expect
    .soft(info.plainClickPassed, '[diagram-inline-zoom] plainClickPassed')
    .toBe(true) // plain click still reaches Vditor (click-to-edit)

  // Regression: a re-render (reRenderD2 on a theme switch) swaps wrapper.innerHTML for a fresh <svg>.
  // Zoom/pan must survive — state is per-wrapper + handlers resolve the current svg — not break (the
  // reported "pan stops working after a D2 style reload").
  const reload = await frame.locator('body').evaluate(async () => {
    const wrap = document.querySelector(
      '.language-d2[data-vmarkd-zoom="1"]',
    ) as HTMLElement
    const svg0 = wrap.querySelector('svg') as SVGElement
    const rect = wrap.getBoundingClientRect()
    const at = (dx: number, dy: number) => ({
      clientX: rect.left + dx,
      clientY: rect.top + dy,
    })
    // zoom in so there's a non-identity state to preserve
    wrap.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    // simulate reRenderD2: replace with a FRESH svg (no inline transform/style)
    const fresh = svg0.outerHTML
      .replace(/\stransform="[^"]*"/, '')
      .replace(/\sstyle="[^"]*"/, '')
    wrap.innerHTML = fresh
    // let the rAF-debounced observer re-decorate the new svg
    await new Promise((r) => setTimeout(r, 150))
    const svg1 = wrap.querySelector('svg') as SVGElement
    const reappliedTransform = svg1.style.transform // observer re-applied saved zoom to the new svg
    // pan the NEW svg
    wrap.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        ctrlKey: true,
        pointerId: 5,
        ...at(50, 40),
        bubbles: true,
      }),
    )
    wrap.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 5,
        ...at(90, 70),
        bubbles: true,
      }),
    )
    wrap.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 5,
        ...at(90, 70),
        bubbles: true,
      }),
    )
    return {
      svgReplaced: svg0 !== svg1,
      reappliedTransform,
      transformAfterPanOnNew: svg1.style.transform,
    }
  })
  console.log(`[diagram-inline-zoom] reload: ${JSON.stringify(reload)}`)

  expect
    .soft(reload.svgReplaced, '[diagram-inline-zoom] svgReplaced')
    .toBe(true) // the svg really was swapped (re-render simulated)
  expect
    .soft(reload.reappliedTransform, '[diagram-inline-zoom] reappliedTransform')
    .toMatch(/scale\(1\.12/) // zoom state survived the re-render
  expect
    .soft(
      reload.transformAfterPanOnNew,
      '[diagram-inline-zoom] transformAfterPanOnNew',
    )
    .not.toBe(reload.reappliedTransform) // pan works on the new svg
}

// ---- case 4: diagram-zoom-keys.spec.ts ---------------------------------------------------------
// Task 459 — keyboard `+`/`-`/`0` zoom parity, real VS Code only (the Ctrl-to-interact gate this
// builds on — diagram-zoom-gate.ts — only reproduces in the real webview's native event path, see
// case 2 above). Covers all THREE code paths task 459 shipped:
//   - static SVG (mermaid, …): diagram-zoom.ts's OWN transform (`zoomBy`/`reset`), reached via
//     Ctrl+mousedown focus then a plain keydown.
//   - markmap (a "gated" engine with a retained instance): diagram-zoom-keys-gated.ts calls the
//     Markmap instance's own `rescale()`/`fit()` — never a parallel CSS transform.
//   - geojson (Leaflet, also "gated"): diagram-zoom-keys-gated.ts calls the stashed Leaflet map's
//     own `zoomIn()`/`zoomOut()`/`setView()`.
// (Mindmap/ECharts — the fourth gated engine — has NO retained instance; task 459 documents that
// gap rather than shipping an unverified fix. Not covered by this spec; see the task file.)
//
// Fixture note: the geojson block in `diagram-zoom-keys.md` is a ~10°-square Polygon, not a lone
// Point. A lone Point has a zero-area bounding box, and Leaflet's fitBounds() on a zero-area box with
// no maxZoom configured computes an unbounded (Infinity) zoom level — a real, separate latent bug
// (see task 459) that would otherwise mask the keyboard-zoom assertions below under a degenerate map
// state, not the behaviour this spec exists to check.
//
// Also asserts `getValue()` is unchanged across every key press — the wrapper sits INSIDE the
// contenteditable editor even though its content isn't editable itself, so a keydown that isn't
// correctly intercepted would type the character into the document instead of zooming. That
// unchanged-getValue() check is itself the proof this case does not mutate the document (rule 1).
// This case opens its OWN fixture (`diagram-zoom-keys.md`, distinct from `all-renderers.md`), so it
// is never affected by the cases-1-3 cache concern described at the top of this file.

async function runDiagramZoomKeys(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
) {
  const frame = await boot(evaluateInVSCode, workbox, FIXTURES.zoomKeys)
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('.language-markmap svg')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('.language-geojson .leaflet-container')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const before = await frame
    .locator('body')
    .evaluate(() =>
      (
        window as unknown as { vditor: { getValue: () => string } }
      ).vditor.getValue(),
    )

  const result = await frame.locator('body').evaluate(async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const key = (target: Element, k: string) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      )
    const ctrlMousedown = (target: Element) =>
      target.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )

    // ── static SVG (mermaid) — diagram-zoom.ts's own transform ────────────────────────────
    const merWrap = document.querySelector(
      '.language-mermaid[data-vmarkd-zoom="1"]',
    ) as HTMLElement
    const merSvg = merWrap?.querySelector('svg') as SVGElement
    // Ctrl+mousedown focuses the wrapper (diagram-zoom.ts's pointerdown handler) — use the REAL
    // pointerdown event, not a bare .focus(), so this proves the actual entry gesture works.
    merWrap?.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        ctrlKey: true,
        bubbles: true,
      }),
    )
    const merFocusedAfterCtrlMousedown = document.activeElement === merWrap
    key(merWrap, '+')
    const merScaleAfterPlus = merSvg?.style.transform || ''
    key(merWrap, '-')
    key(merWrap, '-')
    const merScaleAfterMinus = merSvg?.style.transform || ''
    key(merWrap, '0')
    const merScaleAfterReset = merSvg?.style.transform || ''

    // ── markmap — diagram-zoom-keys-gated.ts calls the retained instance's rescale()/fit() ─
    const mmSvg = document.querySelector('.language-markmap svg') as SVGElement
    const mmWrap = mmSvg?.closest('.language-markmap') as HTMLElement
    const mmG = mmSvg?.querySelector('g')
    ctrlMousedown(mmSvg)
    const mmFocused = document.activeElement === mmWrap
    const mmTransformBefore = mmG?.getAttribute('transform') || ''
    key(mmWrap, '+')
    await wait(400) // rescale() is a d3 transition; short but real
    const mmTransformAfterPlus = mmG?.getAttribute('transform') || ''
    key(mmWrap, '0')
    await wait(400)
    const mmTransformAfterReset = mmG?.getAttribute('transform') || ''

    // ── geojson (Leaflet) — diagram-zoom-keys-gated.ts calls the stashed map's own API ─────
    const geoContainer = document.querySelector(
      '.language-geojson .leaflet-container',
    ) as HTMLElement
    const geoWrap = geoContainer?.closest(
      '.language-geojson',
    ) as HTMLElement & {
      __vmarkdMap?: { getZoom: () => number }
    }
    const geoDiag = {
      hasContainer: !!geoContainer,
      hasWrap: !!geoWrap,
      dataProcessed: geoWrap?.getAttribute('data-processed'),
      hasStash: geoWrap ? '__vmarkdMap' in geoWrap : null,
      inPreviewPane: !!geoWrap?.closest(
        '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview',
      ),
    }
    ctrlMousedown(geoContainer)
    const geoFocused = document.activeElement === geoWrap
    // Leaflet's zoomIn()/zoomOut() schedule the actual `_zoom` update via requestAnimationFrame
    // (Leaflet's own `_tryAnimatedZoom` → rAF → `_animateZoom` → `_move`, which is where `this._zoom`
    // is actually reassigned) rather than synchronously — the 250ms that follows is only the CSS
    // transition's VISUAL catch-up, not a precondition for getZoom() to report the new value. Reading
    // getZoom() in the same tick as the keypress races that rAF and reads the stale value (measured:
    // "AfterPlus" came back identical to "Before" without this wait). Poll instead of a fixed sleep —
    // bounded, and settles the moment the rAF has actually run rather than guessing a duration.
    const settleZoom = async (prev: number | undefined) => {
      const deadline = Date.now() + 1000
      let z = geoWrap?.__vmarkdMap?.getZoom()
      while (Date.now() < deadline && z === prev) {
        await wait(20)
        z = geoWrap?.__vmarkdMap?.getZoom()
      }
      return z
    }
    const geoZoomBefore = geoWrap?.__vmarkdMap?.getZoom()
    key(geoWrap, '+')
    const geoZoomAfterPlus = await settleZoom(geoZoomBefore)
    key(geoWrap, '-')
    const geoZoomAfterFirstMinus = await settleZoom(geoZoomAfterPlus)
    key(geoWrap, '-')
    const geoZoomAfterMinus = await settleZoom(geoZoomAfterFirstMinus)
    key(geoWrap, '0')
    const geoZoomAfterReset = await settleZoom(geoZoomAfterMinus)

    return {
      merFocusedAfterCtrlMousedown,
      merScaleAfterPlus,
      merScaleAfterMinus,
      merScaleAfterReset,
      mmFocused,
      mmTransformBefore,
      mmTransformAfterPlus,
      mmTransformAfterReset,
      geoDiag,
      geoFocused,
      geoZoomBefore,
      geoZoomAfterPlus,
      geoZoomAfterMinus,
      geoZoomAfterReset,
    }
  })
  console.log(`[diagram-zoom-keys] ${JSON.stringify(result, null, 2)}`)

  const after = await frame
    .locator('body')
    .evaluate(() =>
      (
        window as unknown as { vditor: { getValue: () => string } }
      ).vditor.getValue(),
    )

  // static SVG. The browser canonicalizes the inline style's numeric formatting on readback (e.g.
  // "scale(1.1200)" as WRITTEN comes back as "scale(1.12)"), so match on the number, not the string.
  expect
    .soft(
      result.merFocusedAfterCtrlMousedown,
      '[diagram-zoom-keys] merFocusedAfterCtrlMousedown',
    )
    .toBe(true)
  expect
    .soft(result.merScaleAfterPlus, '[diagram-zoom-keys] merScaleAfterPlus')
    .toMatch(/scale\(1\.12\)/)
  expect
    .soft(result.merScaleAfterMinus, '[diagram-zoom-keys] merScaleAfterMinus')
    .not.toMatch(/scale\(1\.12\)/)
  expect
    .soft(result.merScaleAfterReset, '[diagram-zoom-keys] merScaleAfterReset')
    .toMatch(/scale\(1\)/)

  // markmap
  expect.soft(result.mmFocused, '[diagram-zoom-keys] mmFocused').toBe(true)
  expect
    .soft(
      result.mmTransformAfterPlus,
      '[diagram-zoom-keys] mmTransformAfterPlus',
    )
    .not.toBe(result.mmTransformBefore) // rescale() moved it
  expect
    .soft(
      result.mmTransformAfterReset,
      '[diagram-zoom-keys] mmTransformAfterReset',
    )
    .not.toBe(result.mmTransformAfterPlus) // fit() moved it again

  // geojson
  expect.soft(result.geoFocused, '[diagram-zoom-keys] geoFocused').toBe(true)
  expect
    .soft(result.geoZoomAfterPlus, '[diagram-zoom-keys] geoZoomAfterPlus')
    .toBeGreaterThan(result.geoZoomBefore as number)
  expect
    .soft(result.geoZoomAfterMinus, '[diagram-zoom-keys] geoZoomAfterMinus')
    .toBeLessThan(result.geoZoomAfterPlus as number)
  expect
    .soft(result.geoZoomAfterReset, '[diagram-zoom-keys] geoZoomAfterReset')
    .toBe(result.geoZoomBefore) // setView() restored the stashed view

  // No keypress typed a stray character into the document.
  expect.soft(after, '[diagram-zoom-keys] getValue() unchanged').toBe(before)
}

test('diagram render sweep: bg, zoom-gate, inline zoom/pan, keyboard zoom', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // 4 cases, each a real-webview render + native-event interaction with its own settle waits (up to
  // 60s each). Sized off the sum of the 4 donor files' own budgets — none declared an explicit
  // test.setTimeout(), so each ran under this suite's 90_000ms default (see playwright.config.ts) —
  // plus headroom for the extra close-all + reopen boot() between every case (task 450's post-merge
  // correction: an under-sized merged test can be killed mid-loop by Playwright's own timeout, which
  // would silently drop the expect.soft() reports for every case scheduled after that point).
  test.setTimeout(600_000)

  await runDiagramBg(evaluateInVSCode, workbox)
  await runDiagramZoom(evaluateInVSCode, workbox)
  await runDiagramInlineZoom(evaluateInVSCode, workbox)
  await runDiagramZoomKeys(evaluateInVSCode, workbox)
})
