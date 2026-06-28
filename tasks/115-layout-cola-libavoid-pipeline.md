# Task 115 — Option C: composed layout pipeline (placement + libavoid-js routing + compaction)

**Status:** ❌ CHECKED & REJECTED (2026-06-28, user). The composed cola + libavoid-js routing pipeline
(C — the "build our own engine" option) was evaluated and dropped. (libavoid-js itself proved workable
in spike, but the overall own-engine direction wasn't worth it.) Rejected together with **114 (B: cola)**
and **117 (E: HOLA)**. The rest of this file is historical rationale.

## Context

Part of the TALA-alternative cluster (**113 A** ELK-full, **114 B** cola, **115 C** this,
**116 D** OGDF→WASM). See **task 113** for the shared rationale. This is the most
TALA-like _composed_ approach: don't write a layout engine from scratch — **glue the best
open pieces into the same pipeline TALA conceptually runs** (placement → overlap-removal →
edge routing → compaction). Pursue only after A (113) and B (114) have run and shown a gap
worth closing.

## The pipeline (what a layout engine actually is)

1. **Cluster/coarsen** containers into super-nodes (recursive per hierarchy).
2. **Coarse placement** — compact 2D arrangement minimizing edge length: **cola.js**
   (task 114) stress majorization, or ELK stress. No layer bias → square.
3. **Overlap removal** — VPSC separation constraints (built into cola).
4. **Edge routing** — **libavoid-js** (WASM port of Adaptagrams `libavoid`): orthogonal /
   poly-line connector routing with crossing & nudging — **this is the piece that gives
   the clean "TALA edges"** that cola/A lack.
5. **Compaction** — push everything together minimizing area subject to non-overlap
   (cola constraints, or an ELK compaction pass).
6. **Aspect-ratio targeting** — bias the objective toward a square bbox.

The novelty isn't any one stage (all solved in the literature) — it's **wiring + tuning**
them, which is exactly TALA's expensive 10–20%.

## Adaptagrams lineage (verified 2026-06-18)

C glues the two **Adaptagrams** pieces that matter, in their JS forms:
**cola.js** = JS reimplementation of `libcola`+`libvpsc`+`libproject` (MIT — task 114) for
placement, and **`libavoid-js`** = actual WASM **port** of Adaptagrams' `libavoid` (LGPL)
for routing. Two more Adaptagrams libs are adjacent: **`libtopology`** (topology-preserving
layout — keeps edge routes' topology stable during placement; only partially present in
cola.js, no standalone JS) could **further sharpen the routing/placement interplay** if we
ever need it; **`libdialect`/HOLA** (human-like orthogonal layout, unported) is its own
avenue → **task 117**. Adaptagrams' own bindings are Java/Python (SWIG) only — no official JS.

## Why C over A/B alone

- **A (ELK-full)** gets compact-ish but keeps layered DNA.
- **B (cola)** gets organic compact packing but routes edges poorly.
- **C = B's placement + libavoid's routing + a compaction pass** → organic packing **and**
  clean orthogonal edges = the closest open-source approximation of TALA.

## Scope / plan (spike — biggest of the cluster)

1. Reuse `layout-cola.ts` (task 114) for placement (or ELK stress as an alternative source).
2. Vendor **libavoid-js** (`media-src/vendor/libavoid`, WASM — fits our existing WASM
   vendoring like d2/lute: sha pin + LGPL/Adaptagrams licence + `?v=`). Feed it the placed
   node rects + edge endpoints → get routed orthogonal connector paths.
3. A `layout-pipeline.ts` orchestrating place → route → compact, returning final geometry
   + routed edge paths.
4. Shared SVG drawer (built in 113/114) renders nodes + the libavoid poly-line/orthogonal
   edges. Theme-pair + live re-render.
5. Bench against TALA on the shared complex graph — this is the candidate that should get
   _closest_; quantify crossings/area/aspect/time and the residual gap.

## Risks / open questions

- **Licence**: resolved — see "License analysis" below. LGPL-2.1 via the §6b shared-lib
  path is shippable **iff** the wasm/glue stay separate (no inline). Not a blocker.
- **Determinism**: cola placement must be seeded (task 114); libavoid routing is
  deterministic given fixed input — verify end-to-end reproducibility.
- **Size**: libavoid WASM + cola — measure; lazy-load (zero-cost unless a graph uses this
  renderer), same gate as elkjs/d2.
- **Effort**: this is genuinely an engine. Time-box the spike; the deliverable is a
  go/no-go bench vs A, not a finished renderer.

## License analysis — VERDICT: ✅ shippable with conditions (researched 2026-06-18, not a blocker)

Deep-checked at source (npm + Aksem/libavoid-js GitHub + GNU LGPL-2.1 §6). Findings:

- **cola.js** — MIT (cleared in task 114).
- **`libavoid-js`** — **LGPL-2.1-or-later**, the *whole* package: both the C++/WASM core
  **and** the JS glue (WebIDL bindings) are LGPL. There is **no permissive wrapper** to
  lean on — the glue is LGPL too.
- **It ships as a separate `dist/libavoid.wasm` + `.js` glue, fetched at runtime** (not
  inlined/base64). This is the decisive fact.

**WASM ↔ LGPL §6 mapping.** A separate runtime-loaded `.wasm` is the **shared-library
analogy → LGPL §6b** (the light path): the app must "operate properly with a modified
version" the user installs. A user can swap our shipped `libavoid.wasm` for their own
rebuilt-from-modified-source one and the extension keeps working; the `.vsix` is a zip, so
relink = drop-in file replace. We hit §6b, **not** the heavy §6a (static/object-files)
path — *provided we don't inline*.

**Conditions (all easy; mostly build-config discipline we already follow):**
1. **Never inline** the wasm or the glue `.js` into `main.js` (no base64/minify-together).
   Keep them as separate vendored artifacts loaded at runtime — exactly like `d2.wasm`,
   `lute.min.js`, `mermaid.min.js`. Inlining would drop us into the heavy §6a path.
2. Ship the **full LGPL-2.1 text** + a **prominent notice** that `libavoid-js` (LGPL-2.1)
   is used (NOTICE / THIRD-PARTY-LICENSES + the Marketplace readme).
3. Provide **source** for the exact vendored version (pin commit/version; link or written
   offer — it's public on GitHub/npm).
4. Ensure our terms/EULA **don't forbid** user modification + reverse-engineering of the
   library portion for their own debugging (LGPL §6 requires permitting this).
5. Document the trivial relink path (replace `libavoid.wasm` in the unpacked `.vsix`).

**Non-issues (confirmed):** LGPL does **not** infect our code (weak/file-level copyleft —
covers only the library files; the extension stays on our MIT-ish licence); Marketplace /
Open VSX place no bar on LGPL components.

**Bottom line:** Option C is **not** license-blocked. The only real constraint is the
no-inline build rule (already our posture). Earlier "riskiest / likely needs an
alternative" framing was overstated — keep C in play. (An MIT/Apache/MPL orthogonal-router
alternative is still worth a glance as a fallback, but is not required.)

## Out of scope

- TALA's exact aesthetic / container-packing heuristics (the last ~10–20% — that's D/116
  or accepting "close enough").
- A new authoring language (shared minimal spike syntax with 113/114).

## Verification

- Unit: pipeline returns non-overlapping nodes + routed edges with bend points; seeded
  placement is reproducible; routing is stable for fixed input.
- e2e (harness, headless): the fence renders organic-packed nodes with orthogonal routed
  edges; fewer crossings than the A/B baselines on the shared graph; theme palette applied.
- Bench artifact: C vs A vs B vs TALA vs dagre (crossings/area/aspect/time) — the go/no-go.
- `tsc` + `biome` + vitest + Playwright green, `xvfb-run -a`. **Verify coverage.**
