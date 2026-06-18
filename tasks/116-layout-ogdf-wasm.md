# Task 116 — Option D: OGDF → WASM layout (academic, strongest, heaviest — likely park)

**Status:** planned (long-shot / likely park — only if layout quality becomes a product differentiator)

## Context

Part of the TALA-alternative cluster (**113 A** ELK-full, **114 B** cola, **115 C**
cola+libavoid, **116 D** this). See **task 113** for the shared rationale. D is the
"maximum quality, maximum cost" end: **OGDF** (Open Graph Drawing Framework, C++) compiled
to WASM. Captured for completeness — **realistically parked** unless A/B/C all fall short
*and* layout becomes a headline feature worth a heavy build.

## Why D (and why probably not)

**OGDF** is the most powerful open graph-drawing library: planarization, orthogonal
drawing (Mixed-Model, Kandinsky), energy-based layouts (FMMM/stress), upward planar, etc.
Quality-wise it can **match or beat TALA** on many graphs. But:

- **C++ → WASM**: an Emscripten toolchain in our build (we currently vendor _prebuilt_
  WASM — d2, lute — and never compile C++ ourselves). New, heavy build surface.
- **Artifact size**: large WASM; lazy-load mandatory, and still the biggest renderer asset.
- **API/marshalling**: graph in/out across the WASM boundary is more work than elkjs/cola's
  plain-JS APIs.
- **Maintenance**: a C++/Emscripten pipeline is a long-term cost vs the plain-JS options.

For ~95% of diagrams, **A or C would be visually indistinguishable from TALA to a user**,
without OGDF's build burden. So D earns a task only as the documented "if we ever truly
need it" escalation.

## Scope (if ever pursued — spike-only)

1. Evaluate a **prebuilt** OGDF→WASM (if a usable community build exists) before
   considering compiling ourselves — avoid adding Emscripten to the toolchain
   (toolchain memory: plain Node + npm, no niche tooling — adding a C++ compiler is a
   deliberate, heavy exception that needs justification).
2. If self-compiling is unavoidable: isolate it as a vendored-artifact build step
   (produce the `.wasm` out-of-band, vendor it like d2/lute — never compile in the main
   `build.mjs`).
3. `layout-ogdf.ts` marshals `{nodes, edges, groups}` across the WASM boundary → positioned
   geometry + (orthogonal) edge paths → shared SVG drawer (from 113/114) → theme-pair.
4. Bench against TALA **and** against the winner of A/B/C — only worth shipping if it
   clearly beats them by enough to justify the build cost.

## License analysis (gate — likely the BLOCKER for this option)

**Analyse the licence first — it may rule D out before any build is even considered:**

- **OGDF** is **GPL** (v2/v3) — **strong copyleft**. Bundling GPL code into our distributed
  extension would risk forcing the **whole extension** to GPL, which is incompatible with
  our permissive/MIT-ish posture and the rest of the bundle (mermaid MIT, echarts
  Apache-2.0, d2 MPL-2.0). This is a **hard** concern, not a formality.
- Resolve explicitly: (a) is the exact OGDF licence GPL with no linking exception?
  (b) does compiling to WASM + bundling constitute a derivative/combined work that triggers
  GPL on our code? (c) is there a commercially/permissively-licensed OGDF option, or a
  non-GPL equivalent (the project also offers paid licensing — investigate)?
- **If GPL applies to our distribution → D is BLOCKED.** Record the verdict here. Do not
  prototype against OGDF until the licence is cleared — prefer the winner of A/B/C.

## Decision gate (must pass before any build)

- A/B/C have run and the **best of them still leaves a quality gap** that users actually
  notice on real diagrams.
- Layout quality is a **product differentiator**, not a nice-to-have.
- A **prebuilt** WASM exists, or the one-time compile cost is explicitly accepted.

If any gate fails → keep parked; ship the best of A/B/C instead.

## Out of scope

- Adding Emscripten/C++ to the default toolchain (explicitly avoided — vendor prebuilt).
- Everything until the decision gate passes.

## Verification (if built)

- Unit: marshalling round-trips a graph; output nodes non-overlapping; edges have bends.
- e2e (harness, headless): renders; quality bench beats A/B/C on the shared complex graph.
- Bench artifact: D vs winner-of-(A/B/C) vs TALA — the ship/park decision.
- `tsc` + `biome` + vitest + Playwright green, `xvfb-run -a`. **Verify coverage.**
