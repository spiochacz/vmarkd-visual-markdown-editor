# Task 531 — IR: the first keystroke after Ctrl+Z is lost

**Status:** ✅ done (2026-10-07) — root cause confirmed; fixed at the root by moving the table panel out of the editable IR root (the interim undo-snapshot patch was removed) · **Impact:** 🟠 med-high
(silent input loss right after the most common editing command, in the DEFAULT mode) · **Origin:** found by the
lead while verifying task 530's undo behaviour (2026-10-07); pre-existing, unrelated to task 530.

## Problem

In IR mode, undo something and type: the typed text never appears and never reaches the document. WYSIWYG is fine.
It is not specific to Shift+Enter — undoing plain typing shows the same loss.

## Measured (real VS Code, 2026-10-07, `abcd\n\nsecond\n`, caret at `ab|cd`, type `X`, Ctrl+Z, type `Y`)

| step | IR | WYSIWYG |
|---|---|---|
| after `X` | caret `"abX"@3`, inside the editor; DOM contains `<div id="fix-table-ir-wrapper" contenteditable="false" …>` after the paragraphs | caret `"abX"@3` |
| after Ctrl+Z | document reverted correctly; **caret `DIV@0`, NOT inside the editor root** (`inRoot=false`); the editor's innerHTML **no longer contains `#fix-table-ir-wrapper`** | caret `"ab"@2` inside the editor |
| after `Y` | DOM unchanged, `Y` lost; saved file `abcd` | `abYcd`, saved |

Focus stays on the editor (`document.activeElement` = `PRE.vditor-reset`, `document.hasFocus()` true) in both
modes — the selection, not focus, is what is lost.

Ctrl+Z goes through `media-src/src/editing/undo-keybind.ts` → `vditor.undo.undo(inner)` (Vditor's own engine, the
same call as the toolbar button).

## Hypothesis (to confirm, not yet proven)

Our floating table-edit panel `#fix-table-ir-wrapper` (`media-src/src/editing/fix-table-ir.ts`) lives INSIDE the IR
editable root. Vditor's undo restores the root's innerHTML from its snapshot (which does not contain the wrapper, or
contains a stale one), then restores the caret from the `<wbr>`/range it recorded. The caret ends up anchored on a
DIV outside the root — plausibly the detached wrapper, or a range computed against the pre-undo child list. See also
memory "EOF caret jump = fix-table-ir-wrapper" and `trailing-paragraph.ts:128-136`, `esbuild-shared.mjs:505` for
earlier wrapper-in-the-block-chain problems.

## Root cause (measured, 2026-10-07)

The wrapper hypothesis was right, but the mechanism is the INITIAL undo snapshot, not the undo restore of the
current state. `Undo.recordFirstPosition` stamps the caret (`<wbr>`) into undoStack[0] only if the live snapshot
text equals it. `#fix-table-ir-wrapper` is appended inside the IR root on the first click; whether it was already
in the DOM when the one-time initial snapshot was taken is a timing coin-flip (real VS Code: ~25-50% of runs,
which is why a first attempt was green). When the snapshot lacks the wrapper but the live text has it, the
comparison fails, state 0 keeps no `<wbr>`, and undoing back to it hits `renderDiff`'s "no wbr" fallback
(`range.setEndBefore(element); collapse(false)`) -> selection anchored on the surrounding `DIV` (before the
`<pre>`), so the next key is lost. Measured after undo: failing runs = `DIV@0`, wrapper gone; passing runs =
`#text@2`, wrapper present (it was baked into the snapshot).

## Fix (root-cause version)

First shipped as an undo-snapshot strip (`patchUndoSnapshotExcludeTablePanel`) — a symptom patch. The root
fix: `#fix-table-ir-wrapper` is no longer inside the editable root. `fix-table-ir.ts` mounts it as a sibling
inside the `.vditor-ir` container (`position: relative`), places it with `getBoundingClientRect` against that
container, and re-places it on the `<pre>`'s `scroll` event (the `<pre>` is the scroller; the panel is hidden
while its cell is out of view).

Special cases that existed only because of the panel, removed (each proved dead — suites green without them):
the undo-snapshot strip patch (+ unit tests); `isHelper` and all its consumers in `trailing-paragraph.ts`,
`gap-boundary.ts`, `gap-paragraph.ts` (incl. two "caret fell into the helper" recovery branches) and their
unit tests; the wrapper filters in two real-VS-Code specs. KEPT: the `contenteditable=false` splice clause of
the arrow-nav patch (esbuild-shared.mjs) — not dead, the rendered HTML-comment preview (`.vmarkd-comment`,
contenteditable=false) is another user; only its comment was rewritten.

Specs: `ir-undo-then-type.spec.ts` (IR red 5/5 with the panel back inside the root and no strip; green 5/5
with the relocation and no strip), `table-panel-placement.spec.ts` (outside the root, follows its cell through
a scroll, buttons act).

## Steps

- [x] Real-VS-Code RED spec: IR, type, Ctrl+Z, type → the second keystroke must land at the undo caret and reach the
      saved file; WYSIWYG control. Also redo (Ctrl+Y / Ctrl+Shift+Z) then type.
- [x] Find the root cause (where the caret goes and why): Vditor `undo/index.ts` renderDiff + caret restore in IR,
      the wrapper's place in the snapshot, the selection after the innerHTML swap.
- [x] Fix at the right layer (likely keep the wrapper out of the editable root or out of the undo snapshot / restore
      path), not a symptom patch; red-green-red.
- [x] Unit + chromium harness coverage where possible; full gates.

## Regression (2026-10-08)

`escape-toolbar.spec.ts` (leg 4: Escape, then Ctrl+Tab must not mutate the document) went red 3/3 from this task's
commit on. NOT a stale undo snapshot: probes showed the undo chain restored the baseline correctly, and the tab
appeared only on the Ctrl+Tab keydown itself (`keydown:Tab+ctrl`). Cause: Vditor's Tab handlers (`fixTab`, table cell
hop, list indent) test `event.key === "Tab"` and ignore modifiers, so Ctrl/Alt/Meta+Tab (a VS Code / OS chord whose
keydown still reaches the webview) typed a literal `\t`. It was latent: before this task the caret after undo sat on a
DIV outside the editable root (the very bug fixed here), so the stray insert had nowhere to land and the spec passed by
accident. The fix made the caret correct, which unmasked a real product bug (Ctrl+Tab in the editor inserted a tab while
VS Code switched tabs).

Fix: build patch `patchModifiedTabPassthrough` (esbuild-shared.mjs, `editorCommonEvent.ts`) returns early from the
editor keydown listener for a Tab with ctrl/meta/alt, before any mode handler; bare Tab and Shift+Tab are unchanged.
Tests: unit (`vditor-source-patches.test.ts`), chromium (`tab.spec.ts` Control/Alt/Meta+Tab), real VS Code
(`escape-toolbar.spec.ts` 5/5; red again with the patch removed).
