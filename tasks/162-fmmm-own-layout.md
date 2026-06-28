# Task 162 — Own FM³/FMMM organic layout engine (clean-room, no deps)

> **Status:** 🅿️ **PARKED (2026-06-28, user) — SPIKE DONE / PoC validated; productionization not
> pursued for now.** The whole TALA-alternative cluster is now resolved+parked (113 adopted; 114/115/117
> rejected; 116 OGDF parked; 163 TSM parked). Revive only if layout quality becomes a headline feature.
> A clean-room
> FM³/FMMM force layout in pure JS produces compact, organic layouts on connected relationship graphs
> (the `complex.d2` archetype). Spike code (throwaway): `tmp/fmmm-spike/{fmmm,spike,d2graphs}.mjs` —
> NOT committed (tmp/ is gitignored), so the algorithm + findings are captured below for reproduction.
> **Source:** the layout-engine R&D cluster (113–118); user picked FMMM (the OGDF flagship) to spike.
> **Value / Risk:** 🟢 organic/compact layout we fully own, **zero deps, zero GPL, zero WASM** / medium —
> the core is proven; the remaining risk is the production "wrapper" (node sizes, containers, routing).

## Why this exists — the clean-room unlock (from task 116)

Task 116 (OGDF→WASM) is blocked: OGDF is **GPL** (would infect the whole extension) and needs a
**C++→WASM** toolchain we don't have. **Key insight: algorithms are not copyrightable — only OGDF's
*code* is GPL.** A clean-room TS implementation of the *published* FM³ algorithm (Hachul & Jünger,
"Drawing Large Graphs with a Potential-Field-Based Multilevel Algorithm") is unencumbered → sidesteps
**both** the GPL blocker and the WASM weight. This is the option that survived the cluster cull:
113 (ELK-full standalone) dropped, 114/115/117 (cola / cola+libavoid / HOLA) rejected — all depend on
external libs; **162 depends on nothing.**

It also fills a real gap: ELK-layered (adopted into `elk-layout.ts`, task 113) covers *hierarchical*
graphs; FMMM covers *organic/compact* relationship graphs (microservices, dependency nets) where a
layered strip looks wrong.

## What the spike implemented (clean-room FM³, ~250 lines pure JS)

Pipeline — **multilevel coarsening → Barnes-Hut n-body repulsion → edge attraction → FR cooling**,
deterministic (seeded mulberry32 PRNG, no `Math.random`):

1. **Coarsening:** heavy-edge matching — pair each unmatched node with an unmatched neighbour, merge
   to supernodes, dedup coarse edges; repeat until ≤ 8 nodes. Builds a level hierarchy (coarsest first).
2. **Coarsest placement:** nodes on a deterministic circle.
3. **Per-level force pass** (`layoutLevel`), FR-style spring-electrical:
   - ideal edge length `k` (px); repulsion `F_r = k²·mass / d²` via **Barnes-Hut quadtree** (θ=0.9) →
     O(n log n); attraction along edges `F_a = d² / k`; displacement capped by a **cooling**
     temperature (`temp *= 0.95`/iter, ~60+10·level iters).
4. **Prolongation:** each finer node inherits its supernode's position + small seeded jitter; refine.

(Used Barnes-Hut, not OGDF's true multipole — standard pragmatic approximation, visually equivalent.)

## Findings — metrics (560px viewport, seed 7)

**Synthetic graphs (point nodes):**

| graph | nodes/edges | aspect | crossings | time |
|---|---|---|---|---|
| mesh 6×6 | 36/60 | **0.98** | **0** | 6 ms |
| hub (star) | 23/29 | **0.99** | **0** | 7 ms |
| tree depth-5 | 63/62 | 1.46 | 2 | 18 ms |
| clusters (4×ring + hubs) | 24/28 | 0.74 | 4 | 17 ms |

Mesh recovered as a clean grid; hub a clean star; tree organic radial; all < 20 ms, deterministic.

**Real D2 graphs (compiled through our d2-WASM in a Node vm-context, boxes+labels rendered):**

| graph | nodes/edges | result |
|---|---|---|
| `fixture2` — microservices (user→cdn→web→gw→ordersvc→paysvc…, the `complex.d2` archetype) | 19/21 | ✅ **excellent** — readable, `gw` hub, branches spread, ~0 crossings, no overlap |
| `c4` — C4 architecture (container-heavy) | 17/20 | ❌ **poor** — boxes clump (point nodes, no overlap removal); isolated `title` node (no edges) flies to a corner |

## Verdict

- **Core force model + multilevel: PROVEN** for **connected relationship graphs** — beats ELK-layered
  on compactness/organic feel exactly where layered looks wrong. This is the target use case.
- **C4/container-heavy/disconnected graphs expose the missing wrapper, NOT an algorithm flaw.**

## Gaps to production (what the spike does NOT do)

1. **Node-size-aware repulsion + overlap removal** — spike treats nodes as points → boxes overlap
   (the c4 clump). Need size-scaled repulsion + a separation/overlap-removal pass (VPSC-style or a
   simple push-apart).
2. **Isolated / disconnected components** — a node with no edges (`title`) only feels repulsion → flies
   off. Need component packing + anchoring of singletons.
3. **Containers / nesting** — C4 boundaries unmodelled → FMMM-with-groups (constrained placement /
   recursive per-container layout).
4. **Edge routing** — straight lines only (clusters had 4 crossings). libavoid was rejected (115), so
   straight or a simple orthogonal router is acceptable; don't chase libavoid-grade routing.
5. **Integration** — spike uses a toy SVG drawer. Production reuses `media-src/src/d2-render.ts` shape
   geometry + content-theme palette (`vmarkd-renderer-theming` skill) + a **consumer**.
6. **Determinism:** already handled (seeded) — keep it (no `Math.random`).

## Open decision — the consumer (inherited from task 113, must resolve first)

Where does this layout get its input / render? Same fork as 113:
1. **New fenced renderer** (` ```graph `/` ```fmmm `) with a small declarative node/edge syntax we own —
   cleanest, self-contained, but a new authoring syntax.
2. **Re-layout d2 graphs** — compile d2 (we already do, `d2-wasm`), lay out with FMMM instead of
   dagre/ELK, render with `d2-render.ts`. Most reuse; effectively an alternate d2 layout engine
   (a `vmarkd.diagram.d2Layout: fmmm` option next to dagre/elk).
3. **mermaid backend** — out of scope (overlaps task 112).

**Recommendation: option 2** (FMMM as a third `d2Layout` engine) — maximal reuse (compile + drawer +
theming all exist), no new syntax, and it directly serves the "d2 organic layout" itch this came from.
Gate FMMM to graphs where it helps (relationship graphs); keep dagre/ELK for layered/sequence/grid.

## Plan (productionize)

1. Port `tmp/fmmm-spike/fmmm.mjs` → `media-src/src/fmmm-layout.ts` (typed; same algorithm).
2. Add: size-aware repulsion + overlap-removal pass; isolated-node/component packing.
3. (If consumer = option 2) wire as `d2Layout: fmmm`; feed `D2Graph` nodes (with width/height) + edges;
   render via `d2-render.ts`. Containers: start flat (ignore nesting) → add group constraints later.
4. Theme-pair (currentColor / palette) + live re-render, like the other diagram renderers.
5. **No vendoring, no license step** — it's our own code (the whole point vs 113–117).

## Tests (per AGENTS)

- **Unit** (`fmmm-layout.test.ts`): deterministic output for a seed; non-overlapping nodes after the
  overlap pass; mesh recovers ~square aspect; isolated node stays in-bounds.
- **e2e**: a relationship graph renders organically (bbox aspect closer to square than dagre's strip;
  crossings below dagre on the same graph); theme palette applied.
- **Bench artifact**: FMMM vs dagre vs ELK on the microservices + C4 graphs (aspect / crossings / area).

## See also

- Task **116** (OGDF — the GPL/WASM-blocked origin + the clean-room unlock), **113** (ELK options
  adopted into `elk-layout.ts`; standalone renderer dropped), **114/115/117** (cola/libavoid/HOLA —
  rejected), **118** (semantic placement priors — could sit on top of this backend), **104** (d2 WASM).
- `media-src/src/d2-render.ts` (shape geometry + drawer), `media-src/src/d2-wasm.ts` (compile),
  `media-src/src/elk-layout.ts` (the layered counterpart). Skill `vmarkd-renderer-theming`.
- Algorithm: Hachul & Jünger, FM³ (2004/2005); Barnes-Hut (1986); FR cooling (Fruchterman-Reingold 1991).
