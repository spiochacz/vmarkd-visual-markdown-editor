# Task 90 — ECharts theme pairing (registerTheme + palette from content theme)

> **Status:** ✅ done (2026-06-10, branch `feat/echarts-theme`). ECharts charts now follow the
> content-theme palette and re-theme live. Implementation:
> - **Layer 1 (shared mapping)** — generalised the registry: `ThemeDef.mermaid` → `palette`,
>   `autoMermaidTheme` → `pairedPalette` (mermaid caller + test updated). One "diagram palette"
>   per content theme, shared by mermaid + echarts.
> - **Layer 2 (translation)** — new `src/echarts-theme.ts`: `paletteToEchartsTheme(palette)` →
>   an ECharts theme object (`color` series palette via golden-angle hue rotation off `accent`,
>   `backgroundColor`/`textStyle`/axes/grid/legend/tooltip from `bg`/`fg`/`line`/`muted`); reuses
>   the hex helpers (now exported) from `mermaid-palettes.ts`. `resolveEchartsTheme(contentTheme,
>   mode)` → `{name:'vmarkd', theme}` when paired, else built-in `dark`/default.
> - **Layer 3 (application)** — `media-src/src/echarts-apply.ts` installs
>   `window.__vmarkdEchartsResolve`; esbuild `fixEcharts` (merged with the task-89 `?v=` patch,
>   since esbuild runs one onLoad per file) rewrites Vditor's hardcoded `echarts.init(e, theme…)`
>   to consult it (registers the derived theme at point-of-use — the ECharts UMD populates
>   `window.echarts` by mutation, so a setter-hook like mermaid's would see an empty object).
> - **Live re-render** — `media-src/src/echarts-retheme.ts` `reRenderEcharts` restores each
>   chart's JSON source from the sibling marker, disposes the instance, and re-runs the patched
>   `chartRender` (DRY). In-place (no offscreen swap needed — a canvas in a sized container
>   doesn't collapse like mermaid's SVG). Wired into init + `handleSetTheme` + `handleConfigChanged`
>   (on `contentThemeChanged`).
>
> **`vmarkd.theme.echarts` setting** (added on request): `auto` (default — follows
> `theme.content`, the paired `vmarkd` palette) + ECharts' built-in `light`/`dark` + 6 vendored
> gallery themes (vintage, macarons, infographic, roma, shine, tech-blue — the set echarts@6.1.0
> ships under `theme/`; the modern westeros/walden/chalk set isn't in 6.1.0). The gallery theme
> objects are extracted from echarts' UMD `theme/*.js` (run through an AMD shim) into a generated
> data module `src/echarts-gallery.ts` by `media-src/scripts/fetch-echarts-themes.mjs`, then
> registered by `applyEchartsTheme` — offline, CSP-safe, no runtime eval (Apache-2.0, same as
> echarts). Host passes `theme.echarts` in `collectConfigOptions`; webview threads it through all
> three `resolveEchartsTheme` sites + re-renders on `echartsThemeChanged`. Manifest enum kept in
> sync with `ECHARTS_THEME_VALUES` by a parity unit test. Bundle +~10 KB (gzips small).
> (Regenerating the gallery: `node media-src/scripts/fetch-echarts-themes.mjs <ver>` then
> `npm run lint:fix` — the generator emits JSON-indented data biome reformats.)
>
> **Re-render hardening (after a "chart breaks after a few content-theme switches" report):**
> `reRenderEcharts` no longer delegates to Vditor's async `chartRender` (its `addScript().then`
> raced on rapid switches, and the `data-processed` guard could let a stale render win or leave a
> blank chart). It now re-inits **synchronously** (echarts is already loaded) and **captures the
> container size before `dispose`**, passing it back to `init` — disposing clears echarts' inline
> width/height, and mid-CSS-reflow the bare container can measure 0×0, rendering an empty chart.
> Guarded by an e2e that flips the theme 5× and asserts the canvas never collapses to 0×0 or
> duplicates. (The headless harness couldn't reproduce the original collapse — it reads the theme
> via `getOption().backgroundColor`, which stays correct even on a 0×0 canvas — so this was
> diagnosed by hypothesis + verified in the real editor.) Tests: unit `echarts-theme.test.ts` (7, translation + resolver + all-palette hex) +
> e2e `echarts.spec.ts` (renders on 6.1.0, adopts github-dark bg `#0d1117`, live switch →
> github-light `#ffffff`). Mermaid e2e (10) still green after the rename; whole-tree lint +
> typecheck + 602 unit green; installed locally.
> Original plan:
> Make `\`\`\`echarts` charts follow the chosen content theme — the same way Mermaid does (task
> 86), reusing the shared palette mapping but with an ECharts-specific translation + application.
> **Source:** renderer-theming audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟡 cohesion / low-medium — additive; main risk is mapping the palette to
> ECharts' richer theme object across chart types.

## Problem
ECharts only reacts **binary dark/light** and doesn't pair with the content theme:
`chartRender.ts` hardcodes `echarts.init(e, theme === "dark" ? "dark" : undefined)` — built-in
`dark` or default (light), nothing else. And like every non-mermaid renderer it **paints once**:
a live VS Code / content-theme flip leaves the chart stale until reopen (only Mermaid re-renders
live, task 59). Our bundled `echarts.min.js` **has `registerTheme`**, so proper theming is
available — it's just not wired.

## Key distinction (from the skill — do NOT conflate)
Mermaid theming is THREE layers; only the first is renderer-agnostic:
1. **Mapping (SHARED)** — `src/theme-registry.ts` content-theme → palette id (`autoMermaidTheme`),
   over the renderer-agnostic palette **data** (`MERMAID_PALETTES`, `{bg,fg,line,accent,muted}`).
2. **Translation (per-engine)** — Mermaid: `paletteToThemeVariables` → `themeVariables`.
3. **Application (per-engine)** — Mermaid: inject `{theme:'base', themeVariables}` into
   `mermaid.initialize`.

ECharts **reuses layer 1 + the palette data only**. It needs its **own** layers 2 + 3, because
ECharts consumes a theme **object** (`{color:[…], backgroundColor, textStyle, axisLine/axisLabel/
splitLine, legend, tooltip…}`) via `registerTheme` + `init(el, name)` — NOT `themeVariables`.

## Approach
1. **Generalize the mapping** — rename `ThemeDef.mermaid` → `palette` (one "diagram palette" per
   content theme, shared by mermaid + echarts); `autoMermaidTheme` → `pairedPalette(contentTheme)`.
   Keep Mermaid working (update its caller). github→github, material-dark→one-dark,
   vscode-light→zinc-light, vscode-dark→zinc-dark stay as-is.
2. **Translation** — `paletteToEchartsTheme(palette)` (new, e.g. `src/echarts-theme.ts` or extend
   `mermaid-palettes.ts`): map `{bg,fg,line,accent,muted}` → an ECharts theme object — `color`
   (series palette, derive a few hues from `accent`/`fg`), `backgroundColor: bg`, `textStyle.color: fg`,
   axis `lineStyle`/`axisLabel`/`splitLine` from `line`, `legend`/`tooltip` text from `fg`. Reuse
   the hex helpers from `mermaid-palettes.ts`.
3. **Application** — in the webview: `echarts.registerTheme('vmarkd', paletteToEchartsTheme(p))`
   then `echarts.init(el, 'vmarkd')`. Vditor hardcodes the theme arg, so **patch `chartRender.ts`**
   via esbuild (`fixEchartsTheme`, mirror the other vditor patches) to read our resolved
   theme/name. Precedence like Mermaid: explicit setting > content-theme pairing > built-in
   dark/light fallback. (Consider a `vmarkd.theme.echarts` setting only if users want to override;
   otherwise auto-pair silently.)
4. **Live re-render** — ECharts charts must re-theme on a theme flip. Mirror `reRenderMermaid`'s
   offscreen-swap approach (`media-src/src/mermaid-retheme.ts`) for ECharts, and wire it into
   `main.ts` `handleSetTheme` + `handleConfigChanged` (on both `contentThemeChanged` and any
   echarts-setting change). ECharts has `chart.setTheme()` / dispose+re-init — pick the one that
   doesn't lose `option`/scroll.

## Alternative considered
Pair to a **stock ECharts gallery theme** (`apache/echarts/theme/*.js`, ~36 of them: `dark`,
`vintage`, `macarons`, `tech-blue`…) instead of deriving from the palette. Cheaper, but the
palettes won't match github/vscode — only an approximation. Prefer the derived-palette route for
consistency with Mermaid; keep gallery themes as a possible explicit-choice extra.

## Tests (per AGENTS)
- **Unit** — `paletteToEchartsTheme` mapping (hex passthrough for `backgroundColor`/`textStyle`/
  axis from `bg`/`fg`/`line`; valid hex; series `color` non-empty); `pairedPalette` still returns
  the right ids after the registry rename (mermaid tests stay green).
- **e2e** — an `\`\`\`echarts` chart renders with the paired palette (assert `backgroundColor`/an
  axis color in the rendered DOM/canvas-style); switching the content theme re-renders the chart
  (the live-re-theme gap); explicit override (if added) wins.

## See also
- Skill `vmarkd-renderer-theming` (the three layers; what's shared vs per-engine; gotchas).
- Task 86 (Mermaid pairing — the precedent; the registry-rename touches its `autoMermaidTheme`),
  task 59 (`reRenderMermaid` offscreen-swap to mirror), task 89 (bump — do first).
- `media-src/node_modules/vditor/src/ts/markdown/chartRender.ts`,
  `src/theme-registry.ts`, `src/mermaid-palettes.ts`.
