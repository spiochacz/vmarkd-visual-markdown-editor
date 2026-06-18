# Task 117 — Option E: HOLA / libdialect human-like orthogonal layout (WASM, no JS port)

**Status:** planned (research / long-shot — the most TALA-like single algorithm, but unported)

## Context

Part of the TALA-alternative layout cluster (**113 A** ELK-full, **114 B** cola.js,
**115 C** cola+libavoid, **116 D** OGDF→WASM, **117 E** this). See **task 113** for the
shared rationale. E surfaced from auditing **Adaptagrams**
(`github.com/mjwybrow/adaptagrams`, the C++ home of libavoid + libcola): of its six
libraries, **`libdialect` (HOLA — "Human-like Orthogonal Layout")** is the one with **no
JS port** and arguably the **closest single algorithm to TALA's aesthetic**.

## The Adaptagrams family (so the cluster's lineage is on record)

| Adaptagrams C++ | Role | JS equivalent | Where in our cluster |
|---|---|---|---|
| `libvpsc` | separation-constraint QP solver | bundled in cola.js | inside B (114) |
| `libcola` | constraint layout (stress-majorization) | **WebCola / cola.js** (MIT reimpl) | **B (114)** |
| `libproject` | gradient-projection solver | inside cola.js | inside B |
| `libavoid` | object-avoiding orthogonal routing | **libavoid-js** (LGPL WASM port) | **C (115)** routing |
| `libtopology` | topology-preserving layout | partial in cola.js, no standalone JS | could refine C |
| **`libdialect` (HOLA)** | **human-like orthogonal network layout** | **none** | **E (this task)** |

Official Adaptagrams bindings exist only for **Java + Python (SWIG)** — no official JS;
the JS ecosystem relies on the third-party WebCola (B) + libavoid-js (C).

## Why E (and why it's a long-shot)

- **HOLA** produces compact, **orthogonal, "hand-drawn-looking"** layouts — academically the
  nearest thing to TALA's look in a single algorithm (orthogonal ordering + planarization +
  routing, tuned for human readability). Could beat the layered (A) and force-directed (B)
  approaches on exactly the axis we care about.
- **But there is no JS/WASM port.** Unlike B (ready MIT lib) and C (ready LGPL WASM), E
  means **building an Emscripten/WASM port of `libdialect` ourselves** (it depends on the
  rest of Adaptagrams: libcola/libvpsc/libavoid/libtopology). That puts its **cost closer
  to D (OGDF→WASM)** than to B/C — a C++→WASM build pipeline we don't currently have.

## License

- `libdialect` (all of Adaptagrams' C++) is **LGPL-2.1-or-later** — **same family as
  libavoid (task 115)**. A standalone runtime-loaded `.wasm` → **LGPL §6b shippable** under
  the same conditions proven for C: keep the wasm/glue separate (no inline), ship the
  LGPL-2.1 text + notice + source, don't forbid user modification. **Not a license blocker**
  — the blocker is the **build effort**, not the licence.

## Scope (if ever pursued — heavy spike)

1. Check first for an **existing community Emscripten/WASM build** of Adaptagrams/libdialect
   (an `adaptagrams.wasm` covering cola+vpsc+avoid+topology+dialect) before compiling
   anything ourselves — same "prefer prebuilt" rule as D (116).
2. If self-building is unavoidable: produce the `.wasm` **out-of-band** and vendor it like
   d2/lute (never compile C++ in `build.mjs` — toolchain stays plain Node + npm). This is
   the same Emscripten-toolchain exception flagged in task 116.
3. `layout-hola.ts` marshals `{nodes, edges, groups}` across the WASM boundary → HOLA
   orthogonal layout → positioned geometry + orthogonal edge routes → shared SVG drawer
   (built in 113/114) → theme-pair + live re-render.
4. Bench against TALA **and** the winner of A/B/C — E only earns shipping if its
   human-like orthogonal output is visibly closer to TALA than C.

## Decision gate (must pass before any build)

- A/B/C have run and **none reaches the look we want** on real diagrams.
- A **prebuilt Adaptagrams/libdialect WASM exists**, OR the one-time Emscripten build cost
  is explicitly accepted (shared cost with D — if we stand up a C++→WASM pipeline for one,
  it serves both).
- Layout quality is a genuine **product differentiator**.

If any gate fails → keep parked; ship the best of A/B/C.

## Out of scope

- Adding Emscripten/C++ to the default toolchain (vendor prebuilt; build out-of-band).
- Porting the rest of Adaptagrams as standalone JS (B/C already cover libcola/libavoid).

## Verification (if built)

- Unit: marshalling round-trips a graph; HOLA output is orthogonal (edges axis-aligned),
  nodes non-overlapping; deterministic for fixed input.
- e2e (harness, headless): renders; orthogonal human-like layout; bench beats C on the
  shared complex graph; theme palette applied.
- Bench artifact: E vs winner-of-(A/B/C) vs TALA — the ship/park decision.
- `tsc` + `biome` + vitest + Playwright green, `xvfb-run -a`. **Verify coverage.**
