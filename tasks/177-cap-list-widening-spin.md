# Task 177 — Cap the list-widening that turns a one-char list edit into a whole-list spin (needs-spike, deprioritized)

**Status:** TODO (big / **needs-spike**, **deprioritized** — does NOT touch the stated diagram/prose targets; high correctness risk).
**Source:** vMark edit-responsiveness analysis (2026-06-28, workflow `wf_2c64003e-264`).
**Value / Risk:** 🟦 low (only "typing inside a long/nested list" benefits) / 🔴 high (loose/tight + ordinal correctness; can drift the task-69 save round-trip).
**Engines:** none.

## Problem

`ir/input.ts:118-122` (`getTopList`) + `:136-147` widen the spin input to the **entire top-level
list plus adjacent UL/OL siblings** on ANY edit inside a list item (`getTopList` →
`hasClosest.ts:48-56` walks to the **outermost** UL/OL). So on a long/nested list `SpinVditorIRDOM`
re-parses the **whole list every keystroke** — the same cost class as a whole-document spin,
triggered by ordinary typing.

## ⚠️ Why the obvious fix is WRONG (do NOT ship "spin only the edited `<li>`")

The widening is Vditor's **deliberate correctness mechanism**, not waste. `ListData.Tight`
(loose/tight, blob `@1523759`, 34 `Tight` occurrences) and ordered-list `Start`/`Num`/`Delimiter` are
**whole-list AST properties** that Lute re-derives on every cold `Parse`:
- a lone-`<li>` spin re-derives `Tight` from that item alone → the edited item **flips to tight while
  siblings stay loose**;
- it re-derives ordinals from a one-item list → **wrong `Start`/`Num`**.

Because task 69's save-path incremental serialize **also** re-spins blocks, that divergence can leak
into the **byte round-trip**, not just the visual DOM. Also: inline-formatting triggers (`*`, `` ` ``,
`[`, `_`) are `insertText` too and **must still spin to render live**, so narrowing must spin the
`<li>` (not skip) — and spinning a lone `<li>` hits the loose/tight + ordinal divergence.

**Crucially, this misses both stated targets:** a diagram source is a `code-block`
(`getTopList` returns nothing) and prose isn't a list — so only "typing in a long/nested list"
benefits.

## Plan (IF spiked at all — narrow subset only)

1. For non-boundary `insertText`/`deleteContent`, skip **only** the adjacent-UL/OL sibling merge
   (`:136-147`) — that merge only matters for ops that can fuse/split lists. Bounded, low-risk, but
   it does **not** cut the dominant cost.
2. Test whether spinning the **immediate** containing UL/OL (replace `getTopList` with
   `hasClosestByTag` one level) is **byte-identical** across a corpus of ordered / nested / loose
   lists. **If even that flips tightness relative to the parent item, abandon.**

## Constraints
- Caret is preserved via the `<wbr>` inside whatever fragment is spun (caret is not the risk —
  **structural correctness** is).
- The `:136-147` merge-skip must keep the existing dedupe correct: a newly-typed ref-def/footnote is
  pulled into the spun html at `:159-172` and Lute dedupes — gate must only skip when the edited block
  is genuinely non-ref/non-footnote and the spin appended nothing.
- Round-trip must stay byte-identical (this is exactly what's at risk → the spike's gate).
- Off-thread is N/A (this is about WHAT html to spin, not WHERE).

## Verification
- **Spike gate:** byte-identical round-trip across ordered-renumber / nested / loose-vs-tight / the
  documented gap-paragraph corpora — in the Node-Lute harness AND a real-VS-Code e2e matrix.
- If any case flips tightness/ordinals → abandon.
- `tsc` + `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- **Lowest priority of the survivors** — sequence behind every lever that touches the actual
  diagram-source / prose hot path (171, 172, 173). Pairs opportunistically with task 171 §2's
  dropped ref-def/footnote merge-skip.
- `ir/input.ts`, `util/hasClosest.ts`, task 69 (incremental serialize — what the divergence would
  corrupt); the `vmarkd-lute-features` skill (`ListData.Tight`, the Node-Lute probe).
