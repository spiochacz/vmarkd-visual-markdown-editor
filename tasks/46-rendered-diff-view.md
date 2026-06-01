# Task: Side-by-side rendered markdown diff view

> **Status:** ⏳ Todo — **not scheduled for implementation yet** (logged for later).
> **Source:** user request (2026-06-01). Inspiration: `phfsantos/vscode-markdown-editor`
> commit `3e9d22b1f2de42e8f763861059b0c848a7288cdf` ("diff view functionality")
> and its `src/diff/MarkdownDiffViewSupport.ts:alignChangesWithSpacers` +
> `media/diffViewTest{Left,Right}.html` test harnesses.
> **Value / Risk:** 🟡 medium (review markdown changes *rendered*, not as raw text)
> / 🔴 high effort (new view + alignment engine; sync scroll; entry-point wiring).
> **Engines:** none expected.

## Problem
We already do **inline** diff — git gutters (task 17): change bars (added/modified)
vs git HEAD in the single WYSIWYG editor (`src/diff-lines.ts`, `src/git-diff.ts`,
`media-src/src/diff-markers.ts`). What we **don't** have is a **two-pane rendered
comparison**: original vs modified shown side-by-side as rendered markdown, with
the two columns aligned (spacer rows for inserts/deletes) and change types
highlighted.

VS Code's native diff editor shows the **raw markdown text** diff. Our custom
editor is `priority: "option"`, so it deliberately does **not** hijack that — there
is currently no rendered alternative for reviewing markdown changes.

## Goal
A side-by-side **rendered** markdown diff:
- Left = original (git HEAD, or a chosen revision); right = current/modified.
- Columns aligned with spacer rows so matching content sits on the same line.
- Change types visually marked: added (right-only), deleted (left-only),
  modified (both), unchanged.
- Synchronized scrolling between panes.

## Approach (sketch)
- **Alignment engine:** extend our LCS line diff (`src/diff-lines.ts`) to emit an
  *aligned* L/R sequence with spacers — the role phfsantos's `alignChangesWithSpacers`
  plays (`{type, leftLine, rightLine, side, content}` rows). Build this as a pure,
  unit-tested module (mirror the `diff-lines` test pattern).
- **Original source:** reuse `src/git-diff.ts:getHeadContent` (vs HEAD) — or allow
  an arbitrary revision later.
- **Rendering:** two rendered panes (two Vditor instances, or one renderer run
  twice) in a single webview; sync scroll; reuse the diff-marker theming
  (`--vscode-editorGutter-*`) from `diff-markers.ts`.
- **Entry point:** an explicit command (e.g. "Open rendered diff") and/or a
  registered custom diff editor — decide whether to opt into VS Code's diff slot or
  stay command-driven (keeps `priority: option` behaviour for normal opens).

## Reference / caveats
- phfsantos's fork is **heavily diverged** (monorepo `packages/`, webview-rebuilt
  VS Code context menu, Kanban / Interactive-Table renderers). **Port the concepts,
  not the code** — the commit above is mostly WIP test scaffolding (`diffViewTest*.html`
  with hand-computed `DIFF_CHANGES`) plus unrelated `vscode?.` null-safety; the real
  logic lives in their `MarkdownDiffViewSupport.ts`, which that commit doesn't add.
- Reuse what we have: `diff-lines.ts` (LCS), `git-diff.ts` (HEAD content),
  `diff-markers.ts` (theming + block↔source mapping).

## Open questions
- Two Vditor instances vs one renderer rendered twice? (memory vs simplicity)
- Original from HEAD only, or arbitrary revision / working-copy-vs-saved?
- Invoke via command, or register a custom diff editor (and how to coexist with
  VS Code's native text diff)?
- Read-only both panes, or editable right pane?

## Verify
Open a changed `.md` → a two-pane rendered diff: left = HEAD, right = current,
rows aligned with spacers, added/deleted/modified visually distinct, scroll synced.

## See also
- `17-git-gutters.md` — the inline change-bar diff (different kind of diff; shares
  the LCS + HEAD-content plumbing).
