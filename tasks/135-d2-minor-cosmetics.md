# Task 135 — D2 minor cosmetics (grid gaps, connection corner-radius, misc low-ROI knobs)

> **Status:** 💡 idea / backlog (LOW priority) — created 2026-06-24. A catch-all for the small D2
> knobs we don't honour, found auditing the language surface. None are individually worth a task; each
> needs the same Go+WASM extraction, so fold into the task 121/124 Phase B bump (export now owned by [task 159](159-d2-wasm-export-batch.md)) and consume opportunistically.
> Builds on task 104.

## Items

### 1. Grid spacing — `grid-gap` / `vertical-gap` / `horizontal-gap`
- d2 grid containers accept gap controls; we compute a fixed cell padding in `computeGridInfo` /
  `drawGrid` (`d2-render.ts`). Source-set gaps are ignored.
- Cost: WASM (extract the three fields, already alongside `gridRows`/`gridColumns`) + use them in the
  grid cell math. Low value (defaults look fine).

### 2. Connection corner-radius — `(a -> b).style.border-radius`
- d2 can round or sharpen connection bends; we always render rounded orthogonal joints
  (`roundedPolyPath`) / splines. Per-edge `border-radius` ignored.
- Cost: WASM (edge `borderRadius`) + thread into the edge path builder. Cosmetic.

### 3. Misc / verify-as-found
- Diagram-level background via source `style.fill` on root (largely covered by the theme `bg`; a
  source override is rare). Confirm vs the binary; add only if it matters.
- Any other small `style.*` knob surfaced when implementing tasks 121/124/127–134 that isn't worth its
  own task lands here.

## Approach
Piggy-back on the one Go+WASM bump (tasks 121/124 Phase B): add these fields to `outShape`/`outEdge`,
then consume each in `d2-render.ts` when convenient. No standalone rebuild just for these.

## Decision gate
Pure backlog — only pick items up if a real diagram needs them or while already in the relevant code.
Keep the faithful-by-construction contract: an unsupported knob renders the sensible default (never a
wrong picture), so leaving these unimplemented is safe.

## Acceptance / tests
- Per item, when implemented: a unit test that the source value changes the output; byte-stable on the
  8 samples otherwise. Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 121/124 (the shared WASM bump), 127–134 (the larger gaps). `computeGridInfo`/`drawGrid` +
the edge path builder in `d2-render.ts`.
