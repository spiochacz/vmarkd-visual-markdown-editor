# Task: Fidelity — space trimmed before inline markers in table cells

> **Status:** ⬜ Not started (reproduce first).
> **Source:** `tuanpmt/vditor` — "Fix space trimmed before bold/inline markers in table cells (all modes)". See `out/vditor-co-aplikuje-raport.md` §2.2.
> **Value / Risk:** 🟡 markdown fidelity (core project concern) / medium — confirm the repro before patching

## Problem
A leading space before a bold/inline marker inside a table cell (e.g. `| a **b** |` round-tripping, or `text **bold**` where the space before `**` matters) can be **trimmed** by Vditor's table reverse-render, altering the source on edit. The bug lives in Vditor's table DOM→markdown path (`fixBrowserBehavior.ts` `.trimLeft()` usages + the IR/WYSIWYG table serializer), which we ship from source.

Our own `media-src/src/fix-table-ir.ts` is **only** an alignment/insert/delete UI overlay — it never touches cell text, so the fix is **not** something we already do. We also have **no** fidelity test for "space before inline marker in a table cell" (existing tests: `custom-renderer.test.ts`, `diff-markers.test.ts`, `source-map.test.ts`).

## Goal
Editing a table cell preserves intentional spacing before inline markers — no silent source mutation — in IR, WYSIWYG, and SV.

## Steps
1. **Reproduce first.** Build a minimal doc with table cells containing a space before `**`/`*`/`` ` `` markers; edit a cell and inspect the round-tripped source (via reveal-in-source / the saved file). Confirm whether our pinned `vditor@3.11.2` actually trims (the fork targeted an older base — the exact line may differ or already be fixed upstream).
2. If reproduced, locate the offending `.trimLeft()` / trim in the table serialize path (start at `vditor/src/ts/util/fixBrowserBehavior.ts`; also check the IR/WYSIWYG table `…DOM2Md` helpers). Port tuanpmt's fix.
3. **Patch via esbuild `onLoad`** in `media-src/esbuild-shared.mjs` (same mechanism as task 56 / the existing `fixDmpInterop`), with an anchored string replace + a guard that throws if the source no longer matches (version-bump safety).
4. Add a fidelity regression test (`media-src/src/` — e.g. a `table-fidelity.test.ts`) asserting the cell source survives a render→serialize round-trip.

## See also
- `tasks/06-table-panel-contenteditable-fix.md`, `tasks/52-source-to-webview-cursor-sync.md` (table/fidelity neighbours).
- `tasks/61-minimal-diff-writeback.md` — a minimal-diff write would *contain* the blast radius of this and similar reflow bugs; consider sequencing.
- `out/vditor-forki-analiza.md` §2f (tuanpmt V9 commits).

## Verify
Round-trip test passes; manual edit of an adjacent cell does not alter the spacing of the target cell in the saved file. Patch-guard throws on a Vditor version mismatch.
