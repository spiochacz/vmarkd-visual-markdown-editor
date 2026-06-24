# Task 133 — D2 column-level / foreign-key connections in `sql_table` (ER edges)

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. Untasked D2 gap found
> re-auditing the code. **High value for ER diagrams**; pairs with task 128 (crow's-foot arrowheads).
> Builds on task 104. Likely needs a WASM/edge change → coordinate with the 121/124 Phase B bump.

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
- Unit: `orders.user_id -> users.id` produces a drawn connection (not dropped) whose endpoints sit at
  the correct column rows of each table.
- e2e: an ER D2 block (2–3 sql_tables + FK edges) renders the FK lines to the right rows; non-column
  edges unaffected (byte-stable on the 8 samples).
- Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 128 (crow's-foot — do together), 121/124 (WASM bump if needed). The edge-skip guard +
`drawSqlTable` row geometry in `d2-render.ts`; `outEdge` in `main.go`.
