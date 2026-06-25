# Task 133 — D2 column-level / foreign-key connections in `sql_table` (ER edges)

> **Status:** 🟢 DONE — 2026-06-25, shipped in the Phase B WASM batch (with 127/128/126A). Resolved the
> decision gate: d2 ALREADY computes `Edge.SrcTableColumnIndex`/`DstTableColumnIndex` at compile time
> (no `table.col` string parsing needed) — WASM just marshals the two ints; the edge endpoints stay the
> TABLE nodes (so ELK/dagre route them fine). `toSVG` adds `columnFKRoute`: a clean orthogonal row→row
> connector (C when tables are stacked / Z when side-by-side) attaching each end to
> `header + colIndex·ROW_H + ROW_H/2` on the side facing the other table. Pairs with 128 for full ER.

## Problem
D2 connects specific table columns for foreign keys:
```d2
users: { shape: sql_table; id: int {constraint: primary_key} }
orders: { shape: sql_table; user_id: int {constraint: foreign_key} }
orders.user_id -> users.id
```
Real d2 draws the FK line **between the two column rows**. We **drop the edge entirely**: in `toSVG`
/ the layout build (`d2-render.ts` ~line 539) `if (!g.hasNode(e.src) || !g.hasNode(e.dst)) continue` —
the endpoints `orders.user_id` / `users.id` are **columns, not nodes** (columns live in `s.columns`,
not as graph nodes), so the connection is silently skipped. ER FK lines vanish.

## Root cause
Columns aren't graph nodes, and the edge endpoint id (`table.column`) doesn't match any node, so the
"skip edge with unknown endpoint" guard eats it.

## Approach
- **Resolve column endpoints to the table node + a row index.** When `e.src`/`e.dst` is `<table>.<col>`
  and `<table>` is a `sql_table` (or `class`) node, attach the edge to that node and remember the column
  index (the row). This can be done in TS by parsing the endpoint against the table's `columns` — may
  need a WASM tweak to keep the full endpoint path (verify what `outEdge.src` contains for a column
  edge: `orders.user_id` vs just `orders`).
- **Layout:** feed ELK/dagre the table node as the endpoint (so routing works), then in `toSVG` **offset
  the connection's end to the column's row y** (header + colIndex·ROW_H + ROW_H/2), like a port. Attach
  on the table's left/right side nearest the other end.
- **Pairs with task 128:** ER FK lines usually carry crow's-foot arrowheads — do these together for a
  real ER experience.

## Decision gates
- TS-only resolution (parse `table.col`) vs a WASM change (emit a structured endpoint). Check the
  compiled edge endpoint format first.
- Routing to a row-port may stress the refine pipeline (endpoints mid-edge of a tall table) — verify no
  new crossings/overlaps on an ER sample.

## Acceptance / tests
- [x] Unit: `orders.user_id -> users.id` produces a drawn connection whose endpoints sit at the correct
  column-row Y (header + index·ROW_H + ROW_H/2), NOT the table-box centre — `d2-render.test.ts` (hand-
  built Layout, exact-coordinate assertion). WASM emits `srcColumnIndex=1`/`dstColumnIndex=0` —
  `d2-wasm.test.ts`; ELK threads them — `elk-layout.test.ts`.
- [x] Visual: a 4-table ER block + crow's-foot (with 128) verified by eye via the render harness.
- [~] e2e (real-VS-Code): not re-run here (no xvfb); node-side real-ELK/WASM tests cover it. Non-column
  edges unaffected (the route override is guarded on `srcColumnIndex/dstColumnIndex` being set).
- [x] `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 128 (crow's-foot — do together), 121/124 (WASM bump if needed). The edge-skip guard +
`drawSqlTable` row geometry in `d2-render.ts`; `outEdge` in `main.go`.
