# Task 90 — ECharts theme pairing (registerTheme + palette from content theme)

> **Status:** 📋 TODO (do after [task 89](89-echarts-version-bump.md) bump). Make `\`\`\`echarts`
> charts follow the chosen content theme — the same way Mermaid does (task 86), reusing the
> shared palette mapping but with an ECharts-specific translation + application. Also closes
> the live-re-theme gap (ECharts only re-themes on reopen today).
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
