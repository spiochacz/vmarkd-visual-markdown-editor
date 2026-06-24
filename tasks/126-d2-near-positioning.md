# Task 126 — D2 `near` positioning (viewport-pinned titles/legends + near-shape annotations)

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. Splits the "near positioning"
> item out of task 124 (was out-of-scope/keep-fallback). Builds on task 104 (D2 renderer) + the
> layout pipeline (task 122). Recommended phasing: ship the cheap **viewport-constant** form first
> (no WASM, high value), defer the **near-shape** form.

## Problem
D2's `near` keyword positions a shape OUTSIDE the normal layout flow — pinned either to a viewport
corner/edge or adjacent to another shape. It's the idiom for **titles, legends, captions, watermarks,
and annotations**. We currently can't honour it, so any diagram using `near` hits the loud fallback
(`unsupportedReason` → `shape.special.nearKey` → raw source + note). The user sees source, not a diagram.

## The two forms

### A. Viewport constants (the common case — titles/legends)
```d2
title: System Architecture {near: top-center}
legend: |md 🟦 service / 🟥 db | {near: bottom-right}
a -> b -> c
```
Valid keys: `top-left top-center top-right center-left center-right bottom-left bottom-center
bottom-right`. The shape is REMOVED from layout and pinned to that region of the whole drawing,
regardless of how dagre/ELK arranges the rest.

### B. Near another shape (relative annotation)
```d2
server: Server
note: "HTTPS only" {near: server}
```
`near: <shape-id>` = "place me beside that node" — a layout constraint, not a fixed viewport spot.

## Root cause / what we already have
`main.go` already marshals `Near` → `shape.special.nearKey` (a string: a constant like `top-center`
OR a target shape id). So the DATA is present; we just (a) treat its presence as unsupported and
(b) have no placement pass. No WASM change is needed for form A.

## Approach

### Phase A — viewport constants (no WASM)
- In `toSVG` (`d2-render.ts`): EXCLUDE shapes whose `nearKey` is one of the 8 constants from the dagre/
  ELK layout input (they shouldn't push the graph around), then, AFTER the final `viewBox` is computed
  (the tight-bbox pass), place each `near` shape in its corner/edge with a uniform margin and grow the
  `viewBox` to include it. Render the shape with the normal shape switch (it can be any shape, often
  `shape: text` or an `|md|` block — coordinate with task 124 for text/md rendering).
- Stop `unsupportedReason` firing for the constant form (only fall back for the unsupported near-shape
  form until Phase B lands).
- Multiple shapes sharing a corner: stack them (vertical) with a small gap.

### Phase B — near-shape (relative) — deferred
- A post-layout placement pass: position the `near` shape adjacent to its target (`nearKey` = target id)
  without overlapping existing geometry (search the 4 sides for a clear slot, like a tiny label-placement
  problem). More work; only do it if there's demand.

## Decision gates
- Form A interacts with task 124 (`shape: text` / `|md|` legends are the usual content of a `near`
  title/legend). A bare-rect render of a legend looks wrong — pair Phase A with at least basic
  text/md rendering, or scope Phase A to shapes we can already draw.
- Faithful-by-construction: keep the raw-source fallback for the near-shape form (and any `near` we
  can't place yet) rather than dropping the shape silently.

## Acceptance / tests
- Unit: a graph with `{near: top-center}` → that shape excluded from layout bounds and placed in the
  top-centre of the final `viewBox`; `unsupportedReason` no longer flags the constant form.
- e2e (real-VS-Code): a titled/legended D2 block renders the diagram WITH the pinned title/legend in
  the right corner; a `near: <shape>` block still falls back to raw source (until Phase B).
- Keep `d2-quality.test.ts` / typecheck / lint green; verify byte-stable output on the 8 sample diagrams
  (none use `near`, so they must be unaffected).

## Related
- Task 124 (other feature-parity gaps; this was the "near" item). Task 104 (renderer), 122 (layout +
  the final-bbox/viewBox pass `near` Phase A hooks into). `unsupportedReason` + `nearKey` in
  `media-src/src/d2-render.ts`; `Near` extraction in `media-src/vendor/d2/build/main.go`.
