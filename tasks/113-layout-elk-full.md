# Task 113 — Option A: ELK-full layout renderer (TALA-alternative, 80/20)

**Status:** planned (spike-first — the cheapest, highest-value of the TALA-alternative cluster)

## Proof-of-concept result (2026-06-18 — thesis validated)

Ran a throwaway spike: `elkjs@0.11.1` over a graph mirroring `complex.d2` (containers +
nested nodes), with the TALA-leaning option set (`layered` + `wrapping.strategy=MULTI_EDGE`
+ `aspectRatio=1.3` + `edgeRouting=ORTHOGONAL` + `nodePlacement=NETWORK_SIMPLEX`), rendered
to SVG and rasterized via Playwright chromium, side-by-side with the TALA render.

- **Compactness: confirmed.** ELK-full produced **829×843 (aspect 0.98 — square)** vs TALA
  ~820×730 (1.12); d2-dagre on the same graph was a ~1750px-wide strip. **The `wrapping` +
  `aspectRatio` levers d2 hides are exactly what buys the square — thesis holds, ~80% of
  TALA's compactness for free (EPL, no watermark).**
- **Gaps observed (neither is an ELK limit):** (1) plain rects — the spike's 5-minute SVG
  drawer had no shape glyphs; the real renderer reusing `d2-render.ts` closes this.
  (2) Orthogonal routing got **tangled in the dense top region** (Users/CDN/Gateway) — ELK
  routing is decent but messier than TALA there. **This empirically motivates Option C**
  (libavoid routing on top), confirming the cluster's escalation path.
- Artifacts: `/tmp/elk-demo/` (`layout.mjs`, `elk_a.png`, `compare.png`). Verdict: A is
  real and cheap; "layered DNA" is its ceiling, routing-polish is C's job.

## Context — the TALA-alternative cluster (113–116)

Came out of the d2/TALA layout-quality dig (TALA = Terrastruct's closed, watermarked-
without-licence 2D-packing engine; installed local-only at `~/projects/tala`). TALA's
look = **compact 2D packing _plus_ clean edge routing** — neither d2's bundled engines
(dagre/elk via only 5 flags) nor mermaid-dagre reach it. This cluster evaluates building
a layout we control:

- **A (this task, 113)** — drive **raw elkjs with its full option set** (wrapping /
  aspectRatio / orthogonal routing) that d2 deliberately doesn't expose. ~80% of TALA's
  compactness, EPL-licensed, zero watermark. **Recommended first.**
- **B (114)** — **cola.js / WebCoLa** constraint-based layout — closest _character_ to
  TALA (organic compact packing), weaker edge routing.
- **C (115)** — **composition**: cola/stress placement + **libavoid-js** orthogonal
  routing + compaction. The realistic "build our own engine" 70/30.
- **D (116)** — **OGDF→WASM** — academic, strongest, heaviest. Likely overkill/park.
- **E (117)** — **HOLA / libdialect→WASM** — human-like orthogonal layout, the most
  TALA-like single algorithm, but **unported** (build cost ≈ D). Research/long-shot.

Do A first; only escalate to B/C if A's "layered DNA" isn't organic enough; D/E are
long-shots. **B, C and E are the Adaptagrams family in JS**: cola.js (B) = MIT reimpl of
libcola+libvpsc; libavoid-js (C) = LGPL WASM port of libavoid; HOLA (E) = libdialect,
unported. See each task's head for the shared rationale + the family map in task 117.

## Why A

d2's ELK integration exposes only `--elk-algorithm/-padding/-nodeNodeBetweenLayers/
-edgeNodeBetweenLayers/-nodeSelfLoop` and **rejects everything else** (`--elk-aspectRatio`
→ `unknown flag`, verified). The levers that actually buy TALA-like compactness live in
elkjs and are unreachable through d2:

- `elk.layered.wrapping.strategy` (SINGLE_EDGE / MULTI_EDGE) + `…wrapping.correctionFactor`
  — **wraps a wide layered graph into multiple bands → square** instead of a long strip.
- `elk.aspectRatio` — target proportions.
- `elk.edgeRouting=ORTHOGONAL`, `elk.layered.crossingMinimization.strategy`,
  `elk.layered.nodePlacement.strategy=NETWORK_SIMPLEX`, `elk.layered.compaction.*`.

So Option A = **call elkjs ourselves with the good options + render the result to SVG**,
bypassing d2's crippled passthrough.

## Open decision — what's the input / consumer? (resolve in spike)

This is the crux for the whole cluster. Candidates:
1. **A new fenced renderer** (e.g. ` ```graph `/` ```elk `) with a small declarative
   node/edge syntax we own → layout via elkjs → SVG. Self-contained, no dependency on
   d2/mermaid layout. Cleanest, but a new authoring syntax to design.
2. **A layout backend for mermaid graphs** — overlaps task 112 (which already wires the
   official `@mermaid-js/layout-elk`); A would only make sense here if we want options
   mermaid's integration doesn't expose. Probably _defer to 112_ for mermaid.
3. **Re-layout d2 graphs** — parse d2, lay out with elkjs-full, render with our own
   shape drawer (we already have `d2-render.ts` geometry from task 104). Most ambitious;
   effectively forking d2's renderer off its layout.

Recommendation: spike option **1** (new minimal fence) as the contained proving ground;
revisit 2/3 once the elkjs-full pipeline + SVG renderer exist and are measured.

## Scope / plan (spike)

1. Vendor **elkjs** (`media-src/vendor/elk`, sha pin + EPL licence + `?v=`), same pattern
   as mermaid/echarts vendoring (`build.mjs syncMermaid()` model).
2. A `layout-elk.ts` that takes `{nodes, edges, containers}` → calls `ELK.layout(graph,
   {layoutOptions})` with the full TALA-leaning option set above → returns positioned
   geometry.
3. An SVG drawer for the positioned graph (reuse shape geometry from `d2-render.ts` where
   possible: rect/cylinder/hexagon/sql_table/class/person/cloud/queue). Orthogonal edge
   paths from ELK's edge `sections`.
4. Theme-pair it like the other renderers (currentColor / content-theme palette;
   `vmarkd-renderer-theming` skill) + live re-render on theme flip.
5. Bench against TALA on the same `~/projects/tala/.../complex.d2` graph: aspect ratio,
   edge crossings, bounding-box area, render time — quantify the remaining gap.

## License analysis (gate — clear before vendoring)

**Must analyse whether we may actually ship this** before any vendoring work:

- **elkjs** is **EPL-2.0** (Eclipse Public License) — weak/file-level copyleft. Confirm:
  (a) bundling the unmodified vendored artifact into a VS Code extension is fine (it is for
  EPL, but verify we ship the licence + don't trip the "modified files must be disclosed"
  clause — we vendor unmodified, like d2/lute), (b) EPL-2.0 is compatible with our
  distribution + the rest of the bundle (our existing vendors: mermaid MIT, echarts
  Apache-2.0, **d2 MPL-2.0** — so weak-copyleft is already precedent), (c) Marketplace /
  Open VSX distribution terms are satisfied.
- Record the verdict (OK / OK-with-conditions / blocked) in this task **before** writing
  `syncElk()`. If blocked → this whole option falls back to mermaid's official
  `@mermaid-js/layout-elk` path (task 112) or to options B/C.

## Out of scope

- Replicating TALA's _container packing_ finesse (that's options B/C/D territory).
- A full authoring language (keep the spike syntax minimal — prove layout, not syntax).

## Verification

- Unit: `layout-elk.ts` returns non-overlapping positioned nodes; wrapping option visibly
  changes aspect ratio on a wide graph; edges carry orthogonal sections.
- e2e (harness, headless): the fence renders an SVG; an aspectRatio/wrapping toggle
  produces a measurably squarer bbox than plain layered; theme palette applied.
- Bench artifact: a short table (elkjs-full vs TALA vs d2-dagre) on the shared complex graph.
- `tsc` + `biome` + vitest + Playwright green, `xvfb-run -a`. **Verify coverage** (AGENTS.md).
