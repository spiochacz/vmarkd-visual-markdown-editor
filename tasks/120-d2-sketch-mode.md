# Task 120 — D2 sketch mode (hand-drawn look via rough.js)

> **Status:** 💡 idea / planned (decision-gated, spike-friendly) — proposed 2026-06-21. Orthogonal to
> task 119 (palettes) — different mechanism, own tests — but designed to **compose** with it. Builds
> on task 104 (our D2 renderer). Recommended: spike the rough.js path-generation integration first
> (one shape + one edge), then roll out to all primitives + bespoke paths.

## Problem
The official D2 tool has a `--sketch` mode: every shape and edge is drawn with **rough.js** for a
hand-drawn look (wobbly strokes, hachure fills) — a popular, distinctive style. Our D2 (task 104)
renders crisp geometric SVG from our own `toSVG()` and has no sketch option.

## The lever (cleaner here than other renderers — it's OUR `toSVG`)
We emit the SVG ourselves, so sketch is a **drop-in replacement of the primitive emit** — no esbuild
patch, no WASM change. `toSVG()` (`d2-render.ts`) produces:
- plain primitives: `<rect>` (container/leaf), `<ellipse>` (circle/oval), `<polygon>` (diamond/
  hexagon), and
- `<path d="…">` for the bespoke shapes (cylinder/queue/person/cloud) + every edge.

rough.js has a **DOM-less generator** (`rough.generator()`): `rectangle/ellipse/polygon/line/
linearPath` AND crucially **`path(d)`** — it sketchifies an *arbitrary* path string. `toPaths(drawable)`
returns ready `{d, stroke, fill, strokeWidth}` sets we serialize straight into `<path>`. So:
- each primitive → its rough method;
- each bespoke `<path>`/edge → **`generator.path(ourD)`**.

→ **One integration covers every shape** (incl. cylinder/person/cloud) and edges. No geometry rework.

## Approach
1. **Bundle rough.js** — small (~9 KB gz); lazy-load like ELK (`elk-main.js` pattern) or bundle it.
   Vendor under `media-src/vendor/roughjs/` with a `source.json` sha guard (house convention).
2. **Sketch emit path in `toSVG()`** — when sketch is on, route each shape through
   `rough.generator()` and emit the returned path sets instead of the crisp primitive. Keep `toSVG`
   the single SVG builder; gate the per-shape emit on a `sketch` flag threaded in as a param (pure).
   `generator.path(d)` reuses our existing bespoke/edge path strings verbatim.
3. **Config + plumbing** — new `vmarkd.diagram.d2Sketch` (boolean, default `false`), mirror
   `d2Layout`: `collectConfigOptions()` (`src/extension.ts:~1496`) → message → `main.ts` window
   global (`__vmarkdD2Sketch`) → read by `renderD2` (`custom-diagrams.ts`), passed into `toSVG`.
4. **Live re-render** — extend `reRenderD2` wiring (already exists for `d2LayoutChanged`) to a
   `d2SketchChanged` flag so toggling the setting re-renders from `data-code` (task 59 pattern).

## Gotchas (the expensive ones)
- **Determinism — fixed seed per shape.** rough.js randomises the wobble each call. Pass a stable
  `seed` keyed by shape id/index, else every re-render / scroll / theme-flip reshuffles the look.
  (Same determinism concern as task 119's colour cycling — solve them the same way.)
- **`currentColor` + hachure.** A path `stroke="currentColor"` follows the theme fine, but hachure
  **fills are separate stroke lines** — set their stroke to `currentColor` (or the task-119 palette
  colour) explicitly so they theme too. Verify rough's output lets us set this.
- **Fill style.** Decide default `fillStyle` (`hachure` is the D2 look; `solid` if paired with a
  palette). Tune `roughness`/`bowing`/`fillWeight` to match D2 without going noisy.
- **Composition with task 119.** sketch + palette must combine: rough fill colour = the palette
  fill, stroke = palette/`currentColor`. Design the shape-style resolution once so both features read
  the same `{fill, stroke, fontColor}` and sketch only changes the *drawing*, not the *colour*.
- **Text stays crisp.** Sketch affects shapes/edges only. A handwriting font is a separate optional
  nicety (don't bundle one in v1).
- **Cover all drawers.** `paintAttrs`-based shapes + the bespoke `drawSqlTable`/`drawClass`/`drawGrid`
  must all route through the sketch emit, or scope v1 to basic shapes + containers + edges and note
  SQL/class/grid as a follow-up (don't silently leave some crisp).
- **Perf.** rough generates many sub-paths per shape; for big diagrams cap or measure. Keep the
  crisp path the default so only opted-in diagrams pay the cost.

## Tests (per AGENTS — unit + e2e + verify coverage)
- **Unit** (`d2-render.test.ts`) — with `sketch:true`, `toSVG` emits rough-style multi-segment
  `<path>`s (not a single `<rect>`/`<ellipse>`); a fixed seed yields byte-identical output across two
  calls (determinism); stroke threads `currentColor`/palette; `sketch:false` keeps the crisp emit.
- **e2e / real-VS-Code** — a ` ```d2 ` block with the setting on renders sketchy paths; toggling the
  setting re-renders. (D2 render assertions are `fixme` in the Playwright harness; live proof goes in
  `test/vscode-e2e/`, like task 104 / d2-elk.)

## See also
- Skill `vmarkd-renderer-theming` (renderer models; we own this one end-to-end).
- **Task 104** (our D2 renderer — `toSVG` + the primitive/bespoke-path emit this hooks).
- **Task 119** (D2 palettes — compose: palette = colour, sketch = drawing; share the style resolver).
- **Task 59** (`reRenderMermaid` offscreen-swap to mirror for the live toggle).
- D2 docs: `--sketch`. rough.js: `rough.generator()` / `path(d)` / `toPaths()`.
- Files: `media-src/src/d2-render.ts`, `media-src/src/custom-diagrams.ts` (`renderD2`),
  `media-src/src/main.ts` (window global + handlers), `src/extension.ts` (`collectConfigOptions`),
  `package.json` (setting), `media-src/vendor/roughjs/` (new vendored asset).
