# Task: Minimal-diff write-back (preserve untouched markdown on edit)

> **Status:** ⬜ Not started (larger — design first).
> **Source:** `tuanpmt/vditor` — "Preserve original markdown format when no user edits". Core fidelity concern.
> **Value / Risk:** 🟢🟢 highest product value (clean git diffs) / medium-high (touches the host write path; needs careful design)

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
- Vditor **#1898** — ⚠️ **DATA LOSS:** applying a heading to a multi-line paragraph shows all lines as heading, but after save + reopen it's **truncated to the first line only**. Minimal-diff write (or detecting the lossy reserialization) should prevent the loss. https://github.com/Vanessa219/vditor/issues/1898
- Vditor **#1922** — pressing Enter yields **two `\n`** in `getValue()` output (inconsistent with pasted single-`\n` content). Verify our write-back doesn't inflate blank lines. https://github.com/Vanessa219/vditor/issues/1922
- Vditor **#1476** — IR: pasting reference-style links (`[x][1]`) adds a URL after each link on mode switch (lossy round-trip). https://github.com/Vanessa219/vditor/issues/1476

## Verify
Open a multi-section doc, edit one paragraph, save: `git diff` shows **only** that paragraph changed (no heading/blockquote/list reflow elsewhere). Reveal-in-source, git gutters, streaming, and undo all still work. Round-trip fidelity tests pass.
