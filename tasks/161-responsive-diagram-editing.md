# Task 161 — Responsive diagram editing (debounce + off-main-thread D2 compile)

> **Status:** 🟡 STEP 1 DONE 2026-06-28 (debounce + keep-last-render overlay, both engine families;
> measured before/after in the real webview). Step 2 (off-main-thread D2 worker) + WYSIWYG still TODO.
> Created 2026-06-28 from a live-editing responsiveness investigation (follow-up to task 145).
> **Baseline MEASURED 2026-06-28** (the problem confirmed + quantified — see below).

## Step 1 IMPLEMENTED 2026-06-28 — debounce + keep-last-render overlay
A shared edit-activity gate (`media-src/src/edit-activity.ts`) arms a 220 ms quiet-timer on every editor
input (capture phase) and exposes `isTyping()` / `deferUntilSettle(key, cb)`. While typing, the heavy
diagram re-render is SKIPPED and coalesced into ONE render on the pause. Both families consult it:
- **Vditor-native** (mermaid/graphviz/echarts/flowchart/plantuml/mindmap/markmap/abc/smiles): the
  per-input `processCodeRender` loop in `ir/input.ts` is routed through `window.__vmarkdDeferIrDiagramRender`
  via esbuild `patchIrDeferDiagramRender` (anchor-asserted; stock loop kept as the else-fallback).
- **custom-observer** (d2/wavedrom/nomnoml/geojson/topojson/vega/stl): `observeCustomDiagrams.run()`
  checks `isTyping()` and defers its pass to settle.

Because Vditor leaves the preview VISIBLE during edit (confirmed in `_ir.less` — it does NOT hide it,
unlike our code-block CSS), a naive defer would flicker the diagram to raw source. So the gate keeps the
LAST rendered SVG on screen during the burst: a cached, **Lute-invisible** overlay (`data-render="1"`,
class `.vmarkd-stale-overlay`; main.css hides the raw children of `.vditor-ir__preview.vmarkd-deferred`).
This is step-3 "swap-when-ready" folded into step 1; staleness/cancellation (step 4) is handled by
construction (latest-wins-per-key settle → superseded renders never run; nothing is in-flight to cancel).

**Measured before/after — main-thread BLOCKED *while typing* (the stutter), 15 keystrokes, real VS Code
(`test/vscode-e2e/d2-edit-perf.spec.ts`, separates typing-phase blocking from the one post-pause render):**

| engine | family | BEFORE typing-block | AFTER typing-block | Δ |
|---|---|---:|---:|---:|
| flowchart | native (DSL) | 857 ms | 343 ms | **−60%** |
| echarts | native (canvas) | 590 ms | 299 ms | −49% |
| graphviz | native | 512 ms | 259 ms | −49% |
| mermaid | native | 954 ms | 557 ms | −42% |
| d2 | custom (WASM) | 571 ms | 337 ms | −41% |
| stl | custom (WebGL) | 337 ms | 351 ms | ~0% |

- The big per-keystroke hitches are gone: mermaid's worst single freeze while typing dropped from
  ~630 ms to ~100 ms (the heavy render moved to the post-pause settle, ~350–600 ms once, off the
  typing path where it's far less perceptible).
- **stl is flat** — its per-keystroke cost is Lute re-spinning the large STL source text, not the
  (WebGL) render, so deferring the render gains nothing. The residual ~250–550 ms across all engines
  is the same: **SpinVditorIRDOM (Lute) re-spin per keystroke** — out of scope for step 1 (that's the
  task-68/69 serialize hot-path), and the lever step 2 (worker) can't move either.
- Verified the overlay keeps the diagram visible (no raw-text flicker) while typing AND through the
  post-pause re-render — `test/vscode-e2e/t161-visual.spec.ts` (d2 + mermaid: deferred class + cached
  render shown + raw source hidden while typing; then a frame-by-frame settle sampler asserts ZERO
  "bare" frames — the diagram never flashes to raw source on the swap — and the new render lands).
  Unit tests: `media-src/src/edit-activity.test.ts` (gate semantics) + `patchIrDeferDiagramRender`
  drift guard in `test/backend/vditor-source-patches.test.ts`.
- **Swap-when-ready fix (reported: "przeskok przez białe tło z napisami"):** the first cut stripped the
  overlay BEFORE the async re-render finished → a flash of raw source. Now the overlay STAYS up while
  the engine re-renders into the (still-hidden) source child, and is removed only once the new svg/
  canvas actually lands (`scheduleReveal`, per-preview, 3 s timeout fallback). SVG engines render into a
  display:none child; canvas engines (echarts/mindmap/stl/geojson/topojson) render visible under an
  opaque absolute cover. Also fixed: the custom-observer (d2) reveal never fired because the settle was
  gated behind `observeCustomDiagrams`' `running` flag — moved the isTyping/defer decision into
  `schedule()` (runs on every mutation) so it's reliable.
- **Scroll-jank-after-edit fix (reported: "po edycji diagramu nie mogę płynnie scrollować, przycina"):**
  the keep-last-render cache was refreshed by a MutationObserver that `toDataURL`'d every canvas
  (echarts/mindmap/stl) on each mutation; the diagrams idle-animate (STL's three.js render loop, leaflet,
  echarts) → ~20 toDataURL/s → main thread ~25% blocked → scroll stuttered after an edit. Fix: snapshot
  ONCE per typing burst (first keystroke, in `markEditActivity`, capture phase before the spin); removed
  the observer. Verified: idle blocking after-edit ≈ before-edit (was +~300 ms). Note: a residual
  ~320 ms/2.5 s idle blocking in the all-renderers fixture is PRE-EXISTING (STL animate loop + 2 leaflet
  maps + echarts), present with/without editing. Test: `test/vscode-e2e/diagram-edit-scroll.spec.ts`.
- **Custom-diagram code-PANEL background fix (reported: blocks below wavedrom show the block bg, not the
  page bg) — PRE-EXISTING, not from this task** (confirmed: a clean build without the task-161 changes
  has the identical issue). Vditor highlights these unknown-language blocks as code first (adds `.hljs`
  to the `<code>`); `findBlocks` swapped `<code>`→`<div>` copying the class, so the highlight.js theme
  painted the code-panel bg (#0d1117) behind the (often transparent) diagram svg. wavedrom looked OK
  only because its svg has opaque fills. The earlier transparent-bg CSS only neutralised the preview
  `<pre>`, never the inner `div.language-X`. Fix: `findBlocks` strips `hljs` from the swapped div. Tests:
  unit `media-src/src/custom-diagrams.test.ts` (5) + e2e `test/vscode-e2e/diagram-bg.spec.ts` (asserts no
  rendered diagram wrapper has `.hljs` or a non-transparent bg).
- **Overlay left-edge jump fix (reported: "skacze do lewej krawędzi przy renderze a potem do środka"):**
  two bugs found in the real editor — (a) `visualSnapshot` grabbed the FIRST svg in the preview, which
  was Vditor's copy-button icon (`<svg><use #vditor-icon-copy>`), not the diagram → scoped the snapshot
  + the reveal check to svg/canvas INSIDE the `.language-X` wrapper (`RENDER_SEL`); (b) the overlay div
  lacked the diagram's `text-align:center` + `max-width:100%`, so the cached svg rendered left-aligned at
  intrinsic width → re-asserted both on `.vmarkd-stale-overlay` in main.css. `t161-visual.spec.ts` now
  asserts the overlay is the diagram (not a UI icon) AND centred (centre offset < 8 px).
- **Flowchart-shrinks-after-edit fix (2026-06-29, reported: "flowcharts po edycji ma małe diagramy,
  jakby zmniejszała się wielkość boxów"):** the swap-when-ready note above assumed "SVG engines render
  fine into a display:none child". FALSE for flowchart.js — it measures its text
  (getComputedTextLength/getBBox on the `<text>` nodes), which returns ~0 inside a `display:none`
  subtree, so on the settle re-render its boxes collapsed and the whole diagram shrank (svg 179→79px
  wide / 412→282px tall, MEASURED). It rendered correctly at OPEN (preview visible) and only shrank when
  re-rendered while deferred. Fix: renamed `CANVAS_LANGS`→`MEASURE_LANGS` and added `flowchart` — at
  settle `beginSettleRender` now switches the flowchart preview to COVER mode (source visible+sized
  under the opaque overlay) so text measures correctly, same as the canvas engines. The non-measuring
  SVG engines (graphviz/plantuml/abc/d2) stay in the cheap display:none deferred path. Verified GREEN:
  after the fix the svg is byte-identical size before/after the edit (179×412 → 179×412, sample min=max).
- **Edit-cycle MONITOR added (the missing regression net — user: "to co jest do tej pory pozwala na
  regresje"):** prior diagram specs were open-then-snapshot and could not catch a diagram that renders
  at open but breaks on EDIT. `test/vscode-e2e/diagram-edit-monitor.spec.ts` drives a real keystroke
  edit through the debounce→settle→swap and asserts, per engine: (1) no size jump/collapse (before/after
  + an rAF height sampler across the whole cycle), (2) no error box on a valid edit / an error box on an
  invalid one that then RECOVERS, (3) the svg is actually present. Covers flowchart (the regression) +
  graphviz (control + break→error→recover round-trip). Unit: `edit-activity.test.ts` asserts
  `beginSettleRender` puts flowchart in cover mode and leaves graphviz deferred.
- Gates green: typecheck · 1063 unit tests · lint:ci (7 pre-existing parity warnings) · d2-theme e2e
  (open-path unaffected — defer only triggers on `isTyping`).
> **Source:** user report — editing a diagram's source in a code block, while the diagram re-renders
> below ("praktycznie co znak"), makes the UI stutter. Measured in the real VS Code webview
> (`test/vscode-e2e/perf-timeline.spec.ts` pattern).

## Baseline measured (2026-06-28, real VS Code, `test/vscode-e2e/d2-edit-perf.spec.ts`)
Typed 15 letters one-by-one (50 ms apart) into a diagram's IR source while the preview re-renders
below; an rAF-gap sampler in the webview recorded how long the main thread was blocked
(`blockingMs` = Σ(frame-gap − 16.7 ms) over the typing window; `maxGap` = the single worst freeze).
Fixture: `test/vscode-e2e/fixtures/diagram-edit.md` (one block per engine, trailing `zzz` identifier
the spec extends so every keystroke stays valid → a real re-render).

| engine | family | preview rebuilds | main-thread BLOCKED | worst single freeze |
|---|---|---:|---:|---:|
| **mermaid** | vditor-native | 15 | **≈1424 ms** (~83% of typing) | **670 ms** |
| graphviz | vditor-native | 15 | ≈533 ms (~36%) | 85 ms |
| d2 | custom-observer (no debounce) | 25 | ≈423 ms (~30%) | 76 ms |

Findings:
- **The stutter is real and engine-wide** — every keystroke rebuilds the preview and re-runs the
  engine on the main thread. It is NOT d2-specific; **mermaid is by far the worst** (a 670 ms freeze
  per heavy keystroke; the thread is busy ~83% of the time you type).
- d2 shows MORE rebuilds (25 > 15) because both Vditor's spin AND `observeCustomDiagrams` re-render it
  (the re-entrant running/dirty pass), but each compile is comparatively cheap post-boot.
- **Step 1 (debounce) is the high-ROI fix for ALL families**, not just d2 — collapse N per-keystroke
  re-renders to ~1 after a pause. The before/after net is this spec: expect rebuilds → ~1–2 and
  blockingMs to drop sharply. Step 2 (worker) then removes the residual per-render compile block,
  d2 first (pure-compute compile), mermaid/graphviz are heavier worker candidates.
- Caveat: `svg (re)insert` count is 0 for the native engines in the spec (they swap via `innerHTML`
  on an existing wrapper, which the added-node observer doesn't catch) — `blockingMs`/`rebuilds` are
  the load-bearing metrics, not the svg count.
> **Value / Risk:** 🟢 smooth typing while a diagram re-renders below / medium — step 1 (debounce) is
> low-risk + cheap; step 2 (Web Worker for D2) is a real architecture change (worker + protocol +
> cancellation), so spike + measure before committing.

## The problem (different from task 145)
Task 145 fixed the one-time **open** burst (hljs preload + yield). This is the **edit** scenario:
typing in a ` ```d2 ` (or mermaid/…) source re-renders the preview repeatedly. Each re-render competes
with keystroke handling on the single main thread → the editor stutters. For D2 the compile is a WASM
step (`bootD2` cold init ~470 ms, then per-edit `compileD2`), so a re-render mid-typing is a visible
hitch. Off-main-thread rendering **pays the most HERE** (repeated renders during typing), unlike the
one-time open burst where cooperative scheduling sufficed.

### Current behaviour (measured / read)
- `observeCustomDiagrams` (`media-src/src/custom-diagrams.ts`) re-renders on DOM mutation, coalesced by
  one `requestAnimationFrame` (+ the running/dirty re-entrancy guard added in task 145). In IR, every
  keystroke in a code block triggers `SpinVditorIRDOM` → DOM mutation → schedule → render ≈ per-char.
- `renderD2` → `compileD2` (`d2-wasm.ts`, WASM, main-thread `go.run`) → `renderD2Graph`
  (`d2-render.ts`, builds SVG; uses a Canvas for text measurement). All on the main thread.
- No debounce specific to typing; no cancellation of a stale in-flight render; the offscreen-swap
  pattern exists for theme re-render but the edit path re-renders in place.

## Hard constraint: Web Workers in the VS Code webview
- CSP allows workers: `worker-src ${cspSource} blob:` (`src/html-builder.ts` `buildCspMeta`).
- **Trap:** a worker doing `importScripts(<cross-origin URL>)` HANGS — engine assets are served from a
  `vscode-cdn`/`vscode-resource` origin the worker treats as cross-origin (proven: graphviz blob-worker
  `importScripts` of `full.render.js` silently hung → memory `graphviz-render-and-theme`; stock ELK
  blob worker `layout()` rejected → memory `d2-elk-main-thread`, hence ELK's in-process "fake worker").
- **Workaround (established):** `fetch` the engine code as TEXT and build the worker from an inlined
  same-origin blob (no cross-origin `importScripts`). The D2 wasm itself is `fetch`ed + instantiated
  (already streaming, task 145) — a worker would do that inside the worker.

## Findings → work items (by ROI)

### 1. 🟠 Debounce the edit-time re-render (cheap, do first)
Re-render the diagram only after the user pauses (~200-300 ms idle), not on every input. Removes most
stutter on its own — the diagram updates shortly after you stop typing instead of fighting every
keystroke. Scope to the EDIT path (source-block typing), keep open/theme re-renders prompt.
- **Fix:** debounce the per-block re-render in `observeCustomDiagrams` (or a wrapper) keyed on the
  block being edited; coalesce bursts. Keep the existing rAF/running/dirty guard for non-edit mutations.
- **Measure:** a perf-timeline-style spec that types into a ` ```d2 ` block and records input→paint
  latency + render count per N keystrokes (before/after).

### 2. 🟠 Move D2 compile to an inline Web Worker + cancel stale renders (the real fix)
`compileD2(src) → graph JSON` is pure compute (no DOM) → ideal for a worker. Main thread then only:
debounce → `postMessage(src, seq)` → receive graph JSON → build SVG (`renderD2Graph`, cheap) → swap.
Typing never blocks on the ~470 ms boot or per-edit compile.
- **Fix:** an inline worker (fetch wasm_exec + the wasm as bytes, instantiate INSIDE the worker — avoids
  the cross-origin `importScripts` trap) that owns `bootD2`/`compileD2`; a request/response protocol with
  a monotonically increasing `seq`; **drop results whose `seq` is stale** (a newer keystroke superseded
  them). Keep the current main-thread `compileD2` as a fallback if worker construction fails (mirrors
  the ELK fake-worker fallback philosophy).
- **Risk:** worker lifecycle (one per editor? shared?), transfer cost of the graph JSON, the
  Canvas-text-measure in `renderD2Graph` must stay on the main thread (or use `OffscreenCanvas` for
  measurement in the worker — verify metrics match). Spike + bench against the main-thread path.

### 3. 🟡 Swap-when-ready (offscreen) on the edit path
Keep the previous diagram visible until the new SVG is ready, then swap atomically — no flash / layout
jump on every keystroke-render (the doc shouldn't jump while you type). Reuse the offscreen-swap pattern
already used by the theme re-render (`mermaid-retheme` etc.).

### 4. 🟡 Cancellation / staleness is mandatory, not optional
With async (debounced or worker) renders, a render in flight when a newer edit lands must be abandoned
(by `seq`), so the visible diagram always reflects the LATEST source and we don't waste cycles on
superseded renders. Applies to both step 1 (debounce) and step 2 (worker).

### 5. ⚪ Other engines — assess after D2
- mermaid / lighter SVG engines: debounce (step 1) likely suffices (render is fast).
- echarts / STL (three.js): if they stutter on edit, both support **OffscreenCanvas in a worker** —
  separate, larger per-engine work; record the decision, don't do speculatively.

## Out of scope
- Host-process (Node) rendering for live edit — adds IPC round-trip latency per keystroke-render;
  a webview worker has lower latency. (Host prerender stays for the OPEN path, task 50.)
- The one-time open burst — covered by task 145 (hljs preload + diagram-render yield).

## Tests / verification (per AGENTS)
- **measurement** — a real-VS-Code spec (extend `perf-timeline.spec.ts`) that programmatically types
  into a ` ```d2 ` source block and records: input-event→next-paint latency, renders per N chars,
  and that the visible SVG matches the FINAL source (no stale render). Before/after for steps 1 & 2.
- **unit** — the debounce/cancellation logic (seq supersedes) in isolation; the worker protocol
  (request/response, stale-drop) with a mocked worker.
- **e2e** — D2 still renders correctly after the worker move (existing `d2-theme`/`d2-elk`/
  `custom-diagrams-render` specs stay green); fallback path when worker construction fails.

## See also
- `media-src/src/custom-diagrams.ts` (`observeCustomDiagrams`, `renderD2`), `media-src/src/d2-wasm.ts`
  (`bootD2`/`compileD2`, streaming instantiate — task 145), `media-src/src/d2-render.ts`
  (`renderD2Graph`, canvas text measure), `media-src/src/elk-layout.ts` (the in-process fake-worker
  precedent), `media-src/src/load-script.ts`, `src/html-builder.ts` (CSP `worker-src`).
- Memories: `d2-elk-main-thread` (blob worker rejected → fake worker), `graphviz-render-and-theme`
  (cross-origin `importScripts` hang → inline the worker). Tasks: 145 (first-paint/perf), 123 (D2
  pipeline), 115 (libavoid WASM — another worker-candidate engine).
