# Task 118 — F: Semantic placement priors (distilled role-net) → constraint layout

**Status:** idea / research (spike-first, decision-gated) — proposed 2026-06-18

## Origin

Came out of the d2/TALA layout-quality dig (cluster 113–117). After spiking ELK, Graphviz,
cola, libavoid and HOLA, the recurring finding: **every geometric engine is semantically
blind.** They optimise crossings / compactness / orthogonality but don't know that `Users` is
an actor (top), `Postgres`/`Redis` a datastore (bottom), `API Gateway` an ingress hub
(upper-middle). That's why even clean layouts often "aren't how a human would draw it." This
task is the missing **semantic** layer that feeds priors into the engine.

User framing: a small NN — trained to distil an LLM's reasoning about *where* blocks belong
(databases, inputs, gateways…) — suggests placements; those suggestions go into a placement +
routing engine that draws the final edges.

## Reframed architecture (the load-bearing decision)

Predicting absolute `(x,y)` from a net is fragile (small graph change → big relayout → "uncanny"
instability). Decompose into layers, each independently testable:

```
label → ROLE  →  role → CONSTRAINTS (rules)  →  geometric engine  →  routing
```

1. **Learned piece = `label → role`** — a SMALL, closed role set (actor / ingress-edge /
   gateway / service / datastore / queue / cache / aggregate-model / frontend / external).
   Highly learnable: classifier over the label embedding, or even cosine-to-role-prototypes
   (maybe no training at all for v0). **This** is what distils from the LLM.
2. **`role → constraints` = RULES, not a net** — datastore→bottom rank, actor→top, ingress→top,
   gateway→upper hub, queue/cache→side. Deterministic, debuggable, editable.
3. **constraints → geometry = an existing engine that accepts hints.** **cola is purpose-built**
   for this (native `alignment` / `separation` / groups — see task 114). Graphviz has
   `rank`/`rankdir`/clusters; ELK has `partitioning`/`layerConstraint`. The "engine that takes
   suggestions" already exists.
4. **routing = libavoid / engine** (task 115 / the chosen backend).

**Why distil to a small net instead of calling the LLM live:** vMarkd is offline-first; a live
LLM call per render = latency / cost / online dependency. A tiny distilled role classifier runs
locally in ms, offline — that's its real justification (fits the extension's offline ethos),
not "ML for its own sake."

## Hard parts (be honest — the model is the easy bit)

- **Training signal / evaluation is the hard problem, not the net.** "Good layout" is
  subjective. `graph → role` labels the LLM generates cheaply; but `graph → GOOD positions`
  needs a judge (LLM-as-judge or human preference pairs). Stand up evaluation before training.
- **Stability:** constraints must be SOFT (preferences), or hard zones fight connectivity and
  look worse than no priors.
- **Generalisation:** roles are domain-specific (software architecture ≠ biology pathway). Scope
  the role set to a domain; detect/abstain out-of-domain.
- **Determinism:** same input → same layout (seed everything; cache role assignments).

## Minimal experiment (run FIRST, no training)

Backend already exists in `tmp/` from the cluster spikes. Cheapest proof:

1. Label node roles on `complex.d2` with **rules/keywords or a one-off LLM pass** (no net yet).
2. `role → cola constraints`: datastore → shared bottom rank (alignment-y + separation), actor →
   top, gateway → hub.
3. Run through **cola + GridRouter** (task 114/115 spike) and compare against the prior-free
   layout. Does it visibly read "more human"?

If yes → distil the `label→role` classifier to drop the LLM from the hot path. If no → we saved
building a net. **Gate the net on this experiment showing a real lift.**

## Dependencies / relation to cluster

- Backend (steps 3–4) = whichever of 113–117 wins (currently leaning **Graphviz→toSVG** [free,
  clusters, ortho] or **cola+libavoid** [115, compact]). 118 is the semantic layer ON TOP, not a
  replacement.
- Reuses `d2-render.ts` `toSVG` for drawing + the compiled D2 graph (shapes carry `shape`/
  `container` → cheap role features).

## Out of scope (v0)

- Predicting absolute coordinates with the net (use roles→constraints, not regression).
- A general cross-domain role ontology (scope to software-architecture roles first).
- Bundling a heavy ML runtime — if a net ships, it must be tiny (≤ a few hundred KB, e.g. a small
  MLP over a frozen label embedding, or pure prototype-cosine) and offline.

## Verification

- Bench: prior-free vs role-prior layout on the shared complex graph(s) — LLM-as-judge or a small
  human-preference set; report the lift (or lack of it).
- If a net ships: determinism test (same graph → same roles), offline (no network), size budget,
  and the layout regression nets from the chosen backend still pass. `xvfb-run -a`.
