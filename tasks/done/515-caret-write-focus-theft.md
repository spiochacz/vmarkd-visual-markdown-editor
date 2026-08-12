# Task 515 — Can an armed caret intent steal focus from host UI? (investigation)

**Status:** ✅ CLOSED (2026-08-13) — **measured, no product change**. The premise was wrong. ·
**Impact:** ⚪ none shipped · **Origin:** the "known residual" flagged when task 514 shipped

## The claim under test

Task 514's recorder showed a `focusin` on the editable dispatched **synchronously from inside**
`caret.ts`'s `tryPlace` — a `Selection.addRange()`, with no `.focus()` call in the stack. From that
I inferred a residual: an intent armed within ~5 s before the find widget opens could keep pulling
the keyboard back into the webview, because ADR-0007's loop re-writes the Range every animation
frame.

## What was measured

Real VS Code, `find-widget-focus.spec.ts`, with the find widget open and the host find INPUT
holding focus. An intent was armed from inside the frame through the production bridge
(`window.__vmarkdRequestCaret({ textOffset })`), then sampled after ~1 s (≈60 loop ticks), with the
caret side **ungated**:

| observation | value |
|---|---|
| `__vmarkdRequestCaret(...)` returned | `true` (the write happened) |
| frame `getSelection().rangeCount` | 1, anchored in a text node |
| frame `document.activeElement` | `BODY` — the write did **not** focus the editable |
| frame `document.hasFocus()` | `false` |
| host `document.activeElement` | `INPUT.input` — the find box **kept** focus |

So the focus move a Range write causes is **intra-document, and only when the document already
holds focus**. An unfocused frame cannot take the keyboard back this way. Task 514's `focusin` from
inside `tryPlace` happened *after* `focus-restore.ts` had already called `editor.focus()` — the
frame had focus at that moment, which is what let the write move it inside the document. The
cross-frame steal was `editor.focus()` alone, and task 514 already closed it.

## Outcome

- **No product change.** A gate on the caret authority's write path (`documentWasBlurred &&
  !document.hasFocus()`) was implemented, unit-tested and then **reverted**: with the gate removed
  the e2e leg above still passes, so the gate guarded a defect that does not exist, at the price of
  new state in ADR-0007's state machine and a doc addendum asserting a mechanism that is not true as
  stated.
- **Kept:** the e2e leg itself, in `find-widget-focus.spec.ts`, relabelled as what it is — a pin on
  the invariant ("arming an intent while the find widget holds focus does not disturb it"), not a
  regression test for a bug. It passes with or without any caret-side gate.
- **Corrected:** the memory note `addrange-contenteditable-steals-focus` now states the scope (the
  write focuses the editable only when the document already holds focus; it is not a cross-frame
  steal).

## If this ever comes back

The discriminator is cheap: with the widget open, arm an intent from the frame and read the HOST
`document.activeElement`. Anything other than the find input means the write moved focus across
frames after all, and the gate above (kept in this task's history) is the fix to restore.
