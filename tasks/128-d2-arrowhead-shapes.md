# Task 128 — D2 arrowhead shapes (ER crow's-foot, diamond, circle, …) + arrowhead labels

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. Untasked D2 gap found auditing
> `main.go`. Needs a Go+WASM field extraction → batch with task 121/124 Phase B. Builds on task 104
> (renderer) + 122 (connection drawing). **High value for ER + UML diagrams.**

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
- Unit: each arrowhead `shape` emits its distinct path; `none` emits no glyph; an ER edge with
  `cf-many`/`cf-one` renders crow's-foot glyphs at the right ends.
- e2e: an ER-style D2 block (sql_tables + crow's-foot connections) renders the notation; existing
  diagrams' plain triangles are byte-stable.
- Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 122 (connection + label drawing), 121/124 (shared WASM bump). `arrow()` +
`getArrowheadAdjustments` in `d2-render.ts`; `outEdge` in `main.go`. Pairs naturally with sql_table ER
diagrams.
