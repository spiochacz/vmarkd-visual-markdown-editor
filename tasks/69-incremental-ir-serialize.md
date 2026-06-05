# Task: Incremental IR serialization (C3) — re-serialize only the edited block

> **Status:** 🟡 Spike DONE (2026-06-05) → **GO**. Ready to implement (see "Spike results" below).
> **Source:** Follow-up to [68 — IR edit/paste latency](68-ir-edit-serialize-perf.md)
> (option C3). Tasks 68 (A + C2) reduced *how often* / *how many times* the full
> serialize runs; C3 attacks the *cost* itself.
> **Value / Risk:** 🟢🟢 the only approach that removes the large-doc edit freeze
> entirely (O(block) per edit instead of O(document)) / **medium** (was high — the
> 2026-06-05 spike proved per-block serialize has **no content-level drift**; range-splice
> reproduces the full serialize byte-for-byte). Remaining risk = the block↔range map
> surviving structural edits. Still built as *incremental with a full-serialize fallback*
> so worst-case correctness equals today's behaviour.
>
> **Prefer this over [70 — Worker serialize](70-worker-serialize.md) as the first win.**
> A boundary-cost PoC (2026-06-05, see task 70) showed the Worker/WASM data boundary is
> cheap (µs-range per keystroke) — but a Worker turns Lute's *synchronous* serialize into
> an *asynchronous* one, forcing systemic caret/selection reconciliation against stale
> input. C3 cuts the cost **synchronously**, with no async-reconciliation problem and no
> Worker/WASM plumbing. Use task 70 only if C3 alone isn't enough on the very largest docs.

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

## Spike results (go/no-go) — ✅ DONE 2026-06-05 — **GO**
Measured directly: **Lute runs in plain Node** (shim `window`/`self` → `globalThis`, then
`require('media-src/vendor/lute/lute.min.js')`; `Lute.New()` + `SetVditorIR(true)`), so the
fidelity question was answered without the e2e harness. `jsdom` split the IR DOM (from
`Md2VditorIRDOM(md)`) into top-level blocks; battery = paragraph, ATX headings, thematic break,
fenced code, tight/loose/ordered/nested lists, blockquote, blockquote+list, table, ref-link defs,
footnotes, and a mixed real-world doc (14 cases).

**Finding 1 — fidelity: no structural drift, anywhere.** The ONLY difference between per-block
serialize and the full serialize is the **inter-block separator** (`\n` vs blank line `\n\n`).
Every block's *content* serializes **byte-identical** in isolation. The hard-parts fears below did
**not** manifest: lists/blockquotes/tables are each a *single* top-level block (serialized as a unit,
byte-identical even naively); ref/footnote definition blocks serialize **in place**, byte-identical.
Naive concatenation drifts only on whitespace (7/14 cases); lists+tables match even naively (7/14).

**Finding 2 — the design that works: range-splice (better than naive join).** Don't reconstruct the
full string by joining raw per-block outputs (that forces reverse-engineering Lute's separator rules —
which have quirks, e.g. a fenced code block emits `\n\n\n` before a following table). Instead:
the cache is built **once** from an authoritative full `VditorIRDOM2Md` (correct separators baked in);
the per-block map records each block's **content** `[start,end)` range; on edit, re-serialize only the
changed block and **splice its content into its range — separators are inherited untouched**.
Verified: range-splice (simulate re-serialize+splice of *every* block) **reproduces the authoritative
full serialize byte-for-byte for ALL 14 cases**, including ref-defs, footnotes, and the mixed doc.
→ This removes hard-part #3 (no need to reproduce Lute's join rules) and neutralizes #1.

**Finding 3 — the perf win is real and large.** Full `VditorIRDOM2Md` is O(n²); single-block is flat:

| paras | full serialize | 1-block serialize | speedup |
|---|---|---|---|
| 200 | 107 ms | 0.76 ms | 141× |
| 1000 | 625 ms | 0.35 ms | 1 792× |
| 2000 | 3 802 ms | 0.37 ms | 10 369× |
| 4000 | 16 633 ms | 0.33 ms | 50 751× |

**Finding 3b — atomic-block caveat (tables & large code blocks).** A table is a *single* top-level IR
block, so editing any cell re-serializes the **whole table**; same for a large fenced code block. Table
fidelity is perfect (alignment, inline fmt, escaped `\|`, empty cells, ragged widths, multi-table all
reconstruct byte-for-byte), but the per-edit *cost* scales with the block's size — it is **not** the flat
~0.3 ms of a paragraph:

| table rows | table-block serialize |
|---|---|
| 10 | 2.4 ms |
| 200 | 8.6 ms |
| 1000 | 50 ms |
| 4000 | 218 ms |

Still **linear** (not O(n²)) and ~76× cheaper than full-doc serialize at 4000 rows — so a huge win, but for
pathologically large single blocks (thousands of table rows / code lines) an in-block edit costs tens-to-low-
hundreds of ms. Acceptable (debounced, far better than today); the escape hatch for that rare case is task 70
(move that one heavy block-serialize off the main thread). Sub-block granularity (per-row) is **not** worth it.

**Finding 4 — the hook (`ir/input.ts`): clean for the typing path, but not sufficient alone.**
`input()` already computes the dirty `blockElement` (`hasClosestBlock`) and pre-resolves context
(climbs to top-list/blockquote/footnote, merges adjacent lists, appends all def/footnote blocks) —
but (a) it calls `SpinVditorIRDOM` (DOM→DOM), **not** the markdown serialize; the serialize is the
debounced `getMarkdown` → `VditorIRDOM2Md(whole)` in `ir/process.ts` `processAfterRender`
(`setTimeout(undoDelay)`); and (b) `input()` is only **one** of several DOM-mutating paths
(keydown Enter/Backspace/Tab, paste, toolbar). Hooking `input()` alone would let the cache go stale.
→ **Recommended (refined): content-diff, NOT MutationObserver+WeakMap.** Vditor does
`blockElement.outerHTML = …` after Spin, which *replaces* the node — so element identity (WeakMap) and
childList-mutation identity don't survive even a plain text edit. Instead, at the single serialize choke
point (`getMarkdown`, intercepted via an esbuild `onLoad` patch — project precedent), compare the array of
top-level-block **`outerHTML` strings** (previous vs current): same length → indices whose `outerHTML`
changed are dirty (range-splice each); different length → structural (window-reserialize, see Finding 5).
Reading all blocks' `outerHTML` is O(n) (~2 ms, the cheap innerHTML read) vs the O(n²) serialize — robust to
node replacement, no identity tracking. NOTE: task-69 serialization does **not** need input()'s
list-merge/def-append gymnastics — those are Spin/DOM concerns; each top-level block serializes correctly alone.

**Finding 5 — broad verification: structural edits are incremental too (no full-serialize fallback needed).**
Prototyped the full engine (content-diff dirty detection + range-splice for in-block + **window-reserialize**
for structural) and stress-tested it — **37/37 checks pass, byte-exact**:
- **Window-reserialize lemma:** `VditorIRDOM2Md(htmlA+htmlB)` reproduces the corresponding region of the full
  serialize (9 adjacent block-type pairs incl. code+table, para+list, para+footnote). So a structural edit
  re-serializes a **narrow contiguous window of blocks expanded by one neighbour each side** in ONE Lute call;
  Lute emits the authoritative inter-block separators — **no separator synthesis, no fragility**. Split, merge,
  insert, delete, paste-N all handled uniformly this way (18 targeted cases ✅).
- **Multi-block dirty** (same count, non-adjacent) ✅. **Config permutations** (autoSpace / fixTypo / listStyle /
  paraSpace, 30 cases) ✅.
- **FUZZ: 4000 random edits** (in-block / split / merge / insert / delete) on a large mixed doc, asserting
  `cache === full VditorIRDOM2Md` after **every** edit → **0 mismatches**. Path mix: inblock 2658, window 1342,
  **full-fallback 0**. The expand-by-one window keeps even structural edits incremental → **the feared
  "Enter/Backspace forces a full O(n²) serialize → freeze on big docs" does NOT happen.**

**Remaining risk is NOT fidelity and NOT the algorithm — it's webview integration only:** the post-edit DOM in
the spike came from `Md2VditorIRDOM` (canonical); real Vditor produces it via `SpinVditorIRDOM` on the edited
`contenteditable` (same `VditorIRDOM2Md` serialize, so the algorithm holds, but verify in-webview). Plus the
live content-diff timing, IME (`composingLock`), undo/redo, caret (#1912), save timing, `source-map` offsets
(reveal-in-source / git gutters), streaming, and mode switches — all e2e/manual, not unit-testable in Node.

## The hard parts (read before estimating)
> ⚠️ The 2026-06-05 spike (Findings above) **disproved #1, #2 and #3** for the IR top-level-block granularity:
> #1/#3 — no content-level context-sensitivity (only inter-block separators, inherited via range-splice);
> #2 — structural remap is handled byte-exact by window-reserialize (4000-edit fuzz, 0 mismatches, 0 fallbacks),
> so no full-serialize fallback is even needed for split/merge/insert/delete. No per-block-type allowlist needed.
> **The remaining work is webview integration (Finding 5 last paragraph), not the serialization algorithm.**

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
