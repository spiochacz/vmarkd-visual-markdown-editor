# Task: Incremental IR serialization (C3) — re-serialize only the edited block

> **Status:** ⬜ Not started (large — design + spike first).
> **Source:** Follow-up to [68 — IR edit/paste latency](68-ir-edit-serialize-perf.md)
> (option C3). Tasks 68 (A + C2) reduced *how often* / *how many times* the full
> serialize runs; C3 attacks the *cost* itself.
> **Value / Risk:** 🟢🟢 the only approach that removes the large-doc edit freeze
> entirely (O(block) per edit instead of O(document)) / **high** — markdown
> serialization is context-sensitive, and the block↔source map must survive
> structural edits. Must be built as a *fast-path with a full-serialize fallback*
> so worst-case correctness equals today's behaviour.

## Background — why this is needed
IR reserializes the **whole document** to markdown on every (debounced) edit:
`media-src/node_modules/vditor/src/ts/ir/process.ts:53` → `getMarkdown(vditor)` →
(`markdown/getMarkdown.ts:9`) `vditor.lute.VditorIRDOM2Md(vditor.ir.element.innerHTML)`.
That Lute (WASM) conversion is **super-linear (~O(n²))** in document size — measured:

| doc | full serialize |
|---|---|
| 200 lines | 108 ms |
| 1000 lines | 543 ms |
| 4000 lines | **~5200 ms** |

The DOM `innerHTML` read is ~2 ms (negligible); the cost is entirely
`VditorIRDOM2Md`. We are on the newest Lute (task 66), so this is current upstream
behaviour — not a regression. A single full serialize on a 4000-line doc freezes the
editor ~5 s. Tasks 68-A/C2 keep it from firing twice or mid-edit, but it still fires
(on idle / save). C3 is the only way to make it cheap.

## Idea
Keep a **cached full-document markdown string** plus a **per-top-level-block map**
(block element → its serialized markdown + its `[start,end)` range in the cached
string). On an edit, re-serialize **only the changed block(s)** with
`lute.VditorIRDOM2Md(blockHTML)` and splice the result into the cached markdown.
Per-edit cost becomes O(edited block), independent of document size.

IR top-level blocks are the `> [data-block="0"]` children of `vditor.ir.element`.
Vditor's own input handler (`ir/input.ts`) already works on a single `blockElement`
(it does `blockElement.outerHTML = SpinVditorDOM(blockHTML)` for the edited block),
so the "which block changed" signal is available at that layer.

## The hard parts (read before estimating)
1. **Per-block serialize is context-sensitive.** `VditorIRDOM2Md(oneBlockHTML)` in
   isolation can differ from the same block inside the whole document:
   - **List tightness** (loose vs tight) depends on blank lines between sibling items.
   - **Reference-link / footnote definitions** (`[1]: …`, `[^a]: …`) live in *other*
     blocks; a paragraph using `[x][1]` serializes fine alone, but the definition
     block must be tracked too, and Lute may reorder/normalize definitions.
   - A **paragraph inside a list/blockquote** serializes with indentation; standalone
     it doesn't — so a block's markdown depends on its container.
   - **Nested lists, blockquotes-with-lists, tables**, and Lute's per-block trailing
     newline handling all complicate isolated serialization.
   → **Mitigation:** only take the fast path for **safe, self-contained block types**
   (plain paragraph, ATX heading, thematic break, fenced code block). Fall back to a
   **full serialize** for risky structures (lists, blockquotes, tables, ref/footnote
   defs, HTML blocks) or whenever the top-level block *count* changed.
2. **Structural edits remap blocks.** Enter splits one block into two; Backspace
   merges two into one; paste inserts N; delete removes. The block→range map must be
   reconciled on every edit (insert/remove/resize entries), or it silently corrupts.
   Simplest robust rule: if the set/order of top-level blocks changed at all, **fall
   back to full serialize** (and rebuild the map) for that edit; only do incremental
   when the edit stayed within a single existing block.
3. **Joining must match Lute exactly.** The cached string = blocks joined by the
   right separator. Verify what `VditorIRDOM2Md(whole)` puts between blocks (blank
   line? single `\n`? trailing newline) and reproduce it, or the cache drifts.

## Goal
After an in-block edit on a large document, producing the new full markdown is
**O(edited block)**, not O(document) — with the cached markdown **byte-identical** to
what a full `VditorIRDOM2Md` would produce (guaranteed by a drift check + fallback).

## Steps
1. **Spike + decide (do this first).** Prototype `incrementalSerialize`:
   - Snapshot block list `Array.from(ir.element.querySelectorAll(':scope > [data-block="0"]'))`.
   - For each block, `lute.VditorIRDOM2Md(block.outerHTML)`; join; compare to
     `lute.VditorIRDOM2Md(ir.element.innerHTML)` (the authoritative full serialize)
     on a battery of real docs (paragraphs, headings, **lists**, **tables**,
     **ref/footnote defs**, nested structures). **Record which block types join
     losslessly and which drift.** This decides the safe-fast-path set. If even
     plain paragraphs drift, C3 is not viable as designed — stop and report.
2. **Build the cache module** `media-src/src/incremental-md.ts` (pure where possible):
   - `buildCache(blocks: {key, md}[]) → {full, ranges}` — join + record ranges.
   - `spliceBlock(cache, key, newMd) → cache'` — replace one block's range, shift the
     rest. Pure, unit-testable.
   - `blockKey(el)` — stable identity (e.g., a WeakMap-assigned id, or content+index).
3. **Wire the edit path.** Hook where Vditor commits a block edit (the `ir/input.ts`
   `blockElement` path — likely via an esbuild `onLoad` patch that, after
   `blockElement.outerHTML = …`, notifies a callback with the block), OR observe
   `ir.element` with a `MutationObserver` scoped to direct children. On a single-block
   edit: re-serialize that block, `spliceBlock`, expose the cached `full` as the
   editor's markdown for host-sync. On structural change / unsafe block:
   `buildCache` from a full serialize (fallback).
4. **Make it the source for host-sync** (replaces `getValue()`/the reused
   `options.input(text)` from task 68-A on the hot path): `pending-edit` posts the
   cached `full`. **`flush()` (Ctrl/Cmd+S) MUST do a full authoritative serialize**
   (`vditor.getValue()`) and, if it differs from the cache, resync + log — this is the
   **self-heal / drift detector** that guarantees saved files are never corrupted by a
   bad incremental result.
5. **Guard interactions:** streaming (`main.ts` `streamRenderIR`), reveal-in-source &
   git gutters (reuse the DOM↔source map, `media-src/src/source-map.ts`, tasks 15/16),
   wiki re-render, mode switches (IR↔WYSIWYG↔SV — only IR has this cache; rebuild on
   switch), and `applyingExtensionUpdate`/extension-driven `setValue` (rebuild cache).
6. **Tests.**
   - **Unit** (`incremental-md.test.ts`): `spliceBlock`/`buildCache` range math,
     block-key stability, separator/trailing-newline handling.
   - **E2e** (real Vditor, large doc): edit one paragraph → cached md **equals** full
     `VditorIRDOM2Md` (zero drift); per-edit time stays flat as the doc grows (the win);
     structural edits (Enter split / Backspace merge / paste) keep the cache consistent
     (via fallback); save always authoritative. Use the existing harness pattern
     (`media-src/e2e/`, real Vditor from `vditor/src/index`).

## See also
- [`68-ir-edit-serialize-perf.md`](68-ir-edit-serialize-perf.md) — A + C2 (shipped) and
  C1 (auto-SV) which is a lower-risk partial alternative.
- [`61-minimal-diff-writeback.md`](61-minimal-diff-writeback.md) — **composes with C3**:
  C3 makes producing the new markdown cheap; 61 makes *writing* it to disk a minimal
  diff. Both want a block↔source mapping.
- [`15-shared-dom-source-mapping.md`](15-shared-dom-source-mapping.md) /
  [`16-reveal-in-source.md`](16-reveal-in-source.md) — `media-src/src/source-map.ts`
  already maps DOM↔source offsets; the block-range map can build on it.
- `media-src/src/pending-edit.ts` — host-sync debounce (task 68-A) that would consume
  the cached markdown. `media-src/esbuild-shared.mjs` — patch precedent if the edit
  hook needs a Vditor source change.

## Verify
- Per-edit serialize cost is **independent of document size** for safe blocks (flat
  vs the O(n²) baseline in task 68).
- Cached markdown is **byte-identical** to a full `VditorIRDOM2Md` across a fuzz
  battery of edits (paragraphs/headings fast-path; lists/tables/defs via fallback).
- **Save is always authoritative** (full serialize) and the drift detector never
  fires in normal use (if it does, that's a fast-path correctness bug to fix or a
  block type to move to the fallback set).
- Worst case (all-fallback) equals today's behaviour — never worse, never corrupting.
