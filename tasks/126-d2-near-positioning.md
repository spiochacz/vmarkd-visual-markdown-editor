# Task 126 — D2 `near` positioning (viewport-pinned titles/legends + near-shape annotations)

> **Status:** 🟢 Phase A DONE / 🟡 Phase B deferred — 2026-06-25, shipped Phase A in the batch (with
> 127/128/133). Viewport-constant near (the 8 keys) is now placed by `toSVG` (excluded from layout +
> obstacles + the tight bbox, then pinned relative to the final content bounds + the bbox grown);
> `unsupportedReason` only flags the relative `near: <shape-id>` form now. No WASM change (the `NearKey`
> was already marshalled). Phase B (near-another-shape) intentionally deferred — still falls back.
> Built on 104 + 122.

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
- [x] Unit: a graph with `{near: top-center}` renders WITH the pinned shape, placed ABOVE the laid-out
  nodes (smaller y) — `d2-render.test.ts`; `unsupportedReason` returns null for the constant form and
  still flags the relative form — `d2-render.test.ts`. ELK excludes it from layout but returns it flagged
  `near` — `elk-layout.test.ts`.
- [x] Visual: title pinned top-center + legend pinned bottom-right (core graph undisturbed) verified by
  eye via the render harness.
- [~] e2e (real-VS-Code): not re-run here (no xvfb); node-side tests cover the exclusion + placement.
  Relative `near: <shape>` still falls back (Phase B). Sample diagrams unaffected (none use `near`).
- [x] `d2-quality.test.ts` / typecheck / lint green.

## Related
- Task 124 (other feature-parity gaps; this was the "near" item). Task 104 (renderer), 122 (layout +
  the final-bbox/viewBox pass `near` Phase A hooks into). `unsupportedReason` + `nearKey` in
  `media-src/src/d2-render.ts`; `Near` extraction in `media-src/vendor/d2/build/main.go`.
