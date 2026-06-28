# Task 176 — Coalesce the #app observer fleet behind one shared dispatcher (two-phase)

**Status:** TODO (big / L — **instrument actual ms first**; land tasks 173 + 174 before the full rewrite).
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟨 medium (removes N-fold dispatch redundancy; one ordering authority) / 🟡 medium-high (large refactor across the observer registry; must preserve the sync-vs-rAF split + disposers).
**Engines:** none (observer infrastructure).

## Problem

`finish-init.ts:80-160` installs **~10 independent `MutationObserver`s** on `#app` via separate
`observers.set()` calls, each re-walking the document:
- **3 synchronous, before-paint** (no-flash): `code-source.ts:71`, `callouts.ts:394`,
  `html-comment.ts:96` (each ignores records, full `querySelectorAll`);
- **7 rAF-coalesced**, each with its own `MutationObserver` + rAF + full `querySelectorAll`:
  `smiles-render.ts:112`, `custom-diagrams.ts:873`, `diagram-zoom.ts:211`, `abc-fit.ts:55`,
  `echarts-retheme.ts:101`, `gap-paragraph.ts:214`, `wysiwyg-code-highlight.ts:289`.

So every keystroke fans out to ~10 observer callbacks, each doing its own full-document tree walk.

## Plan

One shared `MutationObserver` that batches records and runs **two phases**:
- **(a) a SYNC before-paint phase** for the no-flash trio (subtree-scoped per task 173);
- **(b) a single rAF phase** running the heavy fleet once with a shared scheduling budget.

This removes the N-fold dispatch redundancy, gives one ordering authority, and is the natural home for
task 174's ignore-decoration filter.

## Constraints
- **Preserve the sync-vs-rAF split:** the 3 no-flash decorators MUST stay synchronous before paint or
  the raw `[!TYPE]` marker / un-coloured source flash returns (`code-source.ts:14-16`,
  `callouts.ts:383-388`).
- **Ordering dependency:** `code-source` `.hljs` tagging must precede `wysiwyg-code-highlight`.
- Preserve each observer's **disposer semantics** in the `observers.set()` registry (task 152
  Disposables).
- Coalescing **cannot literally share one `querySelectorAll`** (observers query disjoint selectors) —
  the per-observer tree walks remain; only the `MutationObserver` **dispatch** + rAF **scheduling**
  consolidate.
- Pure main-thread DOM scheduling — does **not** touch `SpinVditorIRDOM`, so no Worker/GopherJS/CSP/
  round-trip/caret/cross-block-structure risk.

## Verification
- **Instrument FIRST:** `performance.now()` around the sync trio vs the spin vs the rAF group on a
  diagram-heavy doc — confirm the observer fleet is worth an L refactor before committing (the spin
  likely still dominates).
- **Real-VS-Code e2e (MANDATORY):** the full no-flash suite (callout / comment / code-source) green;
  ordering dep (code-source before highlight) preserved; every renderer observer still fires.
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- **Sequencing:** land task 173 (scope sync observers) + task 174 (ignore decoration mutations) FIRST
  — they capture the cheap high-leverage wins; this full dispatcher rewrite is the structural
  consolidation on top. De-rated to medium: it leaves the dominant Lute spin untouched and the 7 rAF
  observers are already off the input→paint critical path.
- `finish-init.ts` (the registry), all observer files listed above; task 152 (Disposables), memory
  `callouts-observe-app-mount`.
