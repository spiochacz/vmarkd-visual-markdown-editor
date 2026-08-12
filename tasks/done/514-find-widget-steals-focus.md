# Task 514 — Ctrl+F: the search box loses focus as soon as a match is found

**Status:** ✅ DONE (2026-08-12) — red→green proven in real VS Code. · **Impact:** 🔴 high (the rest
of the query is typed INTO the document) · **Origin:** user report 2026-08-12 ("jak robię ctrl-f i
wyszukuję i w dokumencie znajdzie się wyraz to search box traci focus")

## What was wrong

Ctrl+F opens VS Code's webview find widget (`editor.action.webvieweditor.showFind`, bound in
package.json). Typing a query that MATCHES text in the document moved focus out of the find box and
into the editor — so the remaining keystrokes went to the contenteditable instead of the search
field.

Measured in real VS Code with a focus recorder installed inside the webview frame (`focusin` /
`focusout` / window `focus`/`blur` / `keydown`, each entry carrying the JS stack — focus events
dispatch synchronously, so the stack names whoever called `.focus()`). Typing `b`, `r`, `a`, `v`,
`o` into the widget and sampling the HOST document's `activeElement` after each keystroke:

| keystroke | host `activeElement` (before the fix) |
|---|---|
| `b` (no match yet) | `INPUT.input` |
| `r` (**first match**) | `IFRAME.webview.ready` ← focus is in the webview |
| `a` | `INPUT.input` (VS Code puts it back) |

The chain, from the recorder (timestamps are one run, frame-local):

1. `t+0 ms` — activating the match makes Chromium hand the webview FRAME window a `focus` event.
   VS Code's find widget drives Electron's `findInFrame` against that frame. Stack: listener only —
   **browser-initiated, not ours**.
2. `t+4 ms` — the frame gets `blur` straight back: the host's find INPUT is what the user is
   typing into. Focus was only ever transiently in the frame.
3. `t+9 ms` — `focus-restore.ts`'s window-`focus` listener fires its deferred (rAF)
   `restoreEditorFocus`, sees `activeElement === BODY` (its task-389 tab-return signature), and
   calls `editor.focus()`. **That is the steal** — the find box is blurred by it.
4. It also arms `caret.ts`'s re-assert loop (`requestCaret`). The loop's next tick re-writes the
   Range, and a `Selection.addRange()` into a contenteditable focuses that element too — so the
   frame kept taking focus back for a further ~5 s. Confirmed in the recorder: a `focusin` on
   `PRE.vditor-reset` dispatched synchronously from inside `tryPlace`.

Step 3 is the root cause; step 4 is its consequence and disappears with it.

## Fix

`media-src/src/editing/focus-restore.ts` — the window-`focus` path now bails when the document does
not actually hold focus one frame later:

```ts
if (e.isTrusted && !win.document.hasFocus()) return
```

`hasFocus()` is the discriminator: a real tab return (task 389 — the reason this module exists)
still has it `true` a frame later; a find-match activation does not, because the frame already gave
focus back. The `isTrusted` guard keeps the e2e harness alive — `caret-on-open.spec.ts` dispatches a
SYNTHETIC `window.dispatchEvent(new Event('focus'))` because the harness never grants a
freshly-opened editor real OS focus, and there `hasFocus()` never flips true.

The `focusout` path already had its own unconditional `hasFocus()` guard (task 445) — untouched.

## Verification

- L1 `media-src/src/editing/focus-restore.test.ts` — two cases: trusted focus + no OS focus does
  NOT restore; untrusted focus + no OS focus still DOES (the harness path). Red without the gate.
- L3 `test/vscode-e2e/find-widget-focus.spec.ts` (in the FAST tier, ~13 s) — opens the find widget,
  types a matching query one character at a time, and asserts the host `activeElement` is still the
  find input after EVERY keystroke plus Enter (find-next), and that the document text is unchanged.
  Per-keystroke on purpose: the loss is transient, so a single check after the whole query passes
  against the bug. Measured 3/3 green with the fix, 0/2 (fails on retry too) without it.
- Regression: `caret-tab-return.spec.ts`, `caret-on-open.spec.ts`, `caret-empty-typing.spec.ts`,
  `escape-toolbar.spec.ts` — the specs that drive this module.

## The residual that turned out not to exist

Shipping this, I flagged a residual: `caret.ts`'s armed intent re-writes the Range for up to ~5 s,
and each write focuses the contenteditable — so an intent armed shortly before the find widget opens
looked like it could steal the keyboard again. **Measured and disproved** — see
[task 515](515-caret-write-focus-theft.md). A Range write moves focus only *inside* a document that
already holds it; with the find widget owning the keyboard the write lands and the find input keeps
focus. Step 4 above happened only because step 3 had already focused the frame. No caret-side gate
was shipped.
