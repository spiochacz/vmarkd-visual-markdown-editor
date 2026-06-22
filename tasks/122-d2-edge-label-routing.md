# Task 122 — D2 edge-label placement + connection polish

> **Status:** 🟢 LAYOUT PIPELINE BAKED TO PRODUCTION (2026-06-22). The full post-process pipeline +
> back-edge A* router — developed/validated in the `tmp/d2-compare` harness — is now shipped in
> production code:
> - **`elk-layout.ts` `layoutElk` toggles baked** (no more `__` A/B globals): port pre-pass always runs;
>   leaf widening = D2's exact rule (`outs>=2||ins>=2 → max(natural, max(in,out)*40)`); `portConstraints`
>   always `FIXED_SIDE`; per-container `edgeEdge=24` / `edgeNode=60` / `contPad=24`; root `edgeNode=60`.
>   Removed the dead `__selWiden` and `__portOrderCx` branches.
> - **New `d2-refine.ts` `refineLayout(layout)`** runs the validated pipeline in order:
>   `alignRows → adaptiveLayerGaps → spreadCrampedRows → monotonizeEdges → deleteBendsEndpoints →
>   deOvershoot → detourContainers → alignChannels → bundleSiblings → back-edge A* reroute → placeLabels`
>   (labels last so they follow rerouted back-edges). Constants baked: gap `clamp(40+22*lines,40,280)`,
>   `CHANSPACE=40`, A* `M=10/COMFORT=40/COMFW=6/EDGECLR=20/PAD=64/STEP=24`. Back-edge reroute preserves
>   both ELK port stubs verbatim, A*-routes only the middle, and is greedily accepted only if it does not
>   increase the total crossing count.
> - **`renderD2GraphElk` wired** to `refineLayout` (was inline `alignRows + spreadCrampedRows`).
> - **Verified:** 6-diagram production crossing check (`tmp/d2-compare/verify-prod.mjs`, renders through
>   the PRODUCTION `renderD2GraphElk`) matches the harness exactly — ecommerce 0, vpc 1, cqrs 0, ml 1,
>   sso 0, gitops 0. Unit tests added (`d2-refine.test.ts`): deOvershoot collapses an opposite-direction
>   H-V-H bump; bundleSiblings raises a late jog (keeping ≥CHANSPACE 40 from a blocking horizontal); a
>   back-edge reroute preserves both stubs. Full unit suite 770 pass; build + biome clean (new/changed
>   files). Still pending: the e2e/real-VS-Code no-overlap assertion (point below).
>
> **Status:** 🟡 PARTIAL (2026-06-21). **SHIPPED:** (1) variant A — labels handed to ELK with measured
> size + `elk.edgeLabels.placement: CENTER`, ELK reserves a gap (label dummy node), we read its
> position (`elk-layout.ts`); (2) connection polish in `toSVG` (`d2-render.ts`) — **rounded corners**
> (`roundedPolyPath`: `L` to before the bend + `Q` through the corner, radius clamped to half-segment,
> mirrors D2 `pathData`) + **endpoint trim** (`towards`: retract the line end so the stroke meets the
> arrowhead base, mirrors D2 `getArrowheadAdjustments`); (3) **D2 on-line labels** — per-label
> `elk.edgeLabels.inline:true` (ELK centres the label ON the line; root-level was a no-op) + a `<mask>`
> in `toSVG` that cuts the connection line out from under each label box (mirrors D2 `makeLabelMask`;
> theme-independent, no opaque plate), unique mask id per diagram (content hash). Verified: unit tests
> ("reserves layer space", "rounds an orthogonal bend", "trims the line end", "masks the line under an
> on-line label"); (4) **route simplification** (`simplifyRoute` — mirrors D2 `deleteBends`): drops
> collinear points + straightens interior staircases into a single L, **obstacle-guarded** (never
> routes through a leaf-node box; containers/grids excluded). On-line labels re-anchor to the
> SIMPLIFIED route's midpoint so label + mask stay synced. Verified: unit tests
> ("reserves layer space", "rounds an orthogonal bend", "trims the line end", "masks the line under an
> on-line label", "straightens an interior staircase", "keeps it when blocked", "drops collinear") +
> visual `our_elk_simplified.png` (32 real bends, long routes now clean L's, matches D2).
> (5) **row alignment** (`alignRows` in `elk-layout.ts`, in `renderD2GraphElk`): snap top-level leaf
> rows to a common centre-Y (ELK centres uniform rows but not mixed-height ones — a tall cylinder next
> to short rects left boxes ~34px off; no ELK flag fixes it, verified). Drag edge endpoints by their
> nearest node's Δy; `simplifyRoute` re-cleans. Container children left alone. Verified across 6
> diagrams (`tmp/d2-compare/cmp_aligned_*.png`) — fixes mixed rows, no-op on uniform/simple ones,
> nothing broke. Unit tests: snaps a grouped row, leaves container children alone.
> (6) **routing polish round (2026-06-21):** (a) `elk.layered.spacing.edgeNodeBetweenLayers=40` — the
> inter-layer edge↔node clearance (ELK default 10 → bends hugged boxes; D2 uses 40), so turns sit ~30px
> farther out. (b) on-line label read straight from ELK `lx/ly` (honours ELK's deconfliction spread)
> instead of recomputing the geometric midpoint. (c) **`straightenEnds`** ports D2 deleteBends'
> source/target S-shape removal (kills the tiny port-attach pixel-steps), capped at `MAX_KINK=24` so it
> only absorbs pixel kinks, never a genuine routing step (else an edge re-attached near a box corner —
> e.g. d2_hub `route` must enter orders' centre). (d) **selective anchor-guard**: `simplifyRoute` takes
> an `anchor` (the label point) and refuses to straighten the side-channel out from under it — but ONLY
> for **parallel/antiparallel pairs** (a node-pair with ≥2 edges, e.g. d1_pipeline run↔report), where
> ELK made that channel to keep the two inline labels apart. A lone labelled edge (e.g. big2 `notify`)
> gets no guard → it straightens freely (no frozen staircase). `PlacedEdge.src/dst` now thread the
> endpoint ids so toSVG can spot pairs. Verified by eye across all 6 canaries + 32 unit tests.
> **Still open:** cross-container alignment (a top-level node like Redis vs a container's content row —
> deliberately skipped); variant B (collision-aware label nudge for the densest hubs). Routing beyond
> ELK still escalates to task 115 (libavoid).
> **Future refactor (the real fix):** PORT DISTRIBUTION like D2 (d2elklayout widens multi-edge nodes +
> assigns each edge a distinct ELK port). Then parallel edges attach at different points → labels
> separate with no channel/guard, and every edge routes more directly → could delete the anchor-guard +
> `MAX_KINK` heuristics. Biggest/riskiest change (rewrite the ELK node/edge build with `portConstraints`),
> deferred in favour of the contained selective-guard above.
>
> **ELK bend flags are a dead end (verified):** `unnecessaryBendpoints`/`favorStraightEdges` don't
> change the visible routing (they only add collinear points → same drawn line). D2 reduces bends in
> its renderer (`deleteBends`), not via ELK — which is what (4) replicates.
>
> **Port distribution — SHIPPED at natural width (2026-06-21):** the "future refactor" above is now in
> `elk-layout.ts`: each leaf gets one ELK port per edge, spread across its EXISTING border at
> `x = w*(k+1)/(n+1)` (1 edge → dead centre, `portConstraints: FIXED_POS`, out=SOUTH/in=NORTH), keyed by
> the absolute `graph.edges` index so the edge loop references the same port. Boxes are NOT widened
> (`w` = natural). Containers get no ports (edge uses the free container port). A box-widening variant
> (D2's `Width=max(W, max(in,out)*PORT_SPACING)`, `PORT_SPACING=40`) exists behind the harness-only
> `__portWiden` global — tested, NOT adopted: it only spreads heavy-fanout nodes a little, lines
> reconverge past the box, and boxes stop holding equal width in a row. Harness A/B toggles
> `__noPorts`/`__portWiden` are gated by `globalThis` and never set in production.
>
> **Single-edge centring — verified + caveat (2026-06-21):** measured Δ=0.0 for every 1-out/1-in leaf
> (raw ELK port = box centre, both in a trivial chain and full ecommerce). The IN line renders dead
> centre. The OUT line can drift a few px off-centre because `straightenEnds` collapses a small
> port-attach step (< `MAX_KINK`) to run the line straight into the next node (e.g. ecommerce `index`:
> port 854, but Search Index sits at 867 → exit straightened to ~858). Intentional (matches D2
> deleteBends); leaving it. (Diagnostic gotcha: `toSVG` adds `OFF=10` to every drawn point — a guide
> drawn at raw coords sits 10px left of the render.)
>
> **Straightness lever = node-placement, NOT group width (verified 2026-06-21):** giving boxes more
> horizontal room (`elk.spacing.nodeNode` 40→100) did NOT straighten edges (ecommerce 1/17 → 0/17, mean
> horizontal Δ unchanged ~77px) — the box↔partner offset is fan-out geometry, not crowding. What helps:
> `elk.layered.nodePlacement.strategy = NETWORK_SIMPLEX` (vs default Brandes-Köpf/BALANCED) →
> dead-straight verticals jump per diagram: ecommerce 1→7, ml 6→8, cqrs 5→7, gitops 4→6, vpc 5→5, sso
> 6→6 (≤17 edges each), SAME width, no crossing regression on the 6-diagram gallery. **Kept BALANCED**
> (user decision 2026-06-21) for parity with D2's own d2elklayout (which uses BALANCED) — the extra
> straight lines weren't worth diverging from the D2 look. Re-run: `tmp/d2-compare/run30.mjs` (metric),
> `run31.mjs` (gallery).

## Source-verified facts (D2 v0.7.1 / commit 2446e24, fetched 2026-06-21)
From `d2renderers/d2svg/d2svg.go` + `d2layouts/d2elklayout/layout.go`:
- **On-line labels:** D2 sets `elk.edgeLabels.inline:true` **per label** (on the ELKLabel's
  LayoutOptions, NOT root — that's why a root-level `inline:true` was a no-op in our test) + label
  position `INSIDE_MIDDLE_CENTER`, and `makeLabelMask` → `mask="url(#…)"` cuts the line under the text
  (a mask, not an opaque plate). To match D2's on-line look: per-label inline + a mask/plate in `toSVG`.
- **Routing render:** `pathData` = straight `L` + rounded bends via smooth-cubic (`S`/`C`), radius =
  `connection.BorderRadius` clamped to half-segment, + a short-segment special-case; endpoints
  retracted by `(edgeStroke+shapeStroke)/2 (+edgeStroke if arrowhead)` (`getArrowheadAdjustments`).
  We reproduced this with `Q`-corners + `towards()` trim (equivalent). The route POINTS come from ELK
  (same as ours) — D2 does NOT re-route for the ELK engine.
- **D2's ELK option set** (not all ours): `nodePlacement.bk.fixedAlignment=BALANCED`, `thoroughness=8`,
  `cycleBreaking.strategy=GREEDY_MODEL_ORDER`, `considerModelOrder.strategy=NODES_AND_EDGES`,
  `nodeSize.constraints=MINIMUM_SIZE`, `contentAlignment=H_CENTER V_CENTER`, larger spacing/padding;
  does NOT use wrapping/aspectRatio. (Layout-tuning lever → cross-ref task 113.)

## Problem (verified in our code, 2026-06-21)
On `big1_micro` our edge labels overlap lines/boxes while the D2 CLI's sit in clear gaps.

**Root cause — we never tell the layout engine the labels exist:**
- `elk-layout.ts:144` builds each edge as `{ id, sources, targets }` — **no `labels`**. ELK therefore
  reserves zero space for label text and packs nodes/edges tightly.
- After layout we drop the text at the route's MIDDLE bend point: `mid = pts[Math.floor(pts.length/2)]`
  (`elk-layout.ts:185`, drawn by `toSVG` at `e.lx/e.ly`). That midpoint is often a line crossing or a
  box → collision. There is **no space reservation and no collision check**.

(Connection *routing* itself is ~parity: with the ELK engine D2 uses the SAME ELK orthogonal router we
do, so its bend geometry ≈ ours. D2's genuinely better routing is its TALA engine, which is
closed/paid — not shippable. So this task is mostly LABELS + small connection-detail polish, not a new
router; real router gains live in task 115/libavoid.)

## Approach — labels (pick A, optionally add B)
**A. Reserve space in ELK (let the engine do the work) — preferred, cheapest.**
Attach the measured label to the ELK edge and enable edge-label placement:
```
elkEdge.labels = [{ text: e.label, width: measure(e.label).w, height: measure(e.label).h }]
// root layoutOptions:
'elk.edgeLabels.placement': 'CENTER',
'elk.layered.spacing.edgeLabelSpacing': '<small>',  // gap around the label
```
ELK's layered algorithm inserts a **label dummy node** → it widens the layer gap / offsets the edge to
make room, and returns the label's own x/y in a cleared spot. Read that back in `collectEdges`
(`e.labels[0].x/y + offset`) instead of computing the midpoint. Measure with the same `canvasMeasure`
used for nodes so the reservation matches what we draw.

**B. Collision-aware nudge (post-pass) — optional, on top of A or as fallback.**
We already prototyped this in the spike: `tmp/compare/compare.mjs` `renderOurs` scores candidate
positions along the route, penalising overlap with boxes / other lines / other labels, and picks the
best. Port that scorer into `toSVG` (or a small `placeEdgeLabels(layout)` helper) for the cases ELK's
reservation doesn't fully clear (dense hubs).

## Approach — connection detail polish (small, point 3)
- **Border attachment:** trim each route's first/last segment to the shape's actual border point (and
  pick a sensible side) instead of the node centre, so arrows touch the box edge cleanly.
- **Corner rounding:** render orthogonal bends with a small radius (quadratic corner) instead of hard
  90° — matches D2's look. Pure `toSVG` (the points are already there).
- These are cosmetic; the structural routing stays ELK's. Do NOT build a new router here — escalate to
  task 115 (libavoid) if ELK's dense-region tangle needs fixing.

## Gotchas
- **Label measurement parity.** The width/height passed to ELK MUST equal what `toSVG` draws (font,
  size) or the reserved gap won't match → either too tight (overlap returns) or too loose (waste).
  Use `canvasMeasure` + the edge font size (`EDGE_FONT_SIZE`).
- **Hierarchy.** Edges live on their LCA container (`lcaContainer`, the intra-container fix) — the
  label offset must use the SAME node-origin offset `collectEdges` already applies, else labels
  re-strand at the origin (the bug that motivated that code).
- **`currentColor` + readability.** Keep the small label background plate (the spike drew a
  semi-opaque rect behind the text) so a label crossing a line stays legible on any theme — but make
  it theme-aware (not hard `#fff`; use the page bg / a translucent currentColor).
- **Determinism.** If B is used, ties must break deterministically (by edge index) so re-render/scroll
  doesn't reshuffle labels.
- **Compose with 119/120/121.** Label plate colour comes from the palette (119); routing polish must
  still work under sketch (120) and with effects (121).

## Tests (per AGENTS — unit + e2e + verify coverage)
- **Unit** (`elk-layout.test.ts`) — an edge with a label gets a `labels:[{width,height}]` on the ELK
  edge; the returned label x/y comes from ELK (not the raw midpoint); the layer gap widens vs the
  no-label case (space was reserved).
- **Unit** (`d2-render.test.ts`) — `toSVG` renders the label at the reserved position with a plate;
  rounded corners emitted for orthogonal bends.
- **e2e / real-VS-Code** — `big1_micro` renders with no label-on-box overlap (assert label boxes don't
  intersect node boxes) — measurable. (Harness D2 assertions are `fixme`; live proof in
  `test/vscode-e2e/`.)
- Bench artifact: before/after `big1_micro` (overlap count) like the spike comparisons.

## See also
- Skill `vmarkd-renderer-theming` (we own this renderer).
- **Task 104** (`toSVG` + `elk-layout.ts` — `collectEdges`, the `{id,sources,targets}` edge build at
  :144, the midpoint at :185), **119** (colour — label plate), **120/121** (compose), **115**
  (libavoid — the escalation for routing quality beyond ELK), **113** (ELK findings: routing parity
  with D2, the 5 exposed flags).
- Reference: ELK `edgeLabels.placement` / label dummy nodes; the spike label scorer in
  `tmp/compare/compare.mjs` (`renderOurs`).
