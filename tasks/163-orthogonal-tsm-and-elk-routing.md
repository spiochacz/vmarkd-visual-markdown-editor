# Task 163 — Orthogonal TSM layout + ELK-placement / own-routing experiments

> **Status:** 🅿️ **PARKED (2026-06-28).** Spikes done, validated, findings captured below; **no
> production code written** (user decision: park). Spike code was throwaway under `tmp/tsm-spike/` +
> `tmp/elk-route/` (gitignored → gone), so everything needed to reproduce is recorded here.
> **Origin:** continuation of the layout-engine R&D cluster (113–118, 162). After the FMMM spike (162),
> user asked to spike **Orthogonal TSM**, then pivoted to **"ELK placement + our routing"**, then to
> **"can our routing be injected into ELK / can placement listen to routing"**. All parked.
> **Value / Risk:** 🟢 strong negative result — we now KNOW the boundaries (what ELK exposes, what a
> clean-room TSM costs, where the existing d2 refine pipeline already sits) / low (nothing shipped).

## TL;DR (the decisions)

1. **Full clean-room Orthogonal TSM works but is NOT worth productionizing.** Built all 4 Tamassia
   phases in pure JS; correct on simple/relationship graphs; but the two famously-hard parts
   (bend-minimal **embedding** = NP-hard; robust **compaction** = needs rectangularization) bite, and
   **ELK already routes orthogonally** → poor ROI vs ELK.
2. **"ELK placement + our routing" is viable and already partly shipping.** Our A* router gives **~½ the
   bends** of ELK's router, but **more crossings** (it loses ELK's port distribution). The repo ALREADY
   post-processes ELK with our A* (`d2-refine.ts` → `rerouteBackEdges` → `astar.ts`), surgically +
   crossing-guarded.
3. **You CANNOT inject a custom algorithm into elkjs** (GWT blob; runtime API is `layout()` + a few
   query methods only). Composition around ELK is the only path — which is what the d2 pipeline does.
4. **Placement↔routing feedback loop** (let routing suggest box moves) is feasible as an *outer loop*,
   not "inside ELK" — **parked** (mechanism undecided).

## Part A — Full Orthogonal TSM (Topology-Shape-Metrics, Tamassia 1987), clean-room

Same clean-room unlock as 162: algorithms aren't copyrightable → a TS reimplementation of the published
method sidesteps OGDF's GPL + the C++→WASM weight of 116. Built ~520 lines, all 4 phases:

1. **Topology** — force seed → planarize (geometric crossings → degree-4 dummy nodes) → **expand every
   degree>4 vertex into a box-cage** (a cycle of degree-≤4 vertices = the node's box with ports; classic
   Tamassia only handles deg≤4, and d2 hubs like `gw` are high-degree) → planar embedding (DCEL faces
   via the rotation system + face tracing). *Validated: Euler V−E+F=2 on every graph; maxDeg≤4 after
   expansion; components glued with throwaway edges; isolated nodes excluded.*
2. **Shape** — **real Tamassia min-cost flow** over the face network, cost = total bends:
   - excess (outflow−inflow): **vertex = +4**, **internal face = 4−2·deg(f)**, **outer face =
     −2·deg(f)−4** (Σ=0 ⇔ Euler; verified). Outer face = max signed area.
   - corner arcs (vertex→face, lower 1 / upper 4 / cost 0 = the 90° angle units, removed lower bound by
     pre-flow → reduced excesses v:4−deg, internal f:4−deg, outer f:−deg−4); bend arcs (face↔face per
     edge, cost 1) → min cost = min bends. Solved with SPFA successive-shortest-paths MCMF.
   - *Validated: feasible everywhere; angle units sum to 4 (360°) at every vertex; triangle=1 bend
     (optimal), square=0.*
3. **Metrics (compaction)** — propagate orthogonal headings (quarter-turns) from the orthogonal rep
   (corner turn = 2−angle_units; twin = +2; bend turns), refine bends into vertices → axis-aligned unit
   segments → union-find x/y line-classes → **per-axis longest-path** coordinate assignment.

**Results (full TSM):**

| graph | bends | crossings | aspect | note |
|---|---|---|---|---|
| square / triangle | 0 / 1 | 0 | 1.0 | **optimal** |
| mesh 6×6 | 16 | 0 | 1.0 | grid recovered; 16 **needless** bends = suboptimal embedding |
| microservices (`complex.d2`) | 5 | 1 | 1.14 | **excellent** — `gw`/`ordersvc` drawn as port-boxes |
| hub (deg-22) | 1 | 1 | 1.0 | cage works |
| tree d5 | 5 | 18 | 0.78 | readable but edges cross boxes (compaction has no lanes) |
| **c4** | — | — | — | ❌ **compaction cycle → collapse (gw=0)** |

**Why parked:** the pipeline is correct, but the spike hits TSM's two research-grade sub-problems —
exactly why OGDF's TSM is thousands of lines, not ~250 like FMMM:
- **Embedding selection** — bends depend ENTIRELY on the planar embedding, and the bend-minimal one is
  **NP-hard** (mesh's 16 bends = force-seed embedding ≠ optimal). OGDF uses SPQR-trees.
- **Compaction** — robust compaction needs **rectangularization + two compaction flows**; the spike's
  longest-path simplification overlaps elements (tree's 18 crossings) or cycles (c4 collapse).
- **ELK already does orthogonal routing** → a full clean-room TSM duplicates it. If we ever want an own
  engine, **FMMM** (organic, which ELK lacks — task 162) beats TSM (orthogonal, which ELK has).

## Part B — ELK placement + our own orthogonal router

Compile d2 → **ELK placement** (vendored `elk-main.js`, main-thread) → discard ELK's edge routes →
route with a clean-room **orthogonal connector router**: A* over an orthogonal visibility grid (box
boundaries + margin lanes), per-turn bend penalty, box-interior blocking, side-mid ports.

**ELK fixes exactly what broke FMMM/TSM:** hierarchy, isolated nodes (`title`), zero clumping, valid
non-overlapping placement. **c4 finally renders cleanly** with ELK boxes + our lines.

**Our routing vs ELK's routing (SAME ELK placement):**

| graph | bends ours / ELK | crossings ours / ELK |
|---|---|---|
| c4 | **21 / 42** | 1 / 1 |
| microservices | **17 / 26** | 4 / **0** |
| fixture0/5/6/7 | **~½ of ELK** | 0 / 0 |

**Finding:** our router gives **~2× fewer bends** (more direct), but **ELK has fewer crossings** because
it **distributes edges across different ports** on each box side; our router aims all edges at the
**side midpoint** → convergence + crossings. To beat ELK we'd need **port distribution + lane nudging**.

## Part C — Can we inject custom routing/placement INTO ELK?

**No (verified empirically against the vendored elkjs instance).** elkjs is a **GWT-compiled Java blob**;
its extensibility (`ILayoutPhase`/`ILayoutProcessor`) is **compile-time Java**, not runtime JS. The
instance exposes only: `layout`, `knownLayoutAlgorithms`, `knownLayoutOptions`, `knownLayoutCategories`,
`terminateWorker` — **no registration hook**. Available algorithms are the 11 built-ins (fixed, box,
random, layered, stress, mrtree, radial, force, sporeOverlap, sporeCompaction, rectpacking); routing is
the built-in `edgeRouting` ∈ {ORTHOGONAL, POLYLINE, SPLINES}.

Probed composition levers:
- `org.eclipse.elk.fixed` → returns our exact node positions **but does NOT route edges** (no sections).
- `interactive: true` + per-node `position` → **biases** layered placement (respects relative order, but
  re-spaces; not a pixel nudge).
- `org.eclipse.elk.bendPoints` property exists but `fixed` drops sections → worse than post-processing.

**Conclusion:** you don't inject — you **compose around ELK**. And the d2 pipeline **already does**:
`elk-layout.ts:560` → `refineLayout()` (`d2-refine.ts`, 14 passes) → `rerouteBackEdges` uses our A*
(`astar.ts`, Hanan-grid) to re-route **back-edges only**, **preserving ELK port stubs**, accepting a
reroute **only if it doesn't increase crossings**. The spike's wholesale re-route confirmed WHY this is
surgical: dropping all ELK routes loses the port distribution → more crossings.

**Productive (un-built) extension surfaced by the spike:** a crossing-guarded **"debend" pass** in
`refineLayout` — A*-reroute ANY edge if it *reduces bends* and *doesn't increase crossings* (reuse
`astar.ts`, keep ELK port stubs). The spike showed ELK carries ~2× the minimal bends → real headroom.

## Part D — Placement listens to routing (feedback loop) — PARKED, mechanism undecided

Idea: not one-directional (ELK places → route) but a loop — route, measure, **move a box if it improves
the drawing**, reroute, keep if better. "Inside ELK" is impossible (Part C); realizable as an **outer
loop**. Objective is **already computed** by our pipeline (`countCrossings()`, `collinearOverlapCount()`
in `d2-refine.ts`; bend count trivial). Mechanism fork (left undecided when parked):
- **A "ELK moves":** turn routing cost into ELK constraints (positionId / layer / model order) → ELK
  re-layout → reroute → keep if better. Truest to "suggest ELK"; ELK guarantees legality; but **coarse**
  (order/layer, not pixels) and a **full re-layout per iteration** (reshuffles, slow).
- **B "we nudge":** a `refineLayout` pass that shifts a box by pixels along grid lanes → reroute only
  affected edges → keep if cost drops. Pixel-precise, fast, fits the existing pipeline; but **we** own
  overlap/spacing guards.
- **C hybrid:** big moves via A, fine-tune via B.
- Recommended-if-revived: **B** (fastest to validate "moving boxes helps", full control, reuses our cost).

## Recommendation

- **Keep ELK placement + the existing surgical, crossing-guarded refine** (`d2-refine.ts` / `astar.ts`).
- If layout quality is ever revisited, the cheapest win is the **crossing-guarded "debend" pass**
  (Part C) — one pass, reuse `astar.ts`, no fork, low risk. Spike-validate in `tmp/` first.
- **Do NOT** build a full clean-room TSM (Part A) — NP-hard embedding + research-grade compaction, and
  ELK already routes orthogonally.
- Placement↔routing feedback loop (Part D): parked until there's a concrete quality complaint.

## See also

- Tasks **162** (FMMM — the organic counterpart; better own-engine bet than TSM), **113** (ELK options
  adopted into `elk-layout.ts`), **114/115/117** (cola/libavoid/HOLA — rejected), **116** (OGDF/GPL —
  the clean-room origin), **118** (semantic placement priors), **104** (d2 WASM), **122/123** (the
  back-edge A* reroute + refine pipeline this builds on).
- Code: `media-src/src/elk-layout.ts` (ELK call + `refineLayout` at :560), `media-src/src/d2-refine.ts`
  (the 14-pass post-process, `rerouteBackEdges`, `countCrossings`), `media-src/src/astar.ts` (the
  Hanan-grid A* router), `media-src/src/d2-render.ts` (engine-neutral `Layout` + `toSVG`).
- Algorithms: Tamassia, "On embedding a graph in the grid with the minimum number of bends" (1987);
  Batini-Nardelli-Tamassia (TSM); ELK/elkjs (Eclipse Layout Kernel, GWT).
