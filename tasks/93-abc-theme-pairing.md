# Task 93 — abc (abcjs) theme pairing (renderAbc foregroundColor)

> **Status:** 📋 TODO (after [task 92](92-abcjs-version-bump.md) — needs abcjs 6 for
> `foregroundColor`). Make `\`\`\`abc` sheet music follow the content theme — it renders black
> on transparent today (unreadable on dark) because Vditor calls `renderAbc(el, text)` with no
> params. Also closes the live-re-theme gap.
> **Source:** renderer-theming audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟢 readability/cohesion / low — additive; simplest of the diagram
> theming tasks (abc has effectively one ink color).

## Problem
abcjs renders the score in **black on transparent**. `abcRender.ts` does
`ABCJS.renderAbc(item, code)` — no params → default black, ignores the theme, unreadable on a
dark content theme. Like every non-mermaid renderer it also **paints once** (no live re-theme;
only Mermaid does, task 59).

## The lever (needs task 92)
abcjs renders with one ink color via `renderAbc(target, source, { foregroundColor })`. The
background is transparent (inherits the themed surface), so abc theming is essentially **just
`foregroundColor` = the palette's `fg`** — much simpler than mermaid/echarts (no multi-hue
palette). **Requires abcjs 6** (5.10.3 has no `foregroundColor`) → do task 92 first.

## Approach (mirror task 86; see the skill — 3 layers)
1. **Mapping (SHARED)** — reuse `pairedPalette(contentTheme)` + `MERMAID_PALETTES` data (the
   registry `palette` field; coordinate the `mermaid`→`palette` rename with task 90).
2. **Translation (per-engine, tiny)** — `paletteToAbcParams(palette)` → `{ foregroundColor: fg }`
   (+ `selectionColor` if wanted). That's it — abc has one ink color.
3. **Application** — patch `abcRender.ts` via esbuild (`fixAbcRenderParams`, mirror the other
   vditor patches) so `renderAbc(item, code, params)` gets the resolved params.
4. **Live re-render** — mirror `reRenderMermaid`'s offscreen-swap for abc, wired into `main.ts`
   `handleSetTheme` + `handleConfigChanged` (on `contentThemeChanged`). renderAbc is cheap.

## Tests (per AGENTS)
- **Unit** — `paletteToAbcParams` returns `foregroundColor` = the palette `fg` (valid hex).
- **e2e** — a `\`\`\`abc` block renders with `fg` ink (assert an svg `fill`/`stroke` = `fg`, not
  black); switching the content theme re-renders it.

## See also
- Skill `vmarkd-renderer-theming` (three layers; shared mapping vs per-engine translation).
- Task 92 (abcjs bump — prerequisite), task 86/90/91 (the pairing precedents; reuse their
  shared mapping + `MERMAID_PALETTES`), task 59 (`reRenderMermaid` to mirror).
- `media-src/node_modules/vditor/src/ts/markdown/abcRender.ts`.
