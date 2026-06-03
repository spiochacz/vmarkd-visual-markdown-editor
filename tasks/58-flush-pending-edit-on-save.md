# Task: Flush the debounced edit on Ctrl/Cmd+S (avoid saving stale content)

> **Status:** ⬜ Not started.
> **Source:** `GongXunSS/vditor` (`feat-vscode`) — `handlerHistoryEvent` force-flush on ^s/^x/^v. See `out/vditor-co-aplikuje-raport.md` §1.3.
> **Value / Risk:** 🟢 fixes a real save-correctness bug / low (reuses the existing capture-phase keybind pattern)

## Problem
Webview edits are debounced 250ms before being posted to the host: `media-src/src/main.ts:459-469` (`input()` → `setTimeout(() => postMessage({command:'edit', …}), 250)`). There is **no** Ctrl/Cmd+S interception in the webview — `save` is a host command (`src/extension.ts:719-722`, `onSave`), and nothing flushes the pending `inputTimer` before the save runs.

Result: a Ctrl+S issued within 250ms of the last keystroke can **save stale content** (the debounced `edit` hasn't fired yet, so the host document is one beat behind the editor).

`media-src/src/utils.ts:241-252` (`fixCut`) only defers `execCommand('delete')` to dodge a recursive-exec error — it does **not** flush render or post the latest value.

## Goal
Ctrl/Cmd+S always persists the current editor content — never a stale snapshot.

## Steps
1. Factor the debounced post in `media-src/src/main.ts` so the pending edit can be flushed synchronously: extract a `flushPendingEdit()` that clears `inputTimer` and posts `{command:'edit', content: vditor.getValue()}` immediately (no-op if nothing pending).
2. Add a capture-phase `keydown` listener for Ctrl/Cmd+S, following the **exact pattern** in `media-src/src/undo-keybind.ts` (`setupHistoryKeybind`: capture `true`, mac = Cmd vs Ctrl). On match: `flushPendingEdit()`, then **let the event continue** so VS Code's native save still runs (do NOT `stopImmediatePropagation` here — unlike undo, we want VS Code to handle the save; we only need our flush to run first in capture phase).
   - Verify ordering: capture-phase listener fires before VS Code's host forwarding, so the `edit` message is enqueued before `save`. If host-side ordering is racy, alternatively post a single `{command:'save-now', content}` and have the host write that content directly in `onSave`.
3. (Optional, from the fork) also flush on cut/paste (^x/^v) if those exhibit the same staleness — verify first; cut already partially handled by `fixCut`.

## See also
- `media-src/src/undo-keybind.ts` — capture-phase keybind precedent (but that one *suppresses* the key; this one must not).
- `src/extension.ts:719-722` (`onSave`), `:967` (save handler).

## Reported upstream (related — align with this)
- Vditor **PR #1916** "fix: make undo work after recent edits" — flushes pending undo state before undo/redo (touches `ir/process.ts`, `sv/process.ts`, `editorCommonEvent.ts`, `wysiwyg/afterRenderEvent.ts`). Same "flush the debounced pending state before an action" pattern as this task's save-flush — consider a shared `flushPending()` and verify undo (our `undo-keybind.ts`) doesn't miss the latest edit either. https://github.com/Vanessa219/vditor/pull/1916

## Verify
Type a character and immediately (<250ms) press Ctrl+S: the saved file on disk contains the just-typed character. Repeat rapidly several times. Confirm normal VS Code save UX (dirty dot clears) still works and no double-write occurs.
