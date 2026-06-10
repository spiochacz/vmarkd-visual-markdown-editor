---
name: vmarkd-renderer-theming
description: Use when theming / adding color or dark-mode support to any rendered block in the vMarkd editor — diagrams (mermaid, ECharts, mindmap, markmap, flowchart, graphviz, plantuml, abc, smiles), code blocks (highlight.js), or math (KaTeX). Captures the three theming models, the per-renderer application mechanism, the build/CSP/version gotchas, and exact file locations.
---

# vMarkd renderer theming

How each rendered block gets its colors, and the traps. vMarkd renders Markdown via
**Vditor**; Vditor bundles a separate engine per block type. They do **not** share a
theming mechanism — that's the #1 source of mistakes.

## The three theming models (know which one a renderer uses BEFORE touching it)

1. **DOM + CSS (inherits `currentColor`)** — text, inline code, **KaTeX math**.
   Renders to HTML that inherits `color` from the themed `.vditor-reset`. **Follows the
   content theme for free** — no flag, no re-render. KaTeX (`mathRender.ts`) takes no
   theme/color param at all.

2. **Separate stylesheet, swapped** — code blocks = **highlight.js**.
   A `<link id="vditorHljsStyle">` swapped via `setTheme`. Paired with the content theme
   by `autoCodeStyle()` in `src/theme-registry.ts` (`code` field). One of ~73 hljs styles.

3. **Self-contained SVG/canvas with a baked palette** — every **diagram** renderer.
   The output does NOT inherit page CSS, so it must be told its palette explicitly.
   This is where all the work (and gotchas) live.

## Per-renderer reality (fence token → engine → how it themes)

| ` ```token ` | Engine | Theme input | Reacts to theme? |
|---|---|---|---|
| `mermaid` | Mermaid (vendored 11.15.0) | `initialize({theme, themeVariables})` | ✅ full palette pairing (task 86) |
| `echarts` | Apache ECharts 5.5.1 | `registerTheme()` + `init(el, name)` | ◑ binary dark/light only (built-in `dark`); **task 89** = pair it |
| `mindmap` | ECharts tree | `init(el, theme)` + hardcoded colors | ◑ partial (some colors baked) |
| `smiles` | smiles-drawer | `draw(code, id, 'dark'\|undefined)` | ◑ binary dark/light |
| `markmap` | markmap | none | ❌ baked palette |
| `flowchart` | flowchart.js | none | ❌ baked (black) |
| `graphviz` | Viz.js | none (DOT defaults) | ❌ baked |
| `abc` | abc.js | none | ❌ baked (black) |
| `plantuml` | plantuml-encoder | remote `<object>` | ⛔ **blocked by CSP `object-src 'none'`** (task 87 = TeaVM offline) |
| `$…$` `$$…$$` | KaTeX | none (currentColor) | ✅ inherits CSS |

`previewRender.ts` threads `mergedOptions.mode` (the editor dark/light) to the renderers
that accept a theme arg (`chartRender`, `mindmapRender`, `SMILESRender`, `mermaidRender`).
The rest get nothing.

## How mermaid theming actually works — THREE distinct layers (don't conflate them)

The mistake to avoid: "mermaid pairs via the registry mapping." The mapping only *picks a
palette*; the *style* is applied by mermaid's own engine. Three separate steps:

1. **Mapping (renderer-agnostic)** — `src/theme-registry.ts`: `ThemeDef.mermaid` holds a
   palette id; `autoMermaidTheme(contentTheme)` = `themeDef(contentTheme)?.mermaid`. Returns
   only a string (e.g. `'one-dark'`). Selects *which* palette. (github→github,
   material-dark→one-dark, vscode-light→zinc-light, vscode-dark→zinc-dark.)
2. **Translation (mermaid-specific)** — `resolveMermaidInit()` (`media-src/src/mermaid-theme.ts`)
   takes the id → `MERMAID_PALETTES[id]` (`{bg,fg,line,accent,muted}`, in
   `src/mermaid-palettes.ts`) → `paletteToThemeVariables()` → `{theme:'base', themeVariables}`.
3. **Application (mermaid-specific)** — `applyMermaidTheme()` wraps `mermaid.initialize(cfg)`
   to merge `{theme:'base', themeVariables}`. **Mermaid's own theme engine** consumes
   `themeVariables`.

**Reusable across diagram renderers:** only layer 1 (the mapping) + the palette DATA
(`MERMAID_PALETTES` — generalize the registry field name `mermaid` → `palette` if a second
renderer adopts it). Layers 2 + 3 are per-engine: ECharts wants `registerTheme` with
`{color:[…], backgroundColor, textStyle, axisLine…}`, NOT `themeVariables`.

## Gotchas (the expensive-to-rediscover ones)

- **Vditor hardcodes asset cache-busters.** `mermaidRender.ts` loads `mermaid.min.js?v=11.6.0`,
  `chartRender.ts` loads `echarts.min.js?v=5.5.1`. If you vendor a newer asset, ALSO bump the
  `?v=` via an esbuild patch (`media-src/esbuild-shared.mjs`, see `fixMermaidVersion`), else a
  cached webview serves the old bytes across an extension update.
- **Overriding a Vditor-bundled asset = overwrite AFTER sync.** `build.mjs` `syncVditorAssets()`
  copies Vditor's whole `dist/` into `media/`. To pin your own (lute, mermaid) you overwrite
  `media/vditor/dist/js/<x>/…` in a step that runs AFTER it (`syncLute`, `syncMermaid`), with a
  sha256 guard against `media-src/vendor/<x>/source.json`. The 11.6.0 etc. still lives in
  `node_modules/vditor` (the dependency) — gitignored, overwritten in output, never shipped.
- **CSP is the boundary** (`src/html-builder.ts`): `default-src 'none'`, `object-src 'none'`
  (kills PlantUML's remote `<object>`), `img-src … data: blob:` (so PNG/inline data renders),
  `style-src 'unsafe-inline'` (so inline SVG `<style>` works), `script-src 'unsafe-eval'`
  (+ `wasm-unsafe-eval` would be needed for any WASM engine). No external host is allowed —
  any CDN-loading engine (e.g. CheerpJ → `leaningtech.com`) breaks offline + needs a CSP hole.
- **Only mermaid re-renders on a LIVE theme flip.** `reRenderMermaid` (task 59,
  `media-src/src/mermaid-retheme.ts`) renders OFFSCREEN then swaps the SVG in atomically (an
  in-place re-render collapses the diagram to source text → shrinks the doc → scrolls to top,
  the reported bug). Every other renderer paints once; a VS Code dark↔light flip leaves it
  stale until reopen. Wiring lives in `main.ts` `handleSetTheme` + `handleConfigChanged`
  (re-render on BOTH `mermaidThemeChanged` and `contentThemeChanged`).
- **The mermaid e2e harness calls the functions directly**, not via the host message path
  (`media-src/e2e/mermaid-harness.ts` exposes `__applyTheme`/`__reTheme`). So `handleConfigChanged`
  wiring is covered by unit + code inspection, not e2e. Don't claim message-path e2e coverage.
- **PlantUML offline: TeaVM, not CheerpJ.** `plantuml-core`/`plantuml.js` use CheerpJ (runtime
  CDN-locked, ~17 MB, not self-hostable). The main `plantuml/plantuml` repo has a **TeaVM**
  build (`teavm.sh` → `./gradlew teavm`) = self-hostable plain JS, SVG output, reuses Viz.js
  (which we already bundle). See task 87.
- **Palette data is MIT and renderer-agnostic.** `MERMAID_PALETTES` are the 15 Beautiful
  Mermaid palettes (`lukilabs/beautiful-mermaid`, MIT, © Craft Docs) — just `{bg,fg,line,
  accent,muted}` hex. `muted` is currently parsed but unused by `paletteToThemeVariables`.

## File map

- Vditor engines: `media-src/node_modules/vditor/src/ts/markdown/{mermaid,chart,mindmap,markmap,flowchart,graphviz,plantuml,abc,SMILES,math}Render.ts` + `previewRender.ts` (the dispatcher).
- Our theming: `src/theme-registry.ts` (mapping + `autoCodeStyle`/`autoMermaidTheme`),
  `src/mermaid-palettes.ts` (palettes + `paletteToThemeVariables`),
  `media-src/src/mermaid-theme.ts` (`resolveMermaidInit`, `applyMermaidTheme`),
  `media-src/src/mermaid-retheme.ts` (`reRenderMermaid`).
- Build/patches: `build.mjs` (`syncVditorAssets`, `syncLute`, `syncMermaid`, `varifyVditorPalette`),
  `media-src/esbuild-shared.mjs` (vditor source patches incl. `fixMermaidVersion`).
- CSP: `src/html-builder.ts`. Vendored assets: `media-src/vendor/<engine>/` (+ `source.json` sha guard).
- Related tasks: 82/84/85 (content themes + registry), 86 (mermaid palettes), 87 (PlantUML/TeaVM),
  89 (ECharts pairing, if created).

## When adding theming to a new diagram renderer

1. Identify its model (almost always #3 — self-contained, baked).
2. Reuse layer 1 (registry palette mapping) + `MERMAID_PALETTES` data.
3. Write a per-engine translation (palette → that engine's theme format).
4. Apply it the engine's way (init param / register API) — patch Vditor's `*Render.ts` via
   esbuild if it hardcodes the theme.
5. Wire a live re-render (mirror `reRenderMermaid`'s offscreen-swap) into `handleSetTheme` +
   `handleConfigChanged`.
6. Test: unit (mapping + translation) + e2e (renders with the palette colors; reacts to a flip).
