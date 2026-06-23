# Task 123 — D2 layout pipeline: architecture refactor (decouple + slim)

> **Status:** 🟡 PARTIAL (2026-06-23). Came out of an architecture review of the D2 render pipeline
> (`d2-wasm → d2-render/elk-layout → d2-refine → toSVG`). The cheap, high-ROI steps are **done**; the
> larger module split is **planned** behind the now-committed quality net. Every step must keep the
> rendered SVG **byte-identical** across the 8 `tmp/d2-compare/gen/*.d2` diagrams (capture a baseline,
> diff after each change) and keep `d2-quality.test.ts` / typecheck / lint:ci / `npm test` green.

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

### Variant B — slim `d2-refine` by extracting two modules (+2 files, no `d2-render` split)
- [ ] **`d2-geometry.ts`** — shared axis-aligned primitives currently duplicated/split between
  `d2-render` (`simplifyRoute`, `straightenEnds`) and `d2-refine` (`dccw`, `segsCross`, `parDist`,
  `boxDist`, `wallDist`, `segHitsABox`). One home, imported by both refine and the SVG serializer.
- [ ] **`astar.ts`** — the back-edge router (`astar` + binary heap + Hanan grid + `edgeSegs` spatial
  index + `ABox`/constants). ~280 LOC out of `d2-refine` (1816 → ~1300), router becomes independently
  testable.
  - ⚠️ **Dependency caution:** `astar.ts` needs the geometry primitives from `d2-geometry.ts`, NOT from
    `d2-refine` — otherwise `rerouteBackEdges` (in d2-refine) → `astar` → d2-refine reintroduces a cycle.
    So the two extractions go together (geometry first).
- [ ] Verify byte-identical (baseline+diff) + `d2-quality.test` + typecheck/lint/tests after each move.

### #4 — standardize the per-pass guard contract
- [ ] Introduce a higher-order `guarded(layout, metrics, mutate)` that snapshots the chosen quality
  metrics, runs the mutation, and reverts if ANY worsens. Today each pass hand-rolls snapshot/guard/revert
  and they're **inconsistent** (some guard only `countCrossings`, some also `collinearOverlapCount`, some
  revert per-edge vs whole-pass). This was the root of real bugs this session (bundleSourceSiblings needed
  a collinear guard added; the container-wall run slipped because no guard modelled walls). Unify the
  metric set: crossings + collinear-overlap + on-wall + label-overlap.

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
