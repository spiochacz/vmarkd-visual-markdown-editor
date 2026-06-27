# Task 159 — D2 WASM export batch (one TinyGo bump for every missing style/attr field)

> **Status:** 💡 idea / planned (the shared blocker) — created 2026-06-27 from a full audit of
> `media-src/vendor/d2/build/main.go` against the d2 `d2graph.Style` + `Attributes` structs
> (commit `2446e24` = d2 0.1.33). **This is the coordination task every D2 cosmetic task already
> points at** ("batch with task 121/124 Phase B", "bump the WASM ONCE and capture every missing
> field"). Nothing currently OWNS that bump — this does. It only EXPORTS the fields + syncs the
> contract; the per-feature RENDERING lives in the consumer tasks below. Builds on task 104.

## Problem
Our D2 pipeline is **compile-only WASM → our own `toSVG`** (task 104/123). The TinyGo WASM
(`main.go`) marshals a `D2Graph` JSON; anything it doesn't put in that JSON is invisible to the
renderer and **silently dropped**. A full audit shows `main.go` exports only ~9 of d2's 20 `Style`
fields and a fraction of the object `Attributes`. Every dropped field needs the SAME Go change +
WASM rebuild, so doing them one-at-a-time means re-pulling the Go/TinyGo toolchain repeatedly. **Batch
the bump once.**

## Root cause
`main.go`'s `outShape`/`outEdge` structs (and the mirrored `D2Shape`/`D2Edge` in
`media-src/src/d2-wasm.ts`) omit the fields below. `d2compiler.Compile` HAS them on
`o.Style.*` / `o.*` / `e.Style.*` — we just never read them.

## Fields to export (the checklist) — each → its consumer (render) task

### Shape `style.*` (currently exported: fill, stroke, stroke-width, stroke-dash, opacity, font-color, border-radius, bold, italic)
- [ ] `ThreeDee` (`3d`) → **task 121**
- [ ] `Multiple` (`multiple`) → **task 121**
- [ ] `Shadow` (`shadow`) → **task 121**
- [ ] `FillPattern` (`fill-pattern`: dots/lines/grain/paper) → **task 121**
- [ ] `DoubleBorder` (`double-border`) → **task 121**
- [ ] `FontSize` (`font-size`) → **task 129**
- [ ] `Font` (`font`) → **task 129**
- [ ] `Underline` (`underline`) → **task 129**
- [ ] `TextTransform` (`text-transform`) → **task 129**
- [ ] `Animated` (`animated`) **on a shape** (we export it for edges only) → fold into **task 121/135**

### Object attributes (currently exported: label, shape, icon, tooltip, link, direction, nearKey, gridRows, gridColumns, columns/fields/methods)
- [ ] `WidthAttr` / `HeightAttr` (`width`/`height`) → **task 130**
- [ ] `Top` / `Left` (absolute pin) → **task 130** (or a new positioning task; low value)
- [ ] `LabelPosition` (`label.near`) → **task 134**
- [ ] `IconPosition` (`icon.near`) → **task 134**
- [ ] `IconStyle`, `TooltipPosition` → **task 134/135** (minor)
- [ ] `GridGap` / `VerticalGap` / `HorizontalGap` → **task 135**
- [ ] `Language` (for `shape: code` syntax highlighting) → **task 160**
- [ ] `vars.d2-config` (theme/sketch/pad/layout — compile-side, not a per-object attr) → **task 132**

### Edge — connection LABEL text styling (currently exported: stroke, stroke-width, stroke-dash, opacity, animated, arrowheads)
- [ ] `e.Style.FontColor` / `FontSize` / `Bold` / `Italic` / `Underline` (the connection label) → NEW
      gap (no task yet) — small; fold its render into task 129 once exported.

### Already handled — do NOT re-add
- `Filled` is consumed via `e.SrcArrowhead.ToArrowhead()` (filled-* variants, task 128).
- `Classes` / `vars` are resolved into `o.Style.*` at COMPILE time, so their effects on
  already-exported props arrive for free (only effects on *unsupported* props are lost — fix those by
  exporting the prop above, not the class).
- `LabelDimensions` — we measure labels ourselves (`canvasMeasure`), don't need d2's.

## Approach
1. Extend `outShape` / `outEdge` / `outGraph` in `media-src/vendor/d2/build/main.go` with the fields
   above (mirror the existing `styleVal(...)` pattern; booleans via `== "true"`).
2. Mirror them in `D2Shape` / `D2Edge` in `media-src/src/d2-wasm.ts` (the contract is asserted by
   `media-src/src/d2-wasm.test.ts` — extend it).
3. **Rebuild the WASM** per `media-src/vendor/d2/build/build-notes.md` (TinyGo; same `D2_COMMIT`),
   refresh `media-src/vendor/d2/source.json` (sha256), keep `D2_VER` in `d2-wasm.ts` in sync.
4. Land the export with NO renderer changes yet (fields present, unused) — verify `d2-wasm.test.ts`
   sees them + no regression. Then the consumer tasks (121/129/130/132/134/135/160) each consume
   their field(s) in `d2-render.ts` `toSVG`.

## Tests (per AGENTS)
- **unit** — `d2-wasm.test.ts`: compile a source exercising each new field, assert it appears in the
  graph JSON (this task's acceptance — the EXPORT, not the render).
- The render of each field is tested by its consumer task.

## See also
- Consumers: tasks **121** (shape effects), **129** (text styles), **130** (dimensions), **132**
  (source config), **134** (label/icon position), **135** (minor cosmetics), **160** (code highlight),
  **126** (near — relative form Phase B).
- `media-src/vendor/d2/build/main.go`, `media-src/src/d2-wasm.ts`, `media-src/src/d2-wasm.test.ts`,
  `media-src/vendor/d2/build/build-notes.md`, `media-src/vendor/d2/source.json`.
- Skill `vmarkd-renderer-theming` (D2 is theming model #3 — self-contained SVG).
