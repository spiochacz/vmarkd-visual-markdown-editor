# Task 94 — Graphviz theme pairing (DOT default attributes)

> **Status:** 📋 TODO. Make `\`\`\`graphviz` (DOT) diagrams follow the content theme — they
> render black-on-transparent today (unreadable on dark) because Vditor passes the DOT to
> Viz.js untouched. Inject palette-derived **default** graph/node/edge attributes into the DOT.
> Also closes the live-re-theme gap. **No Viz.js version change needed** (engine-agnostic).
> **Source:** renderer-theming audit (the `vmarkd-renderer-theming` skill); user request.
> **Value / Risk:** 🟢 readability/cohesion / low — additive; pure DOT-source manipulation.

## Problem
Graphviz renders DOT → SVG via Viz.js. Colors come from DOT **attributes**; with none set the
defaults are black text/edges on no background — unreadable on a dark content theme, and never
matching the palette. `graphvizRender.ts` renders the DOT verbatim. Like every non-mermaid
renderer it also **paints once** (no live re-theme; only Mermaid does, task 59).

## The lever (works with the CURRENT Viz.js — no bump)
DOT supports **default attribute statements** at graph scope:
```dot
graph [bgcolor="transparent"]            // or the surface color
node  [color="<line>", fontcolor="<fg>"] // applied to nodes that don't set their own
edge  [color="<line>", fontcolor="<fg>"]
```
User-specified attributes still **override** these defaults, so we only set the *fallback*
palette — we don't clobber a diagram that picks its own colors. This is engine-agnostic: it
works on the current mdaines `viz.js` AND on `@viz-js/viz` if graphviz is later modernized
(see task 87's shared-Viz.js note).

## Approach (mirror task 86; see the skill — 3 layers)
1. **Mapping (SHARED)** — reuse `pairedPalette(contentTheme)` + `MERMAID_PALETTES` data (the
   registry `palette` field; coordinate the `mermaid`→`palette` rename with task 90).
2. **Translation (per-engine, new)** — `paletteToGraphvizAttrs(palette)` → the three default-attr
   lines from `{bg,fg,line}` (`node`/`edge` `color`=`line`, `fontcolor`=`fg`; `graph bgcolor`
   transparent or a surface). Reuse `mermaid-palettes.ts` hex helpers.
3. **Application** — patch `graphvizRender.ts` via esbuild (`fixGraphvizTheme`, mirror the other
   patches) to **inject the default-attr statements** right after the graph opener
   (`(strict )?(di)?graph <id>? {`). Guard the anchor so a Vditor drift fails the build.
4. **Live re-render** — mirror `reRenderMermaid`'s offscreen-swap for graphviz, wired into
   `main.ts` `handleSetTheme` + `handleConfigChanged` (on `contentThemeChanged`).

## Gotchas
- Inject as **defaults** (scope statements), not by rewriting existing attrs — preserve explicit
  user colors. (DOT semantics: a default applies only where the element doesn't set its own.)
- Handle `digraph`/`graph`/`strict`, optional graph id, and the opening `{` — anchor on the brace.
- `bgcolor`: prefer `transparent` so the diagram sits on the themed surface (matches how math/
  flowchart behave), unless a solid bg reads better — decide during impl.

## Tests (per AGENTS)
- **Unit** — `paletteToGraphvizAttrs` produces valid attr lines with `fg`/`line` hex; the
  injector inserts them after the graph opener and leaves a user-colored node's attr intact.
- **e2e** — a `\`\`\`graphviz` block renders with the palette colors (assert an svg
  `stroke`/`fill` = `line`/`fg`, not black); switching the content theme re-renders it.

## See also
- Skill `vmarkd-renderer-theming` (three layers; shared mapping vs per-engine translation).
- Task 86/90/91/93 (pairing precedents; reuse their shared mapping + `MERMAID_PALETTES`),
  task 59 (`reRenderMermaid` to mirror).
- **Task 87 (PlantUML/TeaVM)** — vendors `@viz-js/viz/viz-global.js`; if graphviz is modernized
  onto that same Viz.js, THIS task's DOT-attr injection is unchanged (it's engine-agnostic).
- `media-src/node_modules/vditor/src/ts/markdown/graphvizRender.ts`.
