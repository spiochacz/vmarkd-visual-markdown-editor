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

> **Status:** 📋 TODO (after [task 99](99-geojson-topojson-maps.md) — reuses its renderer pass).
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
