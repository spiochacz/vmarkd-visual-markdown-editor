# Task 114 — Option B: cola.js / WebCoLa constraint-based layout (closest to TALA's character)

**Status:** planned (spike — pursue only if Option A's layered look isn't organic enough)

## Context

Part of the TALA-alternative cluster (**113 A** = ELK-full, **114 B** = this,
**115 C** = cola+libavoid composition, **116 D** = OGDF→WASM). See **task 113** for the
shared rationale (TALA = compact 2D packing + clean routing; d2/mermaid engines don't
reach it). **Do A (113) first** — only escalate here if elkjs-full still feels too
"layered" and you want organic, force-directed compactness.

## Adaptagrams lineage (verified 2026-06-18)

**WebCoLa IS the JS Adaptagrams.** It's an independent JS/TS reimplementation of
Adaptagrams' **`libcola`** (constraint layout) + **`libvpsc`** (separation-constraint QP
solver) + **`libproject`** (gradient projection), from the same research lineage
(Tim Dwyer et al). Crucially, because it's a **reimplementation, not a port** of the LGPL
C++, WebCoLa is **MIT** — that's _why_ Option B is license-clean while Option C
(libavoid-js, an actual WASM port) is LGPL. Adaptagrams ships official bindings only for
Java/Python (SWIG); the JS world relies on this reimplementation. (Full Adaptagrams family
map + the one unported gem, HOLA → **task 117**.)

## Why B

**WebCoLa (cola.js)** is the closest open-source engine to TALA's _character_. It's the
IPSEP-CoLa line: force-directed / stress majorization **with separation constraints**, so
unlike plain d3-force it does:

- **Non-overlap** removal via VPSC (Variable Placement with Separation Constraints).
- **Alignment / inequality / flow constraints** (e.g. "a above b", "these aligned").
- **Group/container support** with padding — nested boxes laid out and packed.
- Compact, organic 2D arrangements with no built-in "layer" bias → naturally squarer than
  ELK-layered, much more TALA-like in feel.

What it lacks: **good orthogonal edge routing**. cola routes edges straight / with simple
avoidance; the clean routed look needs libavoid (that's Option C, task 115).

## Scope / plan (spike)

1. Vendor **webcola** (`media-src/vendor/cola`, sha pin + MIT licence + `?v=`), same
   vendoring pattern as the other renderers.
2. A `layout-cola.ts`: `{nodes, edges, groups}` → cola layout (stress majorization,
   `avoidOverlaps:true`, `handleDisconnected`, group padding) → positioned geometry.
   Expose the knobs that matter: convergence iterations, symmetric/flow constraints,
   group containment.
3. Render positioned graph to SVG (shared shape drawer with task 113 — build it once,
   reuse). Edges: straight/segmented for now (routing polish deferred to C/115).
4. Theme-pair + live re-render (`vmarkd-renderer-theming` skill), like the other renderers.
5. Bench against TALA **and** against Option A (113) on the shared complex graph: aspect
   ratio, crossings, area, time — decide whether cola's organic packing beats ELK-full
   enough to justify the worse edge routing (and whether C is then needed to fix routing).

## Decisions

- Same input/consumer question as 113 (new fence vs mermaid backend vs d2 re-layout) —
  share the resolution; don't re-litigate per task.
- Determinism: cola is iterative/force-based → seed/iterations must be fixed so renders are
  reproducible (tests + no diff churn). Pin a deterministic start + iteration count.

## License analysis (gate — clear before vendoring)

**Must confirm we may ship it** before vendoring:

- **WebCoLa (cola.js)** is **MIT** — expected clean (same posture as our mermaid MIT
  vendor). Verify the actual `LICENSE` in the published artifact really is MIT (no bundled
  GPL/LGPL transitive deps inside the dist), ship the licence file, and confirm
  Marketplace/Open VSX terms are met.
- Record the verdict (OK / blocked) here **before** writing `syncCola()`. MIT → expected
  green; the real check is that the _shipped bundle_ carries no surprise copyleft deps.

## Out of scope

- Orthogonal edge routing (→ Option C / libavoid-js, task 115).
- A new authoring language (minimal spike syntax, shared with 113).

## Verification

- Unit: `layout-cola.ts` produces non-overlapping nodes; groups contain their children;
  a fixed seed/iteration count gives byte-stable positions (determinism guard).
- e2e (harness, headless): the fence renders; group/container nesting is respected; theme
  palette applied; same graph is visibly squarer than the ELK-layered baseline.
- Bench artifact: cola vs A vs TALA vs dagre table on the shared complex graph.
- `tsc` + `biome` + vitest + Playwright green, `xvfb-run -a`. **Verify coverage.**
