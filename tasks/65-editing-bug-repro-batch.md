# Task: Repro batch — unverified editing bugs from fork bug-hunt

> **Status:** ⬜ Not started (investigation/repro task; spawns fixes if confirmed).
> **Source:** Vditor fork bug-hunt (WizTeam, Ficus) — bugs NOT yet confirmed against our `vditor@3.11.2`. See `out/vditor-co-aplikuje-raport.md` bug-hunt addendum.
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

### Also reported on upstream Vditor (verify on 3.11.2)
- **#1925** (2026-06-03) — list + `>` blockquote: pressing Enter after the quote creates a new list item instead of a newline inside the quote. https://github.com/Vanessa219/vditor/issues/1925
- **#1922** — Enter produces two `\n` in `getValue()` output. https://github.com/Vanessa219/vditor/issues/1922
- **#1912** — `setValue` jumps the cursor to position 0. **We call `setValue` on host update/streaming** (`media-src/src/main.ts:443,533`) — confirm the caret/scroll isn't reset on an external update (we have an `applyingExtensionUpdate` guard). https://github.com/Vanessa219/vditor/issues/1912
- **#939** — first Enter in a list should align with the sibling block. https://github.com/Vanessa219/vditor/issues/939
- **#110 / #851** — code-block editing experience (newline + tab). https://github.com/Vanessa219/vditor/issues/110
- **#1476** — IR paste of reference-style links adds a URL per link. https://github.com/Vanessa219/vditor/issues/1476

## Steps
1. Build a single repro markdown fixture exercising each scenario; run them in the dev build (IR/WYSIWYG/SV as relevant).
2. For each: mark 🔴 confirmed / 🟢 already-fixed / ⚪ not-applicable, with file:line.
3. For each 🔴, open a dedicated fix task (numbered after this one), using the esbuild `onLoad` patch mechanism for Vditor-source fixes (task 56 pattern) or our own layer where appropriate.
4. Prioritize #1 (content corruption) and #5 (heading Enter) — these are the most impactful if confirmed.

## See also
- `tasks/56-vditor-listtoggle-bugfixes.md` (patch mechanism), `out/vditor-forki-analiza.md` §8 (Ficus) / §7 (WizTeam).

## Verify
Each candidate has a recorded verdict + evidence; confirmed bugs have follow-up fix tasks; the repro fixture is kept for regression. No code change lands from this task itself beyond confirmed fixes (which get their own tasks).
