# Task 174 — Break the cross-observer wakeup amplification from injected decorations

**Status:** TODO (medium; small safe constant-factor cleanup — best landed on the task-176 dispatcher).
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟦 low–medium (cuts the per-keystroke observer-fire multiplier, esp. during diagram-source editing) / 🟢 low (pure observer scheduling; idempotent guards already make re-passes no-ops).
**Engines:** none (observer scheduling).

## Problem

Every observer that **injects DOM** — callout preview, comment span, hljs token spans, the
`edit-activity` keep-last overlay (`data-render="1"`, `edit-activity.ts:189`), smiles/custom SVG —
emits a `childList` record that **re-wakes ALL `#app` observers** on the next microtask/frame. The
three IR-decoration observers (task 173) run **synchronously before paint**, so a decoration write
re-wakes them in a fresh microtask, each re-walking the whole `#app` again. Idempotent guards make
each a no-op, but the **wakeup + full `querySelectorAll` re-walk still costs** — a second (and third)
synchronous fleet pass per keystroke. The primary bite is during **diagram-source editing**, where
`restoreOverlay` injects the keep-last overlay on top of the spin.

All injected nodes are **already tagged** for an all-ours test: `data-render="1"` overlay
(`edit-activity.ts:189`), `.hljs` (`code-source.ts:58`), callout wrappers / `.vditor-ir__preview`,
comment signature spans.

## Plan

Have the shared dispatcher (task 176) — or, if shipped standalone, each observer's schedule — **ignore
a `MutationRecord` whose added/removed nodes are entirely our own decorations** (carry
`data-render="1"/"2"` or a known decoration class), so a decoration write never triggers a
fleet-wide re-pass.

## Constraints
- **Must be an `addedNodes`/`removedNodes`-ALL-ours check, never target-based** — a single record can
  mix our decoration with a real content node (the spin replaces `blockElement.outerHTML`, whose
  subtree re-contains decorations but IS a real change and must pass).
- `characterData` records (callout/comment source text changing) carry no `addedNodes` → **must
  always pass** so type changes still refresh.
- Do **not** also patch `wysiwyg-code-highlight` — it already disconnects around its own writes
  (`wysiwyg-code-highlight.ts:322-326`, a self-loop guard, not cross-observer filtering).
- Pure scheduling: does not touch the spin, DOM content, the serialize, or caret → output
  (round-trip, caret, scroll) byte-for-byte unchanged. The realised saving is the **`querySelectorAll`
  walk churn only** (the heavy per-block decoration logic is already signature-gated, so re-passes are
  cheap no-ops) — a constant-factor trim, **not** the dominant `SpinVditorIRDOM`.

## Verification
- **Real-VS-Code e2e (MANDATORY):** assert (a) decorations still refresh on a **genuine** source edit
  (callout type change, comment edit, code source edit), and (b) a decoration-only injection does
  **not** trigger a second synchronous fleet pass.
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- **Sequence: land this on the task-176 shared dispatcher** (one filter point, one test surface) — the
  dependency is soft (per-observer is possible) but the dispatcher is the right vehicle and avoids a
  ~10× surface. Pairs with task 173 (scoping) and 176 (coalescing).
- Sequence AFTER the higher-leverage spin-input levers (task 172 strip SVG, task 171 §1 space-path) —
  this is the secondary multiplier, not the residual itself.
- `finish-init.ts`, `callouts.ts`, `html-comment.ts`, `edit-activity.ts`; memory
  `ghost-span-not-lute-transparent` (the `data-render` tagging this filter keys on).
