# Task 123 — D2 layout pipeline: architecture refactor (decouple + slim)

> **Status:** 🟢 DONE (2026-06-25). Came out of an architecture review of the D2 render pipeline
> (`d2-wasm → d2-render/elk-layout → d2-refine → toSVG`). All planned work is complete: the cheap high-ROI
> steps, the **Variant B module split** (d2-geometry + astar, byte-identical-verified), and **#4 (unified
> per-pass guard metric set)** — done pass-by-pass and eval'd by eye (it intentionally shifts 3 diagrams:
> microservices / dataplatform / oauth, all improvements or an accepted overlap-vs-crossing tradeoff). The
> full `d2-render` God-module split stays **deferred** (see below). `npm test` (840) / typecheck / lint:ci
> (exit 0) / `node build.mjs` all green. One reviewable **follow-up** remains: the stale `d2-quality` fixture
> (see #4). Nothing committed — awaiting the user's git call.

## Why

The pipeline works and is fast (see task 122 + the 2026-06-23 perf pass), but the module structure has
two real smells flagged by the review:

1. **Circular dependency** `elk-layout.ts ↔ d2-refine.ts` (now fixed).
2. **`d2-render.ts` is a God-module** (~1394 LOC: data model + text measure + sizing + dagre engine +
   SVG serializer + route geometry + labels) and **`d2-refine.ts` is large** (~1816 LOC: pipeline +
   ~15 passes + geometry primitives + the whole A* router), mixing levels of abstraction.

The guiding principle from the review: do the cheapest decoupling first, guard it with a CI quality test,
and only escalate to the heavy God-module split if `d2-render` actually starts to hurt.

## Done

- [x] **#1 — break the `elk-layout ↔ d2-refine` cycle.** Moved `alignRows` + `spreadCrampedRows`
  (refinement passes that lived in `elk-layout.ts`) verbatim into `d2-refine.ts`; `d2-refine` no longer
  imports `elk-layout`. Dependency flow is now acyclic: `elk-layout → d2-refine → d2-render → d2-wasm`.
  Commit `c979894`. Byte-identical output.
- [x] **#5 — layout-quality regression net in CI.** `media-src/src/d2-quality.test.ts` replays
  `refineLayout` + `toSVG` over 4 frozen raw-ELK layouts (`__fixtures__/d2-raw-layouts.json`) and asserts
  a fixed crossing count + ZERO of every overlap class (label-on-label, label-on-box, edge-through/along-
  box, edge-on-edge). Pure node, runs under `npm test`. This is the safety net for ALL steps below.
  Commit `2e8fd7d`. (Regenerate the fixture only when `layoutElk`/elk config changes:
  `tmp/d2-compare/dump-layouts.mjs`.)
- [x] *(related)* A* router perf — replaced the per-iteration `open.sort()` with a binary min-heap keyed
  `(f, push-seq)` (identical pop order) + numeric grid keys + a spatial index over `edgeSegs`. refine
  ~6–10× faster, byte-identical. Commits `f10f42c`, `df91a89`.
- [x] *(related)* `npm run typecheck` brought green (11 pre-existing errors across echarts-fit /
  custom-diagrams / elk-entry / elk-layout). Commit `6f8b501`.

## Planned — the "rest of the refactor"

### Variant B — slim `d2-refine` by extracting two modules (+2 files, no `d2-render` split) ✅ DONE (2026-06-24)
- [x] **`d2-geometry.ts`** (277 LOC, leaf) — shared axis-aligned primitives that were duplicated/split
  between `d2-render` (`simplifyRoute`, `straightenEnds` + private helpers `dedupeCollinear`,
  `segHitsRect`, `pointSegDist`, `endpointBox`, `Rect`) and `d2-refine` (`dccw`, `segsCross`, `parDist`,
  `boxDist`, `wallDist`, `segHitsABox`, `ABox`, `ASTAR_M`, `Pt`). The two `segsCross` copies were
  byte-identical → consolidated to one `Pt`-typed export. Imported by both the SVG serializer and refine.
- [x] **`astar.ts`** (305 LOC) — the back-edge router (`astar` + binary heap + Hanan grid + `edgeSegs`
  spatial index + `ANode` + cost constants `COMFORT/COMFW/EDGECLR/ASTAR_PAD/ASTAR_STEP`) lifted out of
  `d2-refine`. `rerouteBackEdges` stays in refine and imports `astar`.
  - ✅ **Dependency caution honoured:** `astar.ts` imports its geometry primitives from `d2-geometry.ts`,
    NOT from `d2-refine` — so `rerouteBackEdges` (refine) → `astar` → `d2-geometry` stays acyclic.
    Geometry was extracted first. `boxDist`/`parDist` turned out to be used by `compactBackRings` too (not
    only astar) — confirms they're genuinely shared, correctly homed in geometry.
  - Result: `d2-refine.ts` 1940 → 1571, `d2-render.ts` 1716 → 1518. New flow:
    `d2-geometry ← astar ← d2-refine`, `d2-geometry ← d2-render`, `d2-refine → d2-render` (types) — acyclic.
- [x] Verified byte-identical (baseline+diff over all 8 `gen/*.d2`) + `d2-quality.test` (55 d2 tests) +
  typecheck + `lint:ci` (exit 0) + `node build.mjs` after each move. `d2-render.test.ts` import of
  `simplifyRoute`/`straightenEnds` repointed to `./d2-geometry`.

### #4 — unify the per-pass guard metric set — ✅ DONE (2026-06-25, pass-by-pass, eval'd by eye)
Done as targeted per-move guards (NOT a single higher-order `guarded()` helper — keeping each pass's own
per-move revert granularity is safer than a coarse whole-pass snapshot, and gives the same metric coverage).
Diagnosed with a per-pass metric trace (`tmp/d2-compare/trace-metrics.mjs` over the 4 frozen fixtures, then
`trace8.mjs` over all 8 via the live WASM pipeline using refineLayout's `__refineTrace` seam): each pass now
guards crossings **and** collinear-overlap **and** container-wall, where before some guarded only crossings.

- [x] **`deleteBendsEndpoints` + collinear guard** — it guarded box (`objIntersects`) + crossings
  (`edgeCross`) per-move but not collinear, so a bend deletion dropped a route onto another edge's line
  (oauth: `line 0→2`, only cleaned 6 passes later by luck in `rerouteBackEdges`). Added `edgeCollinear`
  per-move guard (same tolerance as the d2-quality `lineOnLine` metric). Eval'd by eye: **microservices
  improved** (route/read separated), oauth neutral. User: keep.
- [x] **`deOvershoot` + container-wall guard** — its `hitsBox` tested leaf interiors only, so a collapse
  could run a segment collinear along a *container* wall (dataplatform: `box 0→1`, the "container-wall run
  slipped" bug; was only undone next pass by `detourContainers`). Added `hugsCont` per-move guard (same
  tolerance as the d2-quality lineOnBox wall branch). Eval'd by eye: **dataplatform improved** (snapshot/
  archive pushed off the container wall onto a clean lane), rest unchanged. User: keep.
- [x] **`rerouteBackEdges` + collinear guard** — its greedy accept watched only `countCrossings`, so it
  accepted a reroute that lowered crossings while creating an edge-on-edge overlap. The **live** microservices
  render shipped with this overlap (`line=2` pre-task, `line=1` after the deleteBends guard); the frozen
  quality fixture never caught it because it had drifted from the live ELK output. Added a
  `collinearOverlapCount` term to the accept test. Eval'd by eye: a real **tradeoff** — microservices
  `crossings 2→3` but `edge-on-edge 1→0`; an unreadable overlap is worse than a clean crossing
  ("lower crossings ≠ better diagram"). User: keep AFTER.
- [x] Verified: `trace8.mjs` now reports **no pass raises any metric on any of the 8 diagrams**;
  `npm test` (840), typecheck, `lint:ci` (exit 0), `node build.mjs` all green. #4 footprint vs the original
  pre-task render: only microservices / dataplatform / oauth changed (all improvements/accepted tradeoff);
  the other 5 byte-identical.

- [x] **Follow-up — refreshed the stale `d2-quality` fixture + promoted its generator into the repo
  (2026-06-25).** The frozen `__fixtures__/d2-raw-layouts.json` had drifted from current `layoutElk` output,
  so the CI net exercised geometry the live webview no longer produces — exactly why it missed the
  microservices edge-on-edge. Regenerated it from the live pipeline; `EXPECT` values were unchanged but are
  now load-bearing (verified by re-removing the `rerouteBackEdges` guard → the test now FAILS:
  `drawn crossings expected 2 to be 3` + `rerouteBackEdges must not raise edge-on-edge`). The generator
  (was `tmp/d2-compare/dump-layouts.mjs`, gitignored) is now version-controlled at
  `media-src/scripts/d2-fixtures/` (`gen.mjs` + `gen.entry.ts` + `sources/*.d2`) so the fixture is
  reproducible on a clean checkout; the test header comment points there. typecheck / lint:ci / `npm test`
  (871) / build green.

## Deferred — NOT planned now

- **Full `d2-render` God-module split** into `d2-model.ts` / `d2-measure.ts` / `d2-dagre.ts` /
  `d2-svg.ts` (4 of the 6 files from the review's "target structure"). This is the bulk of the churn for
  the least urgent benefit: `d2-render` is cohesive from the outside (one serializer, one dagre engine)
  and is NOT in a dependency cycle. Reconsider only if it starts to hurt.

## Target structure (review reference)

```
d2-wasm.ts        # leaf (unchanged)
d2-model.ts       # types: Layout, PlacedNode/Edge, NodeKind, D2Palette        (deferred)
d2-geometry.ts    # segsCross, parDist, boxDist, wallDist, simplifyRoute…      (Variant B)
d2-measure.ts     # Sizer, sizing                                              (deferred)
d2-dagre.ts       # dagre engine → model                                       (deferred)
elk-layout.ts     # ELK engine → d2-refine (already NOT importing refine back) ✅ done
astar.ts          # back-edge router → model, geometry                         (Variant B)
d2-refine.ts      # passes + pipeline + guarded() → model, geometry, astar     (Variant B + #4)
d2-svg.ts         # toSVG + label deconfliction → model, geometry              (deferred)
custom-diagrams.ts# dispatcher; consider options object over window globals    (optional)
```

## Verification (every step)

1. `cd tmp/d2-compare && node render-one.mjs <8 ids>` → `diff` each against a pre-change baseline = identical.
2. `npm test` (incl. `d2-quality.test.ts`), `npm run typecheck`, `npm run lint:ci` — all green.
3. `node build.mjs` succeeds.
