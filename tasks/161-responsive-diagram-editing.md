# Task 161 — Responsive diagram editing (debounce + off-main-thread D2 compile)

> **Status:** 📋 TODO — created 2026-06-28 from a live-editing responsiveness investigation
> (follow-up to task 145's first-paint/perf work).
> **Source:** user report — editing a diagram's source in a code block, while the diagram re-renders
> below ("praktycznie co znak"), makes the UI stutter. Measured in the real VS Code webview
> (`test/vscode-e2e/perf-timeline.spec.ts` pattern).
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
