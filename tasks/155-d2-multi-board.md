# Task 155 — D2 multi-board composition (`layers` / `scenarios` / `steps`)

> **Status:** 💡 idea / planned — LARGE, decision-gated / on-demand. Split out of task 124 #6
> (2026-06-25). A single `.d2` file can define MANY boards (diagrams); we render only the root and
> silently drop the rest. **Do the cheap loud-fallback first** (faithful-by-construction); the full
> navigation UI is a big, separate effort behind real demand.

## Problem
D2 composition lets one file hold multiple boards via three keywords:

- **`layers`** — independent child boards you *drill into* (zoom into a node to see its internals):
  ```d2
  system -> db
  layers: {
    db_internals: { pgbouncer -> postgres -> replica }
  }
  ```
- **`scenarios`** — alternates that *inherit* the base board and overlay deltas (same system, different
  state — "normal" vs "failure"):
  ```d2
  api -> db
  scenarios: { failure: { db.style.fill: red; api -> cache: fallback } }
  ```
- **`steps`** — like scenarios but *cumulative*; each step inherits the previous (progressive
  reveal / animated walkthrough):
  ```d2
  steps: { 1: { a -> b }; 2: { b -> c }; 3: { c -> a } }
  ```

The real `d2` CLI renders these as an **animated SVG** (`--animate-interval`, cycling boards/steps),
an **interactive SVG** with a board-navigation panel (click into a layer), or N separate files. **Our
renderer compiles only the root graph** (`d2compiler.Compile` → root) and never sees the board tree,
so a multi-board file shows only board 1 — silently, the failure mode our faithful-by-construction
contract forbids.

## Why it's LARGE (a new dimension, not one field)
1. **WASM:** the compile-only entrypoint (`media-src/vendor/d2/build/main.go`) emits only the root
   graph. Multi-board lives in the board tree (`g.Layers` / `g.Scenarios` / `g.Steps`, each a full
   `*d2graph.Graph`). Need to walk the tree and emit EVERY board (each = full shapes/edges/styles),
   plus the board kind + name + parent/child links for navigation.
2. **Layout:** one layout pass per board (dagre/ELK × N), not one.
3. **Webview UI:** a board switcher integrated into the diagram surface — tabs/dropdown (layers/
   scenarios), a step slider + play (steps), drill-down click (layers). Real UI work.
4. **Interaction:** three distinct UX models (drill-down vs pick-variant vs sequence/animate).

## Approach (phased)
- **Phase 1 — loud fallback (cheap, do first):** detect a multi-board file (root graph has any
  `layers`/`scenarios`/`steps`) and surface it LOUDLY — either extend `unsupportedReason`
  (`d2-render.ts`) like `sequence_diagram`, or render the root board + a visible note "+N boards
  (layers/scenarios/steps) not shown". Needs only a small WASM flag (e.g. `boardCount` / a
  `hasBoards` bool on `outGraph`) or even a JS-side source scan. Closes the silent-drop gap.
- **Phase 2 — static multi-board render (medium):** WASM emits all boards; the webview renders them
  stacked or behind a simple tab/dropdown switcher (no animation, no drill-down click yet). Covers
  `scenarios` well.
- **Phase 3 — interactive (large):** drill-down click for `layers`, a step player (play/slider +
  optional auto-animate, respecting `prefers-reduced-motion`) for `steps`. Full parity with the d2 CLI.

## Decision gates
- **Scope:** Phase 1 (loud fallback) is almost free and removes the correctness gap — ship it
  independently of whether 2/3 are ever done.
- **Navigation surface:** where the switcher lives (overlay on the SVG vs a control bar above it) and
  how it coexists with the diagram zoom/pan gate (`diagram-zoom-gate.ts`).
- **Steps animation:** CSS/JS step cycling must honour `prefers-reduced-motion` (reuse the task 124 #1
  `.d2-anim` reduced-motion pattern).
- **Inheritance:** `scenarios`/`steps` inherit + overlay the base — confirm d2 resolves the FULL board
  per scenario/step at compile time (so each emitted board is already complete; we don't re-merge).

## Acceptance / tests
- [ ] Phase 1: a `.d2` with `layers`/`scenarios`/`steps` no longer silently renders only the root —
  `unsupportedReason` flags it OR a note lists the dropped boards. Unit (`d2-render.test.ts` /
  `d2-wasm.test.ts`) + a fixture block in `all-renderers.md` §18.
- [ ] Phase 2/3 (if pursued): all boards compile + lay out; the switcher renders each; steps play
  respects reduced-motion; layers drill-down navigates. e2e via the render harness + real-VS-Code.
- [ ] `d2-quality.test.ts` / typecheck / `lint:ci` green; faithful-by-construction kept (never a
  silently-wrong picture).

## Related
Parent task 124 (D2 feature parity) #6. Tasks 104 (renderer), 125 (sequence_diagram fallback — the
loud-fallback precedent), 123 (pipeline). Files: `media-src/vendor/d2/build/main.go` (`outGraph`),
`media-src/src/d2-wasm.ts` (`D2Graph`), `media-src/src/d2-render.ts` (`unsupportedReason`, render),
`media-src/src/custom-diagrams.ts` (webview wiring), `diagram-zoom-gate.ts` (interaction coexistence).
