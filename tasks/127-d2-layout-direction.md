# Task 127 — D2 `direction` (up / down / left / right layout)

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. One of the untasked D2 feature
> gaps found auditing `main.go`. Needs a Go+WASM field extraction → batch with task 121/124 Phase B
> (one rebuild). Builds on task 104 (renderer) + 122 (layout pipeline).

## Problem
D2's `direction: up | down | left | right` sets the layout flow (per scope — root and/or each
container). We always lay out **top-down**: our compile-only WASM (`media-src/vendor/d2/build/main.go`)
doesn't marshal `direction`, so a source that asks for `direction: right` still renders downward.

## Root cause
`main.go` extracts no direction field (graph- or object-level). The data simply never reaches the
webview. ELK (`elk-layout.ts`) and dagre both support a direction (`elk.direction` = `DOWN/UP/RIGHT/
LEFT`; dagre `rankdir` = `TB/BT/LR/RL`) — we just hard-wire DOWN.

## Approach
- **WASM:** marshal `direction` (root, and ideally per-container — d2 allows nested overrides). Add to
  `outShape`/graph JSON + `d2-wasm.ts` types.
- **Layout:** map → ELK `elk.direction` / dagre `rankdir`. Root direction first; per-container is a
  follow-up.
- **⚠️ Refine-pipeline interaction (the real risk):** `d2-refine.ts` passes assume a **vertical** flow
  (`adaptiveLayerGaps` compresses vertical bands, `alignRows`, channel logic, the A* grid). A `LEFT/
  RIGHT` (horizontal) layout would need those passes generalised to the cross-axis, or selectively
  skipped for horizontal direction. Decide: (a) generalise refine to be axis-aware, or (b) for LR/RL
  run a reduced refine (layout + basic cleanup only) until the passes are axis-aware. `UP/DOWN` is
  low-risk (same axis, just flipped).

## Decision gates
- Scope: root-only direction (cheap) vs per-container (matches d2, more work in graph build + refine).
- Horizontal refine: generalise vs reduced-pipeline. Pick before implementing LR/RL.

## Acceptance / tests
- Unit: a graph with root `direction: right` lays out left-to-right (node x-order follows edges); `up`
  flips the y-order vs `down`.
- e2e (real-VS-Code): a `direction: right` D2 block renders horizontally; existing top-down diagrams
  unchanged (byte-stable on the 8 samples — none set direction).
- Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 122 (refine pipeline this touches), 121/124 (the shared WASM bump). `elk-layout.ts`
direction wiring; `main.go` extraction.
