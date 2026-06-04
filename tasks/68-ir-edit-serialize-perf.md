# Task: IR edit/paste latency on large documents (reserialize cost)

> **Status:** 🟢 A + C2 done; C1/C3 open (options). **Source:** investigation triggered
> by reported IR edit/paste lag on large files.
> **Value / Risk:** 🟡 makes active editing responsive on large docs / low (A + C2
> are in our code + a config lever; no core Vditor render-path patch).

## Problem
Vditor IR reserialises the **whole document** to markdown on every (debounced) edit:
`ir/process.ts:53` → `getMarkdown(vditor)` → `lute.VditorIRDOM2Md(ir.element.innerHTML)`.
That serialise is **super-linear (~O(n²))** in Lute (WASM). Measured (rich paragraphs):

| doc | `getValue()` (serialize) |
|---|---|
| 200 lines | 108 ms |
| 1000 lines | 543 ms |
| 4000 lines | **5247 ms** |

Breakdown: the DOM `innerHTML` read is ~2 ms (negligible); **`VditorIRDOM2Md` is the
bottleneck**. We are already on the newest Lute (task 66), so it's current upstream
behaviour. SV mode's `getMarkdown` is just `textContent` (no Lute) → cheap → the escape
hatch for huge files.

## Done
- **A — no double serialize.** Vditor already serialises once and passes the markdown
  to `options.input(text)` (`getValue()` == `getMarkdown` — verified). Our debounced
  host-sync (`pending-edit.ts`) now reuses that `text` (`main.ts` `input(value)` →
  `schedule(value)`) instead of calling `getValue()` again → removes one full serialise
  per edit. e2e asserts the debounce posts with **0** extra `getValue()` calls.
- **C2 — defer the serialize off the active-typing path.** The serialize fires on a
  debounce keyed off `undoDelay` (default 800 ms). For large docs we widen it
  (`edit-sync-tuning.ts` `undoDelayForContentLength`: ≥20k chars → 2000 ms), set as the
  Vditor `undoDelay` option from initial content size. Bursty editing (pauses below the
  window) no longer triggers a mid-edit freeze; the cost is deferred to a real idle /
  save (`flush()` serialises live on Ctrl/Cmd+S). Undo is unaffected by the markdown
  serialise (Vditor undo diffs `innerHTML`, not markdown — verified), so the only
  trade-off is coarser **undo-step granularity** on large docs. e2e asserts a widened
  `undoDelay` defers the host edit out of the active-typing window.

## Open (options, not pursued)
- **C1 — auto-SV for very large files.** Above a size threshold, open in source (SV)
  mode where `getMarkdown` is `textContent` (no Lute) → no serialize freeze. Low risk,
  product decision.
- **C3 — incremental serialize.** Re-serialize only the changed block + splice into a
  cached full markdown (O(block) per edit). The only approach that removes the freeze
  entirely, but markdown serialization is **context-sensitive** (list tightness, ref/
  footnote defs, list-vs-standalone) so per-block output can diverge, and the block↔
  range map breaks on structural edits. High risk/effort; overlaps task 61.
- **C4 — upstream Lute** `VditorIRDOM2Md` O(n²) — external.

## Verify
Unit: `edit-sync-tuning.test.ts`, `pending-edit.test.ts`. E2e: `save-flush.spec.ts`
(debounce reuses text → 0 extra getValue; widened undoDelay defers the edit). Neither
makes a 4000-line doc "snappy" — a single full serialize is still ~5 s; A+C2 stop it
from firing mid-edit and from firing twice.
