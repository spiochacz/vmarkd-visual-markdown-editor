# Task 165 — Code-split the D2 layout pipeline out of the eager bundle

**Status:** TODO (medium; the cleanest remaining application of "main.js = GLUE ONLY", elk-entry precedent makes it low-risk).
**Source:** vMark perf analysis (2026-06-28, 39-agent workflow `wf_19aa433d-4fa`).
**Value / Risk:** 🟨 medium (removes ~109 KB / 23% parse + top-level module-eval from editor startup for every non-D2 doc) / 🟢 low (proven IIFE-bundle precedent; D2 render is already async-gated).
**Engines:** D2 (and its bundled dagre).

## Problem

The whole D2 layout cluster is **statically** pulled into the eager `media/dist/main.js`
(`finish-init.ts` → `custom-diagrams.ts:8-15` imports `renderD2Graph`/`canvasMeasure`/
`unsupportedReason`/`d2Theme` from `./d2-render` and `renderD2GraphElk` from `./elk-layout`), yet it
executes **only** for `.language-d2` blocks. Verified bytes in `media/dist/main.meta.json`:

```
dagre 40424 + d2-render 33855 + d2-refine 20887 + elk-layout 5174 + astar 3773
+ d2-geometry 3314 + d2-wasm 1038 + faithful-render 483 + d2-config 364  ≈ 109 KB
= 22.9% of main.js's ~477 KB total.
```

`custom-diagrams.ts` is the **sole** eager runtime entry into the cluster (the other runtime
importers — `elk-layout.ts:24`, `d2-refine.ts:10` — are inside it; dagre's only importer is
`d2-render.ts`), so it code-splits behind one boundary. Task 145 audited bundle perf but never
proposed this split; the 525 KB budget ceiling (`scripts/check-bundle-size.mjs:13`) doesn't catch
the eager-parse cost (main.js is ~466 KB, under budget).

> **Impact is real but bounded:** the 109 KB is served from a local `vscode-resource` origin (no
> network), so the saving is **parse + top-level module-eval** at startup (dagre's ESM has
> non-trivial init) — a few ms, not a dramatic TTI win. Frame it honestly; substantiate with a
> before/after first-paint timing in the real webview.

## Plan (mirror the proven `elk-entry.ts` / `elk-main.js` IIFE precedent — `build.mjs:34-46`)

1. **`media-src/src/d2-entry.ts`** — IIFE entry assigning
   `window.__vmarkdD2 = { renderD2Graph, renderD2GraphElk, canvasMeasure, unsupportedReason, d2Theme, faithfulRender }`
   (same shape as `elk-entry.ts` → `window.__vmarkdElk`). **Main thread, no Worker/blob** (D2's
   dagre+refine+astar and ELK both already run on the main thread — keep it that way).
2. **`media-src/build.mjs`** — add a `d2Options` block mirroring `elkOptions`, outfile
   `media/vditor/dist/js/d2/d2-main.js`.
3. **`custom-diagrams.ts`** — replace the static imports (8-15) with an `addScript('.../d2-main.js')`
   (the helper at `custom-diagrams.ts:47`, already used at 231/288/493/637/783) **inside the existing
   async `compileD2(cdn, code).then(async ...)`** (line 341) — all the synchronous engine calls
   (`d2Theme:374`, `renderD2GraphElk:383`, `renderD2Graph:392`) already live in that `.then`, so the
   `addScript` resolves before reading the engine off the global. dagre then leaves main.js
   **entirely** (it's not in `elk-main.js`). Keep the tiny `d2-config` (364 B) **eager** as the
   shared settings channel.
4. **`scripts/check-bundle-size.mjs`** — lower the main.js ceiling (~420 KB) and add a `d2-main.js`
   budget **in the same change** (or CI's 525 KB ceiling won't reflect the new layout).

## Constraints
- CSP / Worker-rejection: use the `addScript` script-tag pattern like `elk-main.js`, **never** a Web
  Worker/blob (the stock ELK blob worker rejects in the webview).
- Lute round-trip: the `window.__vmarkdD2` bridge must inject **no** DOM into the editable surface
  (elk-main.js already satisfies this); rendered SVG + `data-processed`/`data-d2-engine` attrs
  (`custom-diagrams.ts:393-396`) unchanged.
- Caret/scroll: the `addScript` is awaited inside the existing async `compileD2().then`, so first-D2
  render gains a **one-time** script-fetch latency only; preserve the post-render `themeSvg`/caret
  behaviour.
- Source-path test imports (`d2-render.test.ts:2`, `d2-quality.test.ts:15-17`, `elk-layout.test.ts`,
  `astar.test.ts`, `faithful-render.test.ts`) import from **source** modules, not the bundle, so they
  stay intact.

## Verification
- **Real-VS-Code e2e (MANDATORY)** in `test/vscode-e2e/`: a `.language-d2` block still renders
  (`data-d2-engine` set, SVG produced) after the now-lazy load — do **not** defer to the user.
- Bundle-size gate green with the new ceilings; `main.meta.json` confirms dagre + d2-* no longer in
  main.js.
- **Before/after first-paint timing** in the real webview (task 145's verification ask) to
  substantiate the win, not assert it.
- Keep `d2-theme`/`custom-diagrams-render` specs green. `tsc` + `biome` + vitest + Playwright,
  headless (`xvfb-run -a`). Verify coverage.

## See also
- `elk-entry.ts` + `build.mjs:34-46` (the precedent), memory `d2-elk-main-thread` + ADR-0004
  (main-thread ELK boot), task 145 (bundle perf audit — this is the unaddressed follow-up), task 104
  (D2 renderer).
