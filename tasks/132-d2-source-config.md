# Task 132 — D2 source-level config (`vars.d2-config`: theme, sketch, pad, layout-engine, …)

> **Status:** 💡 idea / planned (decision-gated) — created 2026-06-24. Untasked D2 feature found
> re-auditing the docs + code. Needs WASM/compile-side extraction → coordinate with the task 121/124
> Phase B bump (export now owned by [task 159](159-d2-wasm-export-batch.md)). Builds on tasks 104, 119 (themes), 120 (sketch), 127 (direction).

## Problem
A D2 diagram can configure ITS OWN rendering in source via `vars.d2-config`:
```d2
vars: {
  d2-config: {
    theme-id: 200
    dark-theme-id: 200
    sketch: true
    pad: 20
    center: true
    layout-engine: elk
  }
}
a -> b
```
We honour **only the VS Code settings** (`vmarkd.diagram.d2Layout` / `d2Theme`). `grep d2-config|vars`
across `main.go` + the webview = nothing — so a diagram can't ask for its own theme, sketch, padding,
or engine. Each authored diagram looks however the global setting says.

## Root cause
`main.go` marshals shapes/edges/styles but never reads the graph's `vars` / `d2-config`. The data never
reaches the webview.

## Approach
- **WASM/compile:** surface `vars.d2-config` (theme-id, dark-theme-id, sketch, pad, center,
  layout-engine, and the few others d2 supports) on the graph JSON; add to `d2-wasm.ts`.
- **Map to our pipeline (most pieces already exist):**
  - `theme-id` / `dark-theme-id` → our `d2Theme` registry. Needs a **d2 theme-id → our theme-name**
    map (0→d2-original, 1→d2-neutral-grey, 4→d2-cool-classics, 200→d2-dark-mauve, 300→d2-terminal; the
    rest TBD/fallback).
  - `sketch` → task 120 (sketch mode).
  - `layout-engine` (`dagre`/`elk`) → the engine switch already in `custom-diagrams.ts`.
  - `pad` → the `viewBox` margin in `toSVG`; `center` → layout/viewport centring.
- **Precedence (decision gate):** does the SOURCE `d2-config` win, or the VS Code setting? Proposed:
  per-diagram `d2-config` is explicit authoring intent → it **wins** for that diagram; the setting is
  the global default for diagrams that don't set one. (Mirror d2's own "more-specific wins"; confirm
  against the binary's CLI-flag-vs-d2-config behaviour.)

## Decision gates
- Precedence (above). Which keys to support first (theme-id + sketch + layout-engine are the high-value
  ones; pad/center cosmetic).

## Acceptance / tests
- Unit: a block with `vars.d2-config.theme-id: 200` renders in `d2-dark-mauve` even when the global
  setting is `d2-original`; `sketch: true` enables sketch for that block only.
- Keep `d2-quality.test.ts` / typecheck / lint green; byte-stable on the 8 samples (none set d2-config).

## Related
Tasks 104, 119 (theme registry + the id→name map lives near `d2Theme`), 120 (sketch), 127
(direction/engine), 121/124 (WASM bump). Extraction in `main.go`; consumption in `custom-diagrams.ts`.
