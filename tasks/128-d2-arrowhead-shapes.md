# Task 128 — D2 arrowhead shapes (ER crow's-foot, diamond, circle, …) + arrowhead labels

> **Status:** 🟢 DONE — 2026-06-25, shipped in the Phase B WASM batch (with 127/133/126A). WASM extends
> `outEdge` with `srcArrowhead`/`dstArrowhead` = `{shape,label}` via `e.SrcArrowhead.ToArrowhead()`
> (resolves the `filled-*` variants from `style.filled`). `toSVG` replaces the single triangle with an
> `arrowhead()` dispatcher (triangle/arrow/(filled-)diamond/(filled-)circle/box/cross + the four
> crow's-foot glyphs + none) + per-shape `arrowheadDepth` retraction + `arrowheadLabel` (cardinality).
> Did the WHOLE set in one bump (decision gate). Pairs with 133 for full ER. Built on 104 + 122.

## Problem
D2 connections can set `source-arrowhead` / `target-arrowhead` with a **shape** and a **label**:
```d2
a -> b: {
  source-arrowhead: 1 { shape: cf-one }
  target-arrowhead: * { shape: cf-many }
}
table.col -> other.col: { target-arrowhead.shape: cf-many-required }
parent -> child: { target-arrowhead.shape: diamond }   // aggregation/composition
```
Supported d2 arrowhead shapes: `triangle` (default), `arrow`, `diamond`, `filled-diamond`, `circle`,
`filled-circle`, `box`, `cf-one`, `cf-one-required`, `cf-many`, `cf-many-required` (crow's-foot ER
notation), `none`. We render **only a filled triangle** for `dstArrow`, and a triangle for `srcArrow` —
every diagram's arrowheads look identical, and ER/UML notation is impossible.

## Root cause
`outEdge` (`main.go`) marshals only `srcArrow`/`dstArrow` booleans — not the arrowhead shape or its
label. The webview can't draw what it doesn't receive. `arrow()` in `d2-render.ts` emits a single
hard-coded triangle path.

## Approach
- **WASM:** extend `outEdge` with `srcArrowhead`/`dstArrowhead` = `{ shape, label }` (read
  `e.SrcArrowhead`/`e.DstArrowhead`). Update `d2-wasm.ts` types + `PlacedEdge`.
- **toSVG:** replace the single `arrow()` with an arrowhead-shape dispatcher — a small generator per
  shape (triangle, open arrow, (filled-)diamond, (filled-)circle, box, and the four crow's-foot glyphs
  drawn as short strokes at the endpoint). Honour the retract/`getArrowheadAdjustments` logic per
  shape (crow's-foot needs different endpoint spacing than a triangle).
- **Arrowhead labels** (`1`, `*`, role names): small text near the arrowhead endpoint, offset to the
  side of the line; feed into the label-deconfliction pass (task 122) so they don't collide.

## Decision gates
- Scope: ship the common set first (triangle/arrow/diamond/circle/none) then the crow's-foot family
  (the fiddliest geometry) — or do all at once since it's one WASM bump.
- Arrowhead labels add to the label-placement load; verify they don't regress edge-label routing.

## Acceptance / tests
- [x] Unit: each arrowhead `shape` emits its distinct glyph (`<circle>` for circle, ≥3 `<line>` for
  cf-many, etc.); `none` emits no glyph; default falls back to the filled triangle — `d2-render.test.ts`.
  Arrowhead cardinality label rendered. WASM marshalling (incl. `filled-diamond` from `style.filled`)
  pinned in `d2-wasm.test.ts`; ELK threading in `elk-layout.test.ts`.
- [x] Visual: all 12 shapes + an ER (crow's-foot, 1/* labels) + UML (hollow/filled diamond) verified
  by eye via the render harness (`media-src/scripts/d2-render-harness/`, shown to the user).
- [~] e2e (real-VS-Code): not re-run here (no xvfb); the node-side real-ELK + real-WASM tests cover the
  pipeline. Plain triangles byte-stable (default edges carry no arrowhead object → triangle fallback).
- [x] `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 122 (connection + label drawing), 121/124 (shared WASM bump). `arrow()` +
`getArrowheadAdjustments` in `d2-render.ts`; `outEdge` in `main.go`. Pairs naturally with sql_table ER
diagrams.
