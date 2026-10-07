// Task 522 — "the host's find widget is open", told to the webview BY the host.
//
// MEASURED in a real VS Code: while the user types in the HOST find box, Electron's `findInFrame`
// hands this webview window brief real `focus` events, and the webview cannot tell that handshake
// from a genuine tab return by timing alone (the frame sometimes keeps focus > 60 ms with no
// `blur`). focus-restore.ts (window-focus restore → editor.focus()) and caret.ts's rAF re-assert
// loop then pull focus into the editor and the user's keystrokes land in the document. The timing
// gates added earlier (caret.ts `wouldStealFocus`, focus-restore.ts's settle window) did not move the
// real-VS-Code failure rate. The host KNOWS the find widget state, so it says so:
// `vmarkd.findOpen` / `vmarkd.findClose` (src/app/commands.ts) post `find-open` / `find-close`,
// consumed by message-router.ts. Both consumers (focus-restore.ts, caret.ts `tick`) skip while open.
//
// Cleared by `find-close` (host Escape binding) OR by the first trusted POINTERDOWN inside the
// webview document — the user is back in the document, so a stale flag (find closed some other way,
// e.g. clicking the widget's X) cannot suppress the caret/focus repair forever.
//
// Deliberately NOT keydown (MEASURED, find-widget-modes.spec.ts, ~2/9 legs): in exactly the failing
// runs the focus handshake delivered the user's find-box keystroke to the webview document, so a
// keydown listener cleared the flag mid-theft; with pointerdown only the same spec passed 8/8. The
// cost is that a keyboard-only return to the document (find closed by its X button, then Ctrl+1)
// keeps the flag until the first click or Escape — acceptable, find-close covers the Escape path.

let open = false
let removeGestureListeners: (() => void) | null = null

/** True while the host find widget is believed open and the user has not returned to the document. */
export function isHostFindOpen(): boolean {
  return open
}

/** The user is back in the document (or the host said find closed): resume normal focus handling. */
export function setHostFindClosed(): void {
  open = false
  removeGestureListeners?.()
  removeGestureListeners = null
}

/** The host opened its find widget. Idempotent; arms the "user came back" auto-clear. */
export function setHostFindOpen(doc: Document = document): void {
  open = true
  if (removeGestureListeners) return
  const onGesture = (e: Event) => {
    // Synthetic events (harness/other code) are not the user coming back.
    if (e.isTrusted) setHostFindClosed()
  }
  doc.addEventListener('pointerdown', onGesture, true)
  removeGestureListeners = () => {
    doc.removeEventListener('pointerdown', onGesture, true)
  }
}
