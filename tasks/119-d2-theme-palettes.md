# Task 119 — D2 theme palettes (auto-colour shapes like real D2)

> **Status:** 💡 idea / planned (decision-gated, spike-friendly) — proposed 2026-06-21. Recommended
> phasing: **Phase A** = content-theme-paired auto-palette (cheap, theme-aware) first; **Phase B**
> = optional `vmarkd.diagram.d2Theme` picker with a few ported D2 named themes. Builds on task 104
> (our D2 renderer) and the task 86/90/94 pairing pattern.

## Problem
Our D2 uses **compile-only WASM + our OWN `toSVG()`** (task 104) — we do not use D2's official
renderer. So a plain D2 diagram is **monochrome line-art**: `paintAttrs()` (`d2-render.ts:74`)
defaults `stroke = currentColor`, `fill = transparent` (containers get a 4% tint), text =
`currentColor`. Explicit source styles (`style: {fill: …; stroke: …}`) ARE honoured, but with no
style every shape is colourless.

The official D2 tool ships **~20 built-in themes** (Neutral default, Cool classics, Mixed berry
blue, Terminal, Dark mauve, …) that **automatically** assign pastel fills/strokes/font colours to
*every* shape — that is the "ładne kolorowe kształty" look. We give logic + layout + theme-following
mono, but no automatic colour.

## The lever (easier here than mermaid/graphviz — it's OUR renderer)
We control `toSVG()` / `paintAttrs()` end-to-end, so we inject a palette as the **default** fill/
stroke/font **only where a shape sets none** — no esbuild patch, no WASM change, no touching the D2
source. `paintAttrs` already does `fill = s.fill || defaultFill` — Phase A is essentially "make
`defaultFill` (and the default stroke/font) come from a palette instead of `transparent`/
`currentColor`." Explicit user styles keep overriding (same fallback-only semantics as task 94's
DOT defaults).

## Approach (mirror the skill's 3 layers — see `vmarkd-renderer-theming`)
1. **Mapping (SHARED)** — Phase A: `pairedPalette(contentTheme)` + `MERMAID_PALETTES`
   (`{bg,fg,line,accent,muted}`) → theme-aware, follows light/dark for free. Phase B: a `D2_THEMES`
   table (a few ported D2 palettes) selected by a new setting; `auto` falls back to Phase A.
2. **Translation (new, per-engine)** — `paletteToD2Style(palette)` → default `{fill, stroke,
   fontColor}` plus a small **series** for variety (e.g. echarts-style golden-angle from `accent`,
   or `mix(bg, accent, …)` pastels). Assign deterministically by shape so re-renders are stable:
   containers → muted surface tint, leaf shapes → cycle the series **keyed by shape id/index**
   (NOT random — a live re-theme/scroll must not recolour). Reuse `mermaid-palettes.ts` hex helpers
   (`parseHex`/`mix`/`toHex`).
3. **Application** — thread the palette into `toSVG()` (it's a pure function → add a param) and use
   it in `paintAttrs()`/`textAttrs()` + the bespoke drawers (`drawSqlTable`/`drawClass`/`drawGrid`/
   container/cylinder/queue/person/…). Webview reads the active palette from a `window` global set in
   `main.ts` (mirror `__vmarkdD2Layout`), passed down by `renderD2`. **Live re-theme:** `reRenderD2`
   already exists and is wired for `d2LayoutChanged` — extend the wiring to `contentThemeChanged`
   (Phase A) and the new `d2Theme` change (Phase B), re-rendering from `data-code` like graphviz/
   mermaid (task 59 offscreen-swap pattern).

## Phase B — optional config picker (mirror `vmarkd.theme.echarts`)
New `vmarkd.diagram.d2Theme` enum: `auto` (content-paired, **default**) + a curated subset of D2
themes (`neutral-default`, `cool-classics`, `mixed-berry-blue`, `terminal`, `dark-mauve`, …) +
`none` (keep today's monochrome). Plumb through `collectConfigOptions()` (`src/extension.ts:~1496`,
beside `d2Layout`) → message → `main.ts` global. Mark each named theme's intended mode (light/dark)
or back-fill so it reads on either editor theme.

## Gotchas
- **Fallback-only.** Palette fills the gap; an explicitly-styled shape keeps its colour
  (`s.fill || paletteFill`). Never clobber source styles (task 94 semantics).
- **Text contrast.** `textAttrs` already derives label colour via `labelColor(s.fill)` — verify it
  contrasts against the injected pastel fills (light text on dark fill and vice-versa); extend
  `labelColor` if a pastel trips it.
- **Theme-aware, no baked bg.** Keep the canvas **transparent** (sits on the themed surface) unlike
  real D2 which bakes a theme background. Phase-A pastels derive from the content palette so they
  read on light AND dark; fixed Phase-B palettes need a mode tag.
- **`currentColor` stroke vs opaque fill.** If fills become opaque, take the stroke from the palette
  too (a light fill + light `currentColor` stroke on a dark theme would vanish).
- **Determinism.** Cycle the series keyed by stable shape id/order so re-render/scroll/live-flip
  never reshuffles colours.
- **Cover all drawers.** `paintAttrs` covers basic shapes + container; `drawSqlTable`/`drawClass`/
  `drawGrid` are bespoke — thread the palette there too, or scope v1 to basic shapes + containers
  and note SQL/class/grid as a follow-up (don't silently leave them mono).

## Tests (per AGENTS — unit + e2e + verify coverage)
- **Unit** (`d2-render.test.ts`) — `paletteToD2Style` returns palette colours; an unstyled shape's
  `toSVG` output gets a palette `fill` (not `transparent`); an explicitly-styled shape is untouched;
  colour assignment is deterministic for the same shape id; `labelColor` contrasts on the pastels.
- **e2e** (`custom-diagrams.spec.ts`) — a ` ```d2 ` block renders with non-`currentColor` fills when
  a theme is active; an explicitly-styled node keeps its colour; `none` stays monochrome; switching
  the content theme (auto) re-renders. (D2 render assertions are `fixme` in the harness — the live
  proof belongs in the real-VS-Code suite `test/vscode-e2e/`, like task 104 / d2-elk.)

## See also
- Skill `vmarkd-renderer-theming` (3 layers; shared mapping vs per-engine translation; model #3).
- **Task 104** (our D2 renderer — `toSVG`/`paintAttrs`/`textAttrs`/`labelColor`/the bespoke drawers).
- Tasks **86/90/91/93/94** (pairing precedents; reuse `pairedPalette` + `MERMAID_PALETTES`),
  **59** (`reRenderMermaid` offscreen-swap to mirror), `vmarkd.theme.echarts` (Phase-B config UX).
- Files: `media-src/src/d2-render.ts`, `media-src/src/custom-diagrams.ts` (`renderD2`/`themeSvg`),
  `media-src/src/main.ts` (window global + theme handlers), `src/extension.ts`
  (`collectConfigOptions`), `package.json` (enum), `src/theme-registry.ts` (`pairedPalette`),
  `src/mermaid-palettes.ts` (palette data + hex helpers).
