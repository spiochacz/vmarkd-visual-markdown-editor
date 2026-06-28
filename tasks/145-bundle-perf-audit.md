# Task 145 — Bundle size / lazy-load / first-paint perf

> **Status:** ✅ DONE 2026-06-28 — items 1,2,3,5 implemented; items 4,6 resolved as recorded decisions.
> Created 2026-06-24 from a measured bundle/perf audit of the webview.
>
> **🟢 Done 2026-06-28 (gates green; D2 render re-verified in the real webview):**
> - **3 (size budget — the regression net):** esbuild now emits a `metafile` (media/dist/main.meta.json,
>   gitignored) and `scripts/check-bundle-size.mjs` (npm `check:bundle-size`) fails if `main.js` (525 KB
>   budget; now 460) or `elk-main.js` (1600 KB; now 1421) exceed budget — catches an engine leaking
>   into the eager bundle or dep bloat. Wired into CI as a "Bundle-size budget" step after Build.
> - **1 (hljs no longer competes with first paint):** the ~2.1 MB eager `ensureHljsLoaded` is DEFERRED
>   to `requestIdleCallback` (setTimeout fallback) in finish-init.ts — chose option (b) as
>   no-regression-by-construction (the script still loads, just past first paint; WYSIWYG live-highlight
>   keeps working, IR code is highlighted by Vditor's own lazy hljs regardless). Verified: webview.spec
>   "collapsed code block == preview height" still passes.
> - **2 (D2 wasm streaming-instantiate):** `bootD2` now prefers `WebAssembly.instantiateStreaming`
>   (compiles WHILE the wasm downloads) with a try/catch fallback to the buffered
>   fetch→arrayBuffer→instantiate path — low-risk: if the vscode-resource origin serves the wrong MIME
>   (no `application/wasm`), streaming throws and the fallback runs. `logToHost` records which path ran
>   so the MIME behaviour is verifiable in the Output channel. Verified: d2-theme.spec renders (3/3).
> - **5 (stale .vsix):** deleted `vmarkd-1.0.0.vsix` + `vmarkd-1.2.0.vsix` from the working tree;
>   `*.vsix` was already in `.gitignore` (so they can't recur).
>
> **🟢 Recorded decisions (no code):**
> - **4 (d2 wasm size):** largely OBSOLETED by the TinyGo rebuild (2026-06-25, task 124-era):
>   d2-compile.wasm went **11.2 MB → 1.8 MB** (−84%), so it no longer dominates the VSIX. Streaming
>   (item 2) is the remaining latency lever; shipping it pre-compressed is NOT worth it (the VSIX is
>   already zip-compressed, so the only win would be installed-on-disk footprint of a now-1.8 MB file).
> - **6 (lute 3.5 M eager host-side):** accepted — it's core (instant-paint teaser + serialization,
>   can't be lazy); the `.map` is already excluded from the VSIX. No action.
>
> **🟢 Perf follow-up 2026-06-28 (item 1 redone after a user-reported regression; measured in real VS Code):**
> The item-1 `requestIdleCallback` defer REGRESSED perceived load: on a diagram-heavy doc the main
> thread stays busy, so the idle callback starved and code colouring loaded LAST (behind the diagrams).
> Measured with `test/vscode-e2e/perf-timeline.spec.ts` (15-diagram fixture), code COLOURED:
> - defer (shipped): ~4.8 s · revert to eager: ~4.0 s · **+ host hljs preload: ~1.3 s.**
> Fixes:
> - **Reverted the defer** → eager `ensureHljsLoaded` (finish-init.ts): `addScript` is async and does
>   NOT block first paint, so deferring only pushed colouring behind the diagram burst.
> - **Host-side hljs preload** (html-builder.ts): inject `vditorHljsScript`/`vditorHljsThirdScript`
>   BEFORE main.js — but ONLY when the prerendered HTML contains a code fence, so no-code docs don't pay
>   the 2.1 MB. Same ids as Vditor's highlightRender + our ensureHljsLoaded ⇒ both dedupe. window.hljs
>   is ready before the render burst ⇒ code colours at ~1.3 s instead of ~4.8 s.
> - **Yield between custom-diagram renderers** (custom-diagrams.ts `observeCustomDiagrams`): the 8
>   engines ran in one synchronous rAF, monopolising the thread; now they yield a frame between each
>   (re-entrant-safe), so colouring/paint interleave (D2 ~6.5 s → ~5.6 s). Diagram serialization (the D2
>   ~470 ms wasm boot etc.) is the remaining inherent cost — item-4 territory, single-threaded by nature.
>
> **Source:** architecture review (2026-06-24), measured against the current build + vendored assets.
> **Value / Risk:** 🟢 faster first D2/code render + a guard against silent size growth / low —
> mostly load-strategy + CI gate, no behavioural change.

## Measured baseline (2026-06-24)
- **Eager webview bundle** `media/dist/main.js` = **443 KB** — our glue ONLY; **zero engines are
  bundled** (esbuild entry `media-src/build.mjs:13`). ✅ Strong: every engine is an external
  script-tag / fetch loaded on demand.
- **Runtime = pay-per-use.** Engines load lazily: D2 wasm via `fetch` (`d2-wasm.ts:90`), ELK via the
  separate `elk-main.js` bundle (`elk-layout.ts:46`), leaflet/vega/hljs/katex via `addScript`. ✅
- **VSIX ships everything though** — `vmarkd-1.2.0.vsix` = **10.3 MB** (v1.0.0 was 5.1 MB → doubled).
- Installed `media/vditor/dist/js/` heavy hitters: **d2 11 M** (single `d2-compile.wasm`),
  **plantuml 8.6 M**, lute 3.5 M, mermaid 3.2 M, hljs 2.1 M, katex 1.5 M, elk 1.4 M, echarts 1.1 M.

## Findings → work items (by ROI)

### 1. 🟢 highlight.js (2.1 M) eager-loads on EVERY open — DONE 2026-06-28 (deferred to requestIdleCallback)
`ensureHljsLoaded` (`media-src/src/wysiwyg-code-highlight.ts:40`, called from `main.ts:473`) pulls
`highlight.min.js` + `third-languages.js` on init regardless of whether the document has a code
block. It's the only heavy **eager runtime** cost (deliberate: WYSIWYG live-highlight from the
start; dedupes with Vditor's later lazy load).
- **Options:** (a) gate the eager load on `document` actually containing a `code`/`pre` block (most
  docs that do, do early; most that don't never pay); (b) defer to `requestIdleCallback` so it
  doesn't compete with first paint; (c) keep eager but measure the cost first. Decide with a
  before/after first-paint measurement — don't regress WYSIWYG live-highlight.

### 2. 🟢 D2 wasm is not streaming-instantiated — DONE 2026-06-28 (instantiateStreaming + fallback)
`bootD2` does `fetch → resp.arrayBuffer() → WebAssembly.instantiate(buf)` (`d2-wasm.ts:90-96`).
`WebAssembly.instantiateStreaming(fetch(...), importObject)` compiles **while** the 11 M downloads →
shorter first-D2-render latency (cold init ~470 ms today).
- **Catch:** streaming needs the `.wasm` served with `Content-Type: application/wasm`. The webview
  serves from a `vscode-resource`/`vscode-cdn` origin — **verify the MIME in the real webview**; if
  it's wrong, `instantiateStreaming` throws → keep the current `arrayBuffer` path as a fallback
  (try/catch). Low risk with the fallback.

### 3. 🟢 No bundle-size budget / metafile in CI — DONE 2026-06-28 (metafile + check:bundle-size in CI)
`main.js` and the VSIX grew silently (5.1 → 10.3 MB across releases) with no gate. Emit an esbuild
`metafile` from `media-src/build.mjs` and add a CI check that fails if `main.js` (or the VSIX)
exceeds a budget. Catches accidental engine-into-bundle leaks and dependency bloat.

### 4. 🟢 d2 wasm (11 M) dominates the VSIX for a niche renderer — RESOLVED (TinyGo cut it to 1.8 M)
Already lazy at runtime and the build stubs the latex/d2fonts embeds
(`media-src/vendor/d2/build/stub-*.go`, per `build-notes.md`) — good. The remaining lever is mostly
streaming (#2). Optionally explore shipping the wasm pre-compressed + decompressing in JS, but the
VSIX is already zip-compressed so the win is only the installed-on-disk footprint — likely not worth
the complexity. Record the decision either way.

### 5. 🟢 Stale `.vsix` artifacts in the repo root — DONE 2026-06-28 (deleted; already gitignored)
`vmarkd-1.0.0.vsix` + `vmarkd-1.2.0.vsix` (~15 M) sit in the working tree. Not shipped (not in
`media/`), but clutter — add `*.vsix` to `.gitignore` and clean them.

### 6. 🟢 lute (3.5 M) eager host-side — ACCEPTED (no action, core)
Loaded host-side for the instant-paint teaser + serialization (core, can't be lazy). `.map` (440 K)
is already excluded from the VSIX (`.vscodeignore **/*.map`). No action — recorded for completeness.

## Tests / verification (per AGENTS)
- **measurement** — capture first-paint + first-code-render + first-D2-render timings before/after
  items 1 & 2 (Output-channel timing logs, per the debug-metrics-to-Output-channel pattern), in the
  real VS Code webview (lazy-load + MIME behaviour don't reproduce in the Playwright harness).
- **CI** — item 3's size-budget check is the regression net for the whole task.

## See also
- Skill `vmarkd-renderer-theming` (the `addScript` cache-buster + vendored-asset sync model — every
  engine loads this way). Build: `media-src/build.mjs` (entry + `elk-entry` separate bundle),
  `build.mjs` (`sync*` steps), `.vscodeignore`. D2 wasm: `media-src/src/d2-wasm.ts`. hljs eager:
  `media-src/src/wysiwyg-code-highlight.ts`. Task 144 (PlantUML 8.6 M — the other big shipper).
