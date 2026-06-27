# Task 100 — ASCII STL interactive 3D models (GitHub parity)

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderStl` is wired in `custom-diagrams.ts`
> (three.js 0.184 vendored); status below is stale. Verify-first: orbit controls, lighting, and perf on
> large meshes. Mark done for the render once verified.
>
> **🐛 Fix 2026-06-27:** the model used the theme **foreground** (`currentColor`) as its material
> colour, so on every light content theme (e.g. github-light) the near-black foreground × three.js
> lighting rendered an **all-black, formless blob** (user report). Replaced with a fixed, theme-
> INDEPENDENT neutral mid-grey (`STL_MATERIAL_COLOR = #9aa0a6` in `custom-diagrams.ts`) — directional
> lighting now conveys 3D form on both light and dark. This supersedes the planned "material from the
> palette + live re-theme on flip" below: a shaded solid can't follow `currentColor` the way line-art
> SVG does (lighting MULTIPLIES the base; a near-black base can't be lit), so a neutral material is the
> correct, theme-agnostic choice and no live re-theme is needed. Tests: `media-src/src/stl-material.
> test.ts` (unit: mid-tone invariant) + `test/vscode-e2e/stl-material.spec.ts` (real-VS-Code: the
> canvas carries `data-stl-material="#9aa0a6"`; robust where the headless host has no WebGL context).
>
> **✅ Closed 2026-06-27:** verify-first done to the extent the environment allows.
> - **Bundle measured:** `media-src/vendor/threejs/three-stl.min.js` = **541 413 B (≈528.7 KB)**, the
>   tree-shaken STL viewer (Scene+Camera+Renderer+`STLLoader`+`OrbitControls`, three.js **0.184.0**, MIT).
>   Vendored + sha256-pinned (`source.json`), sha-gated by `build.mjs syncVendored`, lazy-loaded (only docs
>   with a ` ```stl ` block pay for it). Within the planned ~600 KB–1 MB budget — no slimmer viewer needed.
> - **Tests green:** unit `stl-material.test.ts` 2/2; real-VS-Code `stl-material.spec.ts` 1/1
>   (`data-stl-material=#9aa0a6`, headless via xvfb).
> - **Not verifiable here:** live orbit/zoom controls, directional lighting, and large-mesh perf are
>   **WebGL/GPU-only** — this WSL/xvfb host has no usable WebGL (ANGLE/Mesa `llvmpipe BindToCurrentSequence
>   failed`), so a full-render e2e can't assert them headless. The attribute spec is the headless-robust
>   proxy; full interactive verification belongs to a GPU/CI run or the user's editor. The render path,
>   material, bundle, and CSP fit (local-only, no remote, no eval) are confirmed.

> **Status:** ✅ DONE (render + material fix + bundle measured + tests; live orbit/lighting/perf is
> GPU-only, see closure note). Was: 📋 TODO (after [task 99](99-geojson-topojson-maps.md) — reuses its renderer pass).
> Render ` ```stl ` fenced blocks as interactive 3D models — a **GitHub-native** Markdown feature
> that vMarkd lacks. Offline via bundled three.js. Fully offline (no remote, WebGL/canvas only).
> **Source:** GitHub-parity gap (GitHub renders mermaid+geojson+topojson+**stl** natively); user request.
> **Value / Risk:** 🟡 parity / medium — three.js bundle size is the main cost.

## Problem
GitHub renders ` ```stl ` (ASCII STL) as an interactive 3D model (orbit/zoom); vMarkd shows a code
block. Parity, offline.

## Approach
1. **Reuse the custom fenced-renderer pass** from task 99 — register `{ lang: 'stl', fn }`.
2. **Lib** — **three.js** (MIT) + its `STLLoader` (ASCII). WebGL `<canvas>` + `OrbitControls`.
   Add as a `media-src` dep; **lazy-import** (three is ~600 KB–1 MB even tree-shaken) so docs
   without 3D models don't pay. Measure the bundled size; consider a slim import (only the core +
   STLLoader + OrbitControls, not the whole `three/examples`).
3. **Render** — parse the ASCII STL text → `STLLoader.parse` → mesh; basic scene (camera, light,
   orbit controls); size to the block; `data-processed` guard.
4. **CSP / offline** — WebGL canvas, **no remote** assets, no eval → fits our CSP as-is. ✅
5. **Theme** — model material + background from the palette (`accent`/`fg` mesh, surface/transparent
   bg) so it reads on light/dark. Live re-theme on flip.

## Risks / notes
- **Bundle size** is the real question (three.js). Lazy-load is mandatory; measure and record. If too
  heavy, consider a lighter STL viewer, but three.js is the standard.
- Interactive controls (orbit) need pointer events inside the webview — verify they don't fight the
  editor's scroll/caret handling.

## Tests (per AGENTS)
- **e2e** — a ` ```stl ` block renders a `<canvas>` (WebGL context present), not a code block; no
  remote request; theme flip updates material/bg.

## See also
- Skill `vmarkd-renderer-theming` (offline/CSP — three.js is fully local, the easy case).
- Task 99 (the renderer pass this reuses). [GitHub Docs — creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams).
