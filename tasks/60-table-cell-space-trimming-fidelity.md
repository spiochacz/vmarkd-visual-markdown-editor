# Task: Fidelity — space trimmed before inline markers in table cells

> **Status:** ✅ Fixed at the write-back layer (2026-06-04). Root cause localized by
> direct Lute probing: the space is destroyed at **PARSE/SPIN** (`Md2VditorIRDOM` /
> `SpinVditorIRDOM`, the Go/WASM binary) — NOT at serialize. `VditorIRDOM2Md` on a DOM
> that *contains* the space emits it correctly; our `vditor@3.11.2` TS has no offending
> trim in the cell-content path, so the cited tuanpmt-fork TS fix doesn't apply to us
> (different base; our loss is upstream in Lute). Trigger is narrow: the trailing space
> of a cell's *leading* text run when immediately followed by an inline marker
> (`**`,`*`,`` ` ``,`[`,`~~`).
>
> A serialize/TS patch CANNOT recover the space (parse already dropped it on load), and
> re-pinning is a dead end (current pin = latest 88250/lute master still trims; the fix
> never reached upstream). Rebuilding Lute from patched Go was rejected (would abandon
> the vendored prebuilt + sha-verify reproducibility). **Chosen fix (user-approved):**
> extend the minimal-diff write-back (task 61) to **cell level** — `mergeTableBlock` in
> `src/minimal-diff-writeback.ts`. Editing one cell no longer reflows the spacing of
> rows/cells the user never touched: their ORIGINAL bytes are kept; only genuinely
> changed cells take the editor form. A cell is "unchanged" iff it reserializes (in a
> 1-col table) to the same thing as the editor's cell — a semantic no-op, always safe.
>
> The 🔴 pure-Lute round-trip tripwires (`test/backend/vditor-fidelity-bugs.test.ts`)
> are KEPT (Lute still trims — that's by design, we fixed the write-back not Lute) and
> a 🟢 FIX test proves the space survives a one-cell edit end-to-end with real Lute.
> Residual gap (accepted): a space in the *very cell you are typing in* is still lost —
> but it was never displayed (parse drops it on load), so it isn't a regression.
>
> **#1904 (`|` inside inline math/code in a table cell) — also FIXED** (2026-06-04, same
> session). Root cause: Lute (like GitHub/cmark-gfm) splits cells on the raw `|` before
> inline parsing, so a `|` in `$…$`/`` `…` `` is read as a column separator → row mangled,
> data lost, *and the broken table shows on open* (worse than the space-trim: it's a
> display+edit bug, not just a save bug). Fix = `src/table-pipe-escape.ts`
> (`escapeTableSpanPipes`): normalize the markdown on the way IN — escape the in-span `|`
> to the GFM-correct `\|` — applied at every host→webview content boundary (`postUpdate`,
> the `renderForMode` overlay) and inside `reserializeMarkdown` (minimal-diff stays
> consistent: untouched math-tables keep their original bytes; edited ones normalize to
> valid GFM). SAFE: only over-split rows are candidates and the escape is applied only
> when it restores the exact expected column count, so correctly-celled tables (incl.
> `| $5 | $6 |` price tables) are never touched. Residual: typing a *brand-new* `$|x|$`
> live in a cell still splits (the spin re-parses raw text) — lesser edge, escape it as
> on GitHub.
> **Source:** `tuanpmt/vditor` — commits "Fix space trimmed before bold text in table cells" + "… before inline markers in table cells (all modes)" (does NOT apply to our base; see above).
> **Value / Risk:** 🟡 markdown fidelity (core project concern) / low — fix is pure host-side TS, falls back to editor output when uncertain

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
- Reference: tuanpmt fixed this in Vditor's table reverse-render (the `.trimLeft()` path in `fixBrowserBehavior.ts` + the IR/WYSIWYG table `…DOM2Md` serializer).

## Reported upstream (repro + verify these)
- Vditor **#645** — text wrapping inside a table cell displays abnormally. **Manifests:** in IR/SV, type multiple lines in one cell (`1` Enter `2` Enter `3`) → it collapses to a single line; the line breaks become inline `<br />` markers (`<code class="vditor-ir__marker">&lt;br /&gt;</code>`) instead of wrapping. https://github.com/Vanessa219/vditor/issues/645
- Vditor **#1904** — table cell with inline math containing `|` renders scrambled. **Manifests:** a cell like `\( |+\rangle\langle+| \)` — the `|` inside the math is parsed as a **column separator**, so the row's columns split/shift and the table renders mangled. (Overlaps the Lute `|`-in-math-in-table fix referenced by task 66.) https://github.com/Vanessa219/vditor/issues/1904
- Vditor **#905** — can't copy/paste across multiple table cells. **Manifests:** copy a multi-cell/table region (e.g. from another doc) and paste into an existing table → **everything lands in the single focused cell** instead of being distributed across the corresponding cells (Typora-style). https://github.com/Vanessa219/vditor/issues/905
- _Distinct table bugs from the space-trim focus — verify alongside while you're in the table serialize/render path; split into their own tasks if they need separate fixes._

## Verify
✅ Done. `test/backend/minimal-diff-writeback.test.ts` covers `mergeTableBlock`
(row-verbatim preservation, sibling-cell preservation, genuinely-changed cells take the
editor form, shape-mismatch fallback, and the `minimalDiffWriteback` wiring).
`test/backend/vditor-fidelity-bugs.test.ts` proves with **real Lute** that editing one
cell keeps `x **y**` intact in untouched cells while the edit (`P`) is preserved. The
🔴 pure-Lute tripwires remain (Lute still trims by design). #1904 fix is covered by
`test/backend/table-pipe-escape.test.ts` (11 cases incl. price-table safety, fenced-code
skip, idempotency) + a real-Lute proof in `vditor-fidelity-bugs.test.ts` that the save
path preserves `$|x|$` and `` `a|b` `` with their neighbour cells. Full gate: 381 unit,
90 e2e, biome ci clean.
