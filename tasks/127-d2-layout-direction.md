# Task 127 — D2 `direction` (up / down / left / right layout)

> **Status:** 🟢 DONE (root direction) — 2026-06-25, shipped in the Phase B WASM batch (with 128/133/126A).
> WASM marshals root `direction` (`g.Root.Direction`) + per-container `o.Direction`; ELK maps it to
> `elk.direction` with axis-aware ports (`elkDirectionConfig`), dagre to `rankdir`. Per the decision
> gates: scope = root-only (per-container deferred); horizontal (LEFT/RIGHT) uses the reduced pipeline
> (refine skipped) — option (b). Built on task 104 (renderer) + 122 (layout pipeline).
>
> **Decided/deferred:** per-container direction (the WASM field IS emitted on each shape, but ELK/dagre
> only consume the root); axis-aware refine generalisation for horizontal (currently skipped, not
> generalised). Follow-ups if there's demand.

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
- [x] Unit: a graph with root `direction: right` lays out left-to-right (node x-order follows edges) —
  `elk-layout.test.ts` (real ELK engine, `right` chain horizontal vs `down` vertical); `up` flips the
  y-order vs `down` — `d2-render.test.ts` (dagre rankdir). Pure mapping pinned by
  `elkDirectionConfig` unit tests.
- [x] WASM contract: `d2-wasm.test.ts` asserts root + per-container `direction` marshalled.
- [~] e2e (real-VS-Code): NOT re-run here (no xvfb). Covered automatically by the node-side real-ELK
  test; the real-VS-Code `d2-elk.spec` (default vmarkd) is unaffected. Byte-stability of DOWN proven
  via `d2-quality.test.ts` (frozen-layout refine+toSVG counts unchanged) + the provably-identical
  port refactor for `isHoriz=false`.
- [x] `d2-quality.test.ts` / typecheck / lint green (892 unit tests pass).

## Related
Tasks 104, 122 (refine pipeline this touches), 121/124 (the shared WASM bump). `elk-layout.ts`
direction wiring; `main.go` extraction.
