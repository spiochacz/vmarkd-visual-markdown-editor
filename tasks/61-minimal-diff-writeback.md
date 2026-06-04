# Task: Minimal-diff write-back (preserve untouched markdown on edit)

> **Status:** ✅ Done (2026-06-04) — shipped the block-level minimal-diff write-back.
> `src/minimal-diff-writeback.ts` (pure, unit-tested) + host Lute round-trip
> `reserializeMarkdown` (`src/lute-host.ts`); wired into `EditorSession.syncToEditor`
> (`src/extension.ts`) — memoized per-block reserialize, gated at 100 KB, falls back to
> the full write on any issue. Real-Lute end-to-end on a 10-table doc editing one
> paragraph: **+40/−31 → +1/−1**. v1 is read path-safe (per-block reserialize-equality is
> a semantic no-op; unmatched/context-sensitive blocks fall back). **Not done (v2):**
> Lute-aware block boundaries (currently blank-line split keeping fences whole — loose
> lists/blockquote-spanning-blanks fall back rather than minimize), ranged `WorkspaceEdit`
> (currently full-range replace with minimized text — git diff is minimal, but the VS
> Code edit/undo is whole-doc), and prewarming the block cache so the first edit on a
> big doc doesn't pay the one-time reserialize.
> **Source:** `tuanpmt/vditor` — "Preserve original markdown format when no user edits". Core fidelity concern.
> **Value / Risk:** 🟢🟢 highest product value (clean git diffs) / medium-high (touches the host write path; needs careful design)

## Spike findings (2026-06-04)
Measured the real reflow churn with the vendored Lute (`getValue ≈ VditorIRDOM2Md(Md2VditorIRDOM(md))`), diff via real `git diff --numstat`:

- **Reflow is near-zero post-Lute-upgrade (task 66) for normalized markdown.** Prose,
  headings (with blank line), blockquotes (with space), `*`/`+`/`1)` lists, setext,
  em/strong all **round-trip byte-identical** (D0 = 0). The real 319 KB fixture churned
  **1 line**. So "one keystroke → whole-doc churn" is NOT true for clean files — the
  current full-write already yields minimal diffs there.
- **Churn concentrates in tables + non-normalized whitespace.** Reflow-prone: tables
  (column padding), heading-with-no-blank-after, runs of blank lines, trailing spaces,
  `>`-without-space, 4-space indented code (→ **becomes a paragraph**, semantic loss,
  cf #1898), 2-space hard breaks (→ soft break, semantic loss, cf #1922).
- **It scales linearly and gets bad fast** on table-heavy / hand-written docs: a doc
  with 50 unpadded tables, editing ONE paragraph → today **+241 / −192** line churn;
  the minimal change is **+1 / −1**.

### Chosen design — block-level "keep original bytes unless the block actually changed"
Simpler and lower-risk than the original Design A: **no DOM↔source mapping needed.** A
block is *unchanged* iff it **reserializes to the new block**:
`getValue(originalBlock) === newSerializedBlock` → write the ORIGINAL bytes for it;
only genuinely-changed blocks use Vditor's reserialized form.

Prototype (`minimalWriteback(originalText, getValue())`, greedy in-order block match on
the reserialize-equivalence): on the 50-table doc, **+241/−192 → +2/−3**, constant
regardless of table count, edit preserved. This also *contains* the semantic-loss bugs
(#1898/#1922/#1476) for untouched blocks — their original bytes survive even when a full
reserialization would corrupt them.

### Open implementation risks (the real work)
1. **Block boundaries:** `/\n\n+/` is naive — a fenced code block or list containing a
   blank line splits wrong. Use Lute-aware boundaries (e.g. the IR `data-block` nodes, or
   tokenize) instead of blank-line split.
2. **Cost:** reserializing every original block is N× Lute calls. Debounced + only on
   real edits, and can be scoped to blocks near the change / cached by block hash.
3. **Reorders/moves:** greedy in-order matching handles typical single-region edits;
   block moves may mis-match → fall back to full reserialize for unmatched blocks (still
   correct, just less minimal).
4. Edited block still reflows (acceptable — the user touched it).

## Problem
**Today (good):** untouched *files* are already byte-identical — we never write on open (edits post only on a real `input`, `media-src/src/main.ts:459-467`; `EditorSession.syncToEditor` short-circuits when `normalizeContent(content) === normalizeContent(document.getText())`, `src/extension.ts:547-563`).

**The gap:** the compared/written content is `vditor.getValue()` — Vditor's **reserialized** markdown, not the original source bytes. The moment the user makes **any** edit, `syncToEditor` replaces the **entire** `documentRange` (`extension.ts:556-557`) with Vditor's serialization, which **reflows untouched regions** (blank line after headings, `>` re-prefixing, list bullet normalization, etc. — already noted at `extension.ts:271-277`). One keystroke → whole-document churn → noisy git diff.

There is dirty tracking for the tab title only (`extension.ts:1058-1063`), but no per-region "did the user touch this" tracking and no path that preserves untouched source verbatim once any edit occurs.

## Goal
After an edit, the document on disk differs from the original by a **minimal diff** — only the regions the user actually changed — instead of a full Vditor reserialization. Untouched paragraphs keep their original bytes.

## Steps
1. **Design decision (do this first):** pick a strategy —
   - **(A) Minimal-diff write:** keep the original source in the host `EditorSession`; on each `edit`, diff original-vs-new (line or token level, e.g. `diff-match-patch` already in the bundle) and apply a `WorkspaceEdit` that replaces only the changed ranges, not `documentRange`. Lowest churn; needs a robust mapping from Vditor output back to original lines (we already have DOM↔source mapping infra: tasks 15/16, `media-src/src/source-map.ts`).
   - **(B) Suppress no-op reserialization regions:** detect blocks whose normalized form is unchanged and restore their original text before writing. Simpler but coarser.
2. Spike (A) on representative docs (headings + blockquotes + lists + tables) and measure diff size vs current behaviour.
3. Implement in `src/extension.ts` `syncToEditor` (`:547-563`) — replace the full-range write with a ranged `WorkspaceEdit` derived from the diff; keep the `normalizeContent` equality short-circuit as the fast path.
4. Guard interactions with: streaming (`main.ts:401-407`), reveal-in-source line mapping (`extension.ts:271-325`), git gutters (task 17), and undo grouping.
5. Tests: round-trip fidelity fixtures asserting untouched regions are byte-identical after editing one paragraph; diff-size assertions.

## See also
- `tasks/15-shared-dom-source-mapping.md`, `tasks/16-reveal-in-source.md`, `tasks/52-source-to-webview-cursor-sync.md` — mapping infra this can reuse.
- `tasks/60-table-cell-space-trimming-fidelity.md` — a minimal-diff write would *contain* such reflow bugs.
- `tasks/46-rendered-diff-view.md` — diff infra/UX neighbour.

## Reported upstream (repro + verify these — fidelity)
- Vditor **#1898** — ⚠️ **DATA LOSS.** **Manifests:** take a paragraph that contains soft line breaks (a multi-line block) and apply a heading to it → the editor shows *all* the lines styled as the heading; **save and reopen → only the first line survives, the rest is silently gone**. Minimal-diff write (or detecting the lossy reserialization) should prevent the loss. https://github.com/Vanessa219/vditor/issues/1898
- Vditor **#1922** — pressing Enter yields **two `\n`** in `getValue()`. **Manifests:** typing `title`+Enter+`content` produces `title\n\ncontent`, but pasting the same template gives a single `\n` — so the same visible text serializes differently depending on how it was entered (breaks delimiter/line-count-based parsing). Verify our write-back doesn't inflate blank lines. https://github.com/Vanessa219/vditor/issues/1922
- Vditor **#1476** — IR: pasting reference-style links is lossy. **Manifests:** paste text using `[label][1]` + `[1]: https://…` definitions — looks fine in IR, but switch to another mode and **each link gets a literal URL appended after it**; switching back keeps the corruption. https://github.com/Vanessa219/vditor/issues/1476

## Verify
Open a multi-section doc, edit one paragraph, save: `git diff` shows **only** that paragraph changed (no heading/blockquote/list reflow elsewhere). Reveal-in-source, git gutters, streaming, and undo all still work. Round-trip fidelity tests pass.
