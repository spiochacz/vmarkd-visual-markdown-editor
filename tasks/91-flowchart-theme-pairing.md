# Task 91 — flowchart.js theme pairing (drawSVG styling options)

> **Status:** ✅ DONE (2026-06-16). `\`\`\`flowchart` follows the content theme. Two deviations from the
> plan below, found by real-editor probing: (1) flowchart.js can NOT use `currentColor` (its Raphael
> normalises it to a garbage `#6688cc`) and `fill:"transparent"` renders BLACK — so pass an EXPLICIT
> colour (the themed foreground via `getComputedStyle(item).color`, an rgb() string Raphael parses) +
> `fill:"none"`; the shared palette mapping (task 86) was NOT needed — a flowchart is monochrome
> line-art, so a single foreground for line/element/font + transparent fill is the right pairing.
> (2) `drawSVG(el, options)` is the real API. esbuild `patchFlowchartTheme` (esbuild-shared.mjs,
> registered in VDITOR_TS_PATCHES) rewrites the bare `drawSVG(item)`. Live re-theme: `reRenderFlowchart`
> (`media-src/src/flowchart-retheme.ts`, wired into `handleSetTheme` + `handleConfigChanged` via
> `reThemeFlowchart`, which POLLS until the foreground settles — the content-theme `<link>` applies
> late). Tests: 3 patch unit tests + `flowchart-theme.spec.ts` (open + live flip). No version bump.
> **Source:** renderer-theming audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟢 readability/cohesion / low — additive, no asset change, no version bump.

## Problem
flowchart.js renders to SVG via Raphael with **baked black** colors. `flowchartRender.ts` does:
```js
flowchart.parse(text).drawSVG(item)   // no options → default black on transparent
```
On a dark content theme the lines/text are near-invisible, and it never matches the chosen
palette. Like every non-mermaid renderer it also **paints once** — a live theme flip leaves it
stale until reopen (only Mermaid re-renders live, task 59).

## The lever (already available — no bump needed)
flowchart.js's real API is **`drawSVG(element, options)`** — Vditor's type decl omits the 2nd
arg, but the bundled `flowchart.min.js` supports the styling keys (verified present:
`line-color`, `element-color`, `font-color`, `fill`, `line-width`, + per-symbol overrides).
So theming is a matter of passing an options object. **No version bump**: the bundled build
already supports this, there's no `?v=` cache-buster, and `flowchart.js` latest (1.18.0,
2023-12) is a slow niche project — a bump would add only minor fixes at fidelity risk. Skip it.

## Approach (mirror task 86; see the `vmarkd-renderer-theming` skill — 3 layers)
1. **Mapping (SHARED)** — reuse `pairedPalette(contentTheme)` + `MERMAID_PALETTES` data
   (the registry `palette` field; if task 90 hasn't renamed `mermaid`→`palette` yet, do it
   here or coordinate). Renderer-agnostic.
2. **Translation (per-engine, new)** — `paletteToFlowchartOptions(palette)`:
   `{ 'line-color': line, 'element-color': line, 'font-color': fg, fill: bg-surface,
   'line-width': … }` (+ `yes-text`/`no-text` colors if needed) from `{bg,fg,line,accent}`.
   Reuse the hex helpers in `mermaid-palettes.ts`.
3. **Application (per-engine)** — patch `flowchartRender.ts` via esbuild (mirror the other
   vditor patches in `media-src/esbuild-shared.mjs`) so `drawSVG(item, options)` receives the
   resolved options. Anchored on `drawSVG(` so a Vditor drift fails the build loudly.
4. **Live re-render** — mirror `reRenderMermaid`'s offscreen-swap (`media-src/src/mermaid-retheme.ts`)
   for flowchart, wired into `main.ts` `handleSetTheme` + `handleConfigChanged`
   (on `contentThemeChanged`). flowchart re-parse+redraw is cheap.

## Tests (per AGENTS)
- **Unit** — `paletteToFlowchartOptions` mapping (hex passthrough for `font-color`/`line-color`
  from `fg`/`line`; valid hex).
- **e2e** — a `\`\`\`flowchart` block renders with the palette's colors (assert an svg
  `stroke`/`fill` matching `line`/`fg`, not black); switching the content theme re-renders it.

## See also
- Skill `vmarkd-renderer-theming` (three layers; shared mapping vs per-engine translation; the
  "identify the lever before bumping" call that ruled out a version bump here).
- Task 86 (Mermaid pairing — precedent), task 90 (ECharts pairing — does the registry
  `mermaid`→`palette` rename; coordinate), task 59 (`reRenderMermaid` to mirror).
- `media-src/node_modules/vditor/src/ts/markdown/flowchartRender.ts`.

## Note for the wider sweep
Same shape applies to the other baked-palette renderers — **graphviz** (DOT default colors;
themeable via graph/node/edge attrs) and **abc.js** (`renderAbc` has a foreground/color option).
markmap is harder (its own palette). If a "theme all diagrams" effort happens, this task is the
template; each just needs its own `paletteTo<Engine>` translation.
