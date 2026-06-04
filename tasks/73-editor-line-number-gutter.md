# Task: Line-number gutter in the IR/WYSIWYG markdown editor

> **Status:** 🔵 Backlog (2026-06-04). Feature request: show document line numbers in a
> left gutter of the editing view (IR/WYSIWYG), like a code editor — NOT the code-block
> line numbers (that's task 03, done, preview-only).
> **Value / Risk:** 🟡 navigation/orientation aid on long docs / **medium-high** — markdown
> rendering is not line-based, so "line numbers" is inherently approximate; alignment +
> re-render + perf are the hard parts.

## Goal
A left gutter showing line numbers aligned to the document content while editing in IR (and
WYSIWYG), toggleable via a setting (default off, zero change for existing users).

## The core difficulty — markdown is not line-based
Unlike a plain-text editor, the IR/WYSIWYG view is a tree of **block elements** (paragraphs,
headings, lists, tables, fenced code, blockquotes), not a list of lines:
- one **source** line can render to a paragraph that **soft-wraps** across many visual rows;
- one rendered **block** (a table, a fenced code block) spans **many** source lines;
- markers (`#`, `**`, list bullets) are hidden/transformed, so visual rows ≠ source lines.

So "line number" must be defined first. Three candidate meanings:
- **A. Source-line numbers** — label each block with the source markdown line it starts on.
  Most meaningful (matches the file on disk, supports "go to line"), but the gutter is
  **sparse/uneven**: numbers jump (a 10-line table shows one number at its top).
- **B. Visual-row numbers** — number every wrapped visual row. Looks like a code editor but
  is **meaningless** for markdown (wrapping depends on width/zoom) and hard to compute.
- **C. Block numbers** — a trivial CSS counter per top-level block. Easy, but it's "block N",
  not line numbers.

**Recommended: A (source-line gutter).** It's the only mapping that's stable and useful,
and it can REUSE the existing DOM↔source mapping infra (tasks 15/16/52) — Lute emits source
positions and we already map rendered blocks back to source for reveal-in-source and cursor
sync.

## Approach sketch (option A)
1. Source positions: Lute's `Md2VditorIRDOM` can emit block source offsets; we already
   consume a DOM↔source map (task 15 shared mapping). Derive each top-level block's starting
   **line number** (count `\n` up to its source offset).
2. Render a non-editable gutter (`position: sticky`/absolute left rail, `user-select: none`,
   `contenteditable=false`, excluded from the editable region like the IR table panel) with a
   number positioned at each block's `offsetTop`. Numbers are absolutely positioned to the
   block tops, not one-per-visual-row.
3. Keep it in sync: re-place numbers on input/re-render (debounced, like the diff gutters)
   and on scroll/resize. Reuse the gutter plumbing from the git-gutter (task 17) /
   diff-markers (`diff-markers.ts`) / heading-gutter (task 04) work.
4. Theme via `--vscode-editorLineNumber-foreground` / `--vscode-editorGutter-background`.
5. Setting: `vmarkd.editor.lineNumbers` (boolean, default false), pushed live like other
   body options (task 26).

## Risks / open questions
- **Alignment churn** on every edit (re-measure offsetTop of every block) — costly on large
  docs; ties into the perf work (tasks 68/69). Debounce + only re-measure visible blocks.
- **Sparse numbering UX** — decide whether to show only block-start numbers (honest) or
  interpolate (misleading). Recommend block-start only.
- **WYSIWYG** has the same block model; SV (split view) already shows the raw source where a
  normal editor gutter would be more natural — consider SV first as a cheaper win.
- Interaction with existing left gutters (heading-level indicator task 04, git gutters task
  17) — they share the left rail; need a combined layout, not three stacked gutters.

## See also
- `tasks/03-codeblock-line-numbers-setting.md` — code-block (preview) line numbers, done.
- `tasks/15-shared-dom-source-mapping.md`, `tasks/16-reveal-in-source.md`,
  `tasks/52-source-to-webview-cursor-sync.md` — the DOM↔source mapping this would reuse.
- `tasks/04-ir-heading-level-indicator-css.md`, `tasks/17-*` (git gutters),
  `media-src/src/diff-markers.ts` — existing left-gutter rendering to build on.

## Verify
Setting on → a left gutter shows source-line numbers aligned to block tops in IR/WYSIWYG;
numbers stay aligned across edits, scroll, theme switch, and mode switch; off → no gutter,
no perf cost. Unit (line-number derivation from source map) + e2e (gutter renders + aligns).
