# ADR-0005 — Architecture overview (system map)

- **Status:** Accepted
- **Date:** 2026-06-24
- **Tags:** architecture, overview, vditor, webview, d2, theming, build, testing
- **Related:** ADR-0003 (CSS theming architecture), ADR-0004 (patching Vditor at build time);
  `AGENTS.md`, `DEVELOPMENT.md`; tasks 104/119/122/123 (D2 pipeline), 82/84/85/109 (themes),
  86/89/90/91 (renderer theme pairing), 106 (callouts), 61 (minimal-diff writeback).
- **Note:** Numbering is project-global; ADR-0001/0002 cover the Marp feature on a separate branch.
  This ADR is also mirrored into the codebase-memory knowledge graph (`manage_adr`) so it loads
  into every session.

## Context

vMarkd has grown into a sizeable two-sided system (host extension + webview), with a heavily
patched Vditor engine, a full gallery of offline diagram renderers, a theme registry, and a
bespoke offline D2 layout/render pipeline. New contributors (human or agent) need one map of the
real architectural seams before touching code, and prior sessions kept re-deriving the same
structure. This ADR captures the high-level system map; ADR-0003/0004 cover the two deepest
decision areas (CSS theming, Vditor patching) in detail.

## Decision

Document the architecture as the following map and keep it current.

### Purpose

A fork of `vscode-markdown-editor`: a WYSIWYG / IR (instant-rendering) Markdown **custom text
editor** for VS Code, built on Vditor. Edits `.md` with full round-trip fidelity to the on-disk
Markdown, renders the full Vditor block gallery (mermaid, ECharts, mindmap, markmap, flowchart,
graphviz, abc, smiles, PlantUML, KaTeX, **D2**), follows the VS Code / GitHub theme, and works
**fully offline** under a strict CSP. Per-feature status lives in `tasks/NNN-*.md` (the source of
truth); `tasks/README.md` is a done-index.

### Stack

TypeScript (~259 files) across two sides; HTML/CSS harnesses + content themes. Editor engine =
**Vditor, vendored and source-patched** (never vanilla). **Lute** (Go→WASM) is the Markdown↔DOM
serializer, run in both the host (`src/lute-host.ts`) and the webview. Build = plain Node + esbuild
(`node build.mjs`, `media-src/build.mjs`); no foy/ts-node/Bun. Lint/format = Biome
(`npm run lint:ci`, whole tree). Tests = Vitest unit (`test/backend/**`, `media-src/src/**.test.ts`,
node env) + Playwright headless-chromium webview harnesses (`media-src/e2e/**`) + a real-VS-Code
Electron suite (`test/vscode-e2e/**`); run headless with `xvfb-run -a`. Diagram libs (dagre, ELK,
KaTeX, mermaid, ECharts, smiles-drawer, abc.js, Viz.js, markmap, flowchart.js) are vendored under
`media-src/vendor/` with a sha-guarded `source.json`.

### Architecture

Two cooperating sides linked by a `postMessage` protocol (`media-src/src/protocol.ts`):

1. **Host extension (`src/`)** — `extension.ts` registers the custom editor, reads config, builds the
   webview HTML + **CSP** (`html-builder.ts`: `default-src 'none'`, `object-src 'none'`, `script-src
   'unsafe-eval'`), host-prerenders via Lute, and does **minimal-diff writeback** so on-save only
   changed lines are rewritten. Host-isomorphic theme mapping: `theme-registry.ts`
   (`resolveContentTheme`, `autoCodeStyle`, `pairedPalette`), `mermaid-palettes.ts`
   (`MERMAID_PALETTES`, reused by mermaid/echarts/D2), `echarts-theme.ts`. Wiki-link resolution is
   cached (`wiki-cache.ts`).
2. **Webview (`media-src/src/`)** — `main.ts` boots Vditor, applies config + theme, and wires
   **MutationObserver decorators** bound to the stable `#app` mount so they survive Vditor's
   per-keystroke DOM rebuilds (callouts, code-source `.hljs` tagging, gap-paragraph cleanup, wiki,
   diagram zoom-gate, echarts-fit). Custom block rendering is dispatched by `custom-diagrams.ts`.

**Theme model — three kinds, never conflated:** (1) DOM+CSS inheriting `currentColor` (text, KaTeX);
(2) swapped stylesheet (highlight.js code blocks); (3) self-contained SVG/canvas with a baked palette
(every diagram). Live re-theme mirrors `reRenderMermaid` (offscreen render → atomic SVG swap).

**D2 offline pipeline (the most involved subsystem):**
`compileD2` (WASM, compile-only) → `layoutElk` (vendored ELK via a **main-thread fake worker** —
`elk-entry.ts` sets `window.__vmarkdElk` — to dodge the webview's blob-Worker/CSP rejection) **or**
`layoutDagre` → `refineLayout` (`d2-refine.ts`: ~15 ordered, crossing-guarded post-passes including an
A* back-edge router on a Hanan grid with a binary-heap + spatial index) → `toSVG` (`d2-render.ts`:
engine-neutral `Layout` IR → SVG). Shape geometry + sizing are a **faithful port of d2 v0.7.1
`lib/shape`** (person silhouette, deep cylinder/queue caps, stored_data/package/step/callout/
document/page/parallelogram). **Colour themes** live in a `D2_THEMES` registry resolved by
`d2Theme(name)`: d2-catalog palettes (token map leaf=B4/stroke B1, container=B5/B1, edge=B1, page=N7)
paint their own page background; editor-paired themes (vscode/github light+dark) reuse
`MERMAID_PALETTES` with subtle tints; `mono` (transparent, currentColor) is the legacy default.
Engine + theme are selected via `vmarkd.diagram.d2Layout` / `vmarkd.diagram.d2Theme`, threaded
host→webview as `window.__vmarkdD2Layout` / `__vmarkdD2Theme`.

### Patterns

- **Vditor override discipline** (see ADR-0004): never fork; (a) esbuild TS source patches in the
  `VDITOR_TS_PATCHES` registry, (b) one `index.css` patch in `build.mjs`, (c) runtime
  MutationObserver decorators on `#app`. `:focus-within` fails (CE host is an ancestor) → drive from
  `selectionchange`.
- **IR dual-node edit surface:** editable-source `<pre.vditor-ir__marker--pre>` + `<pre.vditor-ir__preview>`;
  tag the source `<code>` with `.hljs` so edit == render; bare wrapper spans are transparent to Lute.
- **currentColor + palette pairing** for diagram theming; `mix()`/palette data shared across mermaid,
  echarts, and D2.
- **Engine-neutral IR + guarded refinement:** both D2 engines emit one `Layout`; every refine pass
  reverts if it increases crossings/overlaps; `d2-quality.test.ts` freezes correctness over frozen
  raw-ELK fixtures (the safety net for any pipeline refactor).
- **Decoupling via window globals:** webview feature modules read `window.__vmarkd*` instead of
  importing `main.ts`.
- **Faithful-by-construction fallback:** unsupported D2 constructs (`unsupportedReason`) render raw
  source LOUDLY with a note — never a partial/wrong picture.

### Tradeoffs

- **Vendored + patched** Vditor/Lute/diagram libs: control + offline guarantee vs upstream-drift
  maintenance (mitigated by sha-guarded `source.json` + `?v=` cache-buster patches + anchor asserts).
- **ELK on the main thread:** sub-frame for small graphs and CSP-safe, but would block on a huge
  graph; graceful fallback to dagre on any ELK failure.
- **D2 colour themes paint their own background:** d2-faithful on any editor theme, but a light theme
  on a dark editor reads as a light card (intended); `mono` stays transparent to blend.
- **Headless-first testing:** fast CI, but a class of webview-only bugs (focus-scroll, blur-flash,
  VS Code-injected default CSS, custom-editor pipeline) reproduces ONLY in the real-VS-Code suite or
  must be verified interactively.
- **Byte-identical D2 perf work:** every optimization is held to byte-identical SVG output, limiting
  algorithmic freedom but protecting the rendered look.

### Philosophy

Offline-first and CSP-strict (no external host, ever). Round-trip fidelity to the on-disk Markdown
is sacrosanct (minimal-diff writeback, Lute-transparent decorations). Faithful rendering or a loud
fallback — never silently wrong. Thoroughness over spot-checks: complete audits for fidelity work,
unit + e2e + coverage for every feature, and visual/layout work steered by eye (render → show →
state the metric → pause). `tasks/NNN-*.md` is the status source of truth. The user controls all git
publish — build + install locally and wait for an explicit go. Keep the toolchain plain
(Node + npm + esbuild + Biome).

## Consequences

- **+** One canonical system map, in the repo (this file) **and** in the knowledge graph
  (`manage_adr`), so sessions stop re-deriving structure.
- **+** New work can be routed to the right seam (host vs webview, which theme mechanism, where in the
  D2 pipeline) by reading one document.
- **−** Overview docs drift if not maintained; keep this in sync when a subsystem changes shape
  (especially the D2 pipeline and the theme model), and update the mirrored graph ADR alongside.
