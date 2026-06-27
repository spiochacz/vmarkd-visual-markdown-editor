# Task 130 — D2 explicit `width` / `height` on shapes

> **Status:** 💡 idea / planned (low priority) — created 2026-06-24. Untasked D2 gap found auditing
> `main.go`. Needs a Go+WASM field extraction → batch with task 121/124 Phase B (export now owned by [task 159](159-d2-wasm-export-batch.md)). Builds on task 104.

## Problem
D2 lets a shape pin its size: `x: { width: 200; height: 80 }` (and images REQUIRE an explicit size).
We ignore it — every shape is auto-sized by `dimsToFit` to fit its label — so a source that sets an
explicit `width`/`height` renders at the computed size instead.

## Root cause
`main.go` marshals `strokeWidth` but not the object's `Width`/`Height` attributes (they're object
attrs, not `style.*`). Not in the graph → not honoured.

## Approach
- **WASM:** marshal `o.Width`/`o.Height` (when set) onto `outShape`; add to `d2-wasm.ts` types.
- **Sizing:** in `leafInfo`/`shapeBox` (`d2-render.ts`), when an explicit dim is present use it as the
  box size (d2 semantics: explicit overrides, but never smaller than fits the label — clamp to
  `max(explicit, dimsToFit)` to avoid label clipping; confirm against the real binary).
- Feeds layout (ELK/dagre node size) + the shape draw, same path auto-sizes use today.

## Decision gates
- Override vs floor: does d2 clip the label if `width` is too small, or grow? Match the binary
  (`projects/tala/bin/d2`) — render a small-`width` shape and measure.
- Prerequisite for `shape: image` (task 124 item 3), which needs an explicit size to reserve the box.

## Acceptance / tests
- Unit: a shape with `width: 200; height: 80` produces a 200×80 box in the layout + SVG; a shape
  without stays auto-sized (byte-stable on the 8 samples).
- Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 124 (image shapes depend on this), 121/124 (shared WASM bump). `leafInfo`/`shapeBox`/
`dimsToFit` in `d2-render.ts`; extraction in `main.go`.
