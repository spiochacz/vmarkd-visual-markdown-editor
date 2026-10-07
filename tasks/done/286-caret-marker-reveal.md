# Task 286 — BUG: caret navigation can land INSIDE hidden markers (Home/End) + reveal polish

**Status:** ✅ CLOSED (2026-10-07) — the corruption bug is not reproducible (measured); the optional reveal polish was not pursued.

## Measured 2026-10-07 — the corruption does not happen

Home / End / Ctrl+Home / Ctrl+End, then typing `X`, on lines starting or ending with `**bold**`,
`[link](u)`, `` `code` `` and `*it*`:

- chromium harness (list harness, IR): **10/10 correct** — `X**bold** tail`, `head **bold**X`, … never
  inside a marker.
- real VS Code (IR, temporary probe spec, deleted after the run): **10/10 correct**. One extra case on
  a long wrapped line put `X` at the start of the second VISUAL line — that is Home's normal
  visual-line behaviour in every editor, not a marker problem.
- WYSIWYG (out of scope here): typing at the start/end of a bold run continues the bold
  (`**Xbold**`), the way Word / Google Docs extend adjacent formatting. Valid markdown, not corruption.

So the "silent-corruption" bug is not present on the current code. What is left of this task is the
optional polish (selectionchange-driven reveal, traversal flash) — not measured, not a bug.

## What it is & the effect

In IR mode, collapsed markdown markers (`**`, `[`, `` ` ``…) are **zero-width spans that
remain in the text flow** (`_ir.less:36-42` — width:0/overflow:hidden). Vditor reveals them
(`expandMarker`) ONLY on mouse click and Arrow-key keyup (`ir/index.ts:181/224-230`).
Every other caret motion — **Home, End, PageUp/Down, Ctrl+Home/End** — never triggers the
reveal, so the caret can silently land INSIDE an invisible `**` text node.

**Effect today:** press Home on a line starting with `**bold**`, type a character — it goes
*inside* the hidden marker, corrupting the syntax with no visual cue (the same
silent-desync family as 239/240, but keystroke-sized). Bonus annoyance: arrow-traversal
through a formatted line expands/collapses each node synchronously → per-node layout flash.
**After:** any caret movement reveals the node under the caret, exactly like Obsidian Live
Preview (CodeMirror decorations react to selection overlap, however it moved); traversal
stops flashing.

## Scope

- [ ] Replace the key-whitelist trigger with a **selectionchange-driven** `expandMarker`
      (rAF-debounced; the function is exported from vendored source and importable) —
      covers Home/End/Page/Ctrl+Home, mouse drags, script-driven moves.
- [ ] Flash polish: collapse the PREVIOUS node only after the caret has settled outside it
      (~100ms dwell) instead of on every keyup — kills the traversal flicker.
- [ ] Keep the existing blur-collapse (`editorCommonEvent.ts:44-47`); guard with the
      composing lock (IME) and the mid-spin lock; never fire on the keystroke hot path
      beyond the debounce (perf memory applies).
- [ ] Regression net for the corruption: Home-then-type on `**bold**`/`[link](u)` lines →
      syntax intact.

## Out of scope

- WYSIWYG mode (markers hidden by design there), changing marker CSS (width:0 stays —
  it is what makes triple-click marker-inclusive copy work, 191 P0-11).

## Verification

L1: none meaningful (DOM-driven). L2: the corruption matrix (Home/End/PageUp + type, per
inline node type) → `getValue()` intact + node expanded; traversal flash pinned via
mutation counts. L3 real-VS-Code (mandatory): same matrix under real key handling + a
long-line wrapped case.
