# Task: Repro batch — unverified editing bugs from fork bug-hunt

> **Status:** ✅ Done (2026-06-04). All candidates verified against our build
> (vditor@3.11.2 + pinned Lute). **None of the keydown/click candidates reproduce** — they
> were fixed upstream / targeted an older fork base — so each is kept as a 🟢 GUARD
> (`media-src/e2e/keybugs.spec.ts`, 7 tests) so a future Vditor/Lute bump can't silently
> regress them. The one real bug found, **#1904**, was fixed separately (input
> normalization, `src/table-pipe-escape.ts`; see task 60).
> Verdicts (tests: `keybugs.spec.ts` for keydown/click, `test/backend/vditor-fidelity-bugs.test.ts` for serialize):
>   - #1 Backspace over a cross-soft-break selection → **🟢 not reproduced** (deletes cleanly). Guarded.
>   - #2 Enter inside a code block → **🟢 not reproduced** (text stays in the block, cursor doesn't jump out). Guarded.
>   - #3 Select-all then deselect → **🟢 not reproduced** (ArrowRight collapses; our key layer only binds undo/redo, no Ctrl+A trap). Guarded.
>   - #4 Click-elsewhere collapses an expanded inline marker → **🟢 not reproduced** (collapses). Guarded.
>   - #5 Enter at start of a heading → **🟢 not reproduced** (heading intact). Guarded.
>   - #6 Backspace after a front-matter block → **🟢 not reproduced** (front-matter is `yaml-front-matter`, outside the code/math-block backspace branch; the unguarded querySelector is unreachable). Guarded.
>   - #7 Toolbar inline-code missing data-marker → **🟢 not reproduced** (getValue round-trips with backticks; the marker self-heals on the next spin). Guarded.
>   - #1476 reference-link round-trip → **🟢 not reproduced** (likely fixed by the Lute upgrade, task 66). Guarded.
>   - #1904 `|` in inline math/code in a table cell → **✅ fixed** (was reproduced; normalized on input — see task 60).
>   - #8 (math-autocomplete + Enter) → **deferred** (we have no math autocomplete). #9 (ordered-list renumber) → Lute-side, low priority, not pursued.
> **Source:** Vditor fork bug-hunt (WizTeam, Ficus) — candidates below with fork commit + engine file.
> **Value / Risk:** 🟡 each is a plausible editing-correctness bug in core handlers / low to investigate, value depends on repro

## Problem
The fork bug-hunt surfaced several editing-logic bugs in files that still exist in our vendored Vditor, but static reading was inconclusive — they need a runtime repro to confirm before a fix is worth writing. They cluster in core keydown/selection/backspace handlers (`fixBrowserBehavior.ts`, `ir/`, `wysiwyg/processKeydown.ts`), so if present they affect everyday editing.

## Candidates to reproduce (confirm 🔴/🟢 in our build, then split off a fix task per confirmed bug)
1. **Backspace over a selection with a soft line-break corrupts content** — WizTeam `8cd9864d`; core `util/fixBrowserBehavior.ts` backspace path. (High risk if present.)
2. **Newline inside a code block jumps the cursor** to the wrong position — WizTeam `299880c4`; code keydown / `undo/index.ts`.
3. **Can't deselect after Select-All (Ctrl+A)** — WizTeam `8f217158`. NB: verification found no Vditor Ctrl+A trap; if reproduced, suspect OUR key-capture layer (`media-src/src/undo-keybind.ts`) rather than Vditor.
4. **Clicking blank area doesn't collapse an expanded inline marker** (IR/WYSIWYG) — WizTeam `2d9c7b2a`; `ir/index.ts`.
5. **Enter at the very start of an H1–H6 mis-parses the heading** — Ficus `908accc`; `wysiwyg/processKeydown.ts`.
6. **Backspace at start of the `---` / front-matter throws** — Ficus `03f5ac4`/`197a88f`. Verification found guarded paths (`processKeydown.ts:108`, `sv/inputEvent.ts:134-143`) but the IR code-block backspace at `ir/processKeydown.ts:195` has an unguarded `querySelector(...).selectNodeContents` worth checking.
7. **Toolbar-inserted inline-code lacks `data-marker`**, breaking later editing of that span — Ficus `37230dc`; `wysiwyg/highlightToolbarWYSIWYG.ts`.
8. **Completion mid-formula + Enter jumps the cursor past the formula** — Ficus `d3fa812`; `wysiwyg/input.ts` (only relevant if/when we add math autocomplete — likely defer).
9. **Ordered-list renumbering** off — likely Lute-side; `fixBrowserBehavior.ts:273-277` looked correct. Low priority.

### Also reported on upstream Vditor — VERDICTS (verified 2026-06-04 on 3.11.2)
> - **#1912** → 🔴 **fixed**: external `setValue` reset the caret; `caret-preserve.ts` re-derives it (guarded 🟢 in keybugs.spec.ts).
> - **#1925** → 🔴 **reproduced, parked** (task 72): Enter in a list+blockquote escapes to a new list item. High-risk core fix, rare, no data loss. 🔴 tripwire kept.
> - **#1922** → 🟢 **not-a-bug**: `title\n\ncontent` is correct (Enter = new paragraph); cosmetic paste inconsistency only, no data loss.
> - **#110** → 🟢 **not reproduced**: WYSIWYG blockquote Enter continues the quote.
> - **#905** → 🟢 **not reproduced**: pasting a table region creates a proper separate table, not all-in-one-cell.
> - **#939** → 🟢 **basic case OK**: Enter makes a sibling at the correct indent (the deep soft-wrap case not pursued).
> - **#645** → 🟢 **by-design (not a bug)**: Enter in a cell yields `<br />` (correct GFM); IR renders it as a visible `html-inline` marker — IR's convention of showing all markers (WYSIWYG renders the break). No data loss. Polish-only.
> - **#851** → 🟢 **caret/scroll-loss NOT reproduced** (user-confirmed absent in the real editor 2026-06-04; the synthetic-Range repro was a test artifact — edit content always lands correctly). The only real gap is **no line numbers in the editable view**, which is a *feature* → task 73, not a bug.

### Originally reported on upstream Vditor (now verified above)
- **#1925** (2026-06-03) — list + `>` blockquote: pressing Enter after the quote creates a new list item instead of a newline inside the quote. https://github.com/Vanessa219/vditor/issues/1925
- **#1922** — Enter produces two `\n` in `getValue()`. **Manifests:** typing `title`+Enter+`content` serializes as `title\n\ncontent`, but pasting the same template yields a single `\n` — same visible text, different output. https://github.com/Vanessa219/vditor/issues/1922
- **#1912** — `setValue` jumps the cursor to position 0. **We call `setValue` on host update/streaming** (`media-src/src/main.ts:443,533`) — confirm the caret/scroll isn't reset on an external update (we have an `applyingExtensionUpdate` guard). https://github.com/Vanessa219/vditor/issues/1912
- **#939** — list continuation lines can't be kept at sibling indent. **Manifests:** inside a list item with soft-wrapped sub-lines (`第一层之下01/02`), pressing Enter (esp. twice on a Shift+Enter wrapped line) jumps out and starts a new line aligned to the **top list level** instead of staying aligned with the sibling block — so you can't author the later continuation lines (`第一层之下03/04`). https://github.com/Vanessa219/vditor/issues/939
- **#851** — **Manifests:** editing a long code block in IR regenerates it at a new DOM position, so your scroll/cursor place is lost and you must re-find the line; line numbers don't show — painful on ~1000-line blocks. **#110** — no auto-indent on newline/Tab in WYSIWYG blockquote/code. https://github.com/Vanessa219/vditor/issues/851
- **#1476** — IR paste of reference-style links is lossy. **Manifests:** paste `[label][1]` + `[1]: https://…` → on mode switch each link gets a literal URL appended after it. https://github.com/Vanessa219/vditor/issues/1476

## Steps
1. Build a single repro markdown fixture exercising each scenario; run them in the dev build (IR/WYSIWYG/SV as relevant).
2. For each: mark 🔴 confirmed / 🟢 already-fixed / ⚪ not-applicable, with file:line.
3. For each 🔴, open a dedicated fix task (numbered after this one), using the esbuild `onLoad` patch mechanism for Vditor-source fixes (task 56 pattern) or our own layer where appropriate.
4. Prioritize #1 (content corruption) and #5 (heading Enter) — these are the most impactful if confirmed.

## See also
- `tasks/56-vditor-listtoggle-bugfixes.md` (esbuild `onLoad` patch mechanism for Vditor-source fixes).

## Verify
Each candidate has a recorded verdict + evidence; confirmed bugs have follow-up fix tasks; the repro fixture is kept for regression. No code change lands from this task itself beyond confirmed fixes (which get their own tasks).
