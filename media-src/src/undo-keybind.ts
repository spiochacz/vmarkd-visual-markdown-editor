// Keyboard undo/redo routing.
//
// We ship Vditor's toolbar undo/redo buttons, and Vditor only binds Ctrl/Cmd+Z·Y
// itself when those buttons are ABSENT (editorCommonEvent.ts:
// `!vditor.toolbar.elements.undo`). So in our editor the keys fall through to the
// browser's native contenteditable undo AND VS Code's document-level undo — the
// latter reverts the TextDocument and force-pushes a full `update` → setValue
// re-render, which makes the whole editor jump/scroll-reset. We intercept the
// keys ourselves and route them to Vditor's own diff-based undo engine (the exact
// call the toolbar button makes), then preventDefault + stopPropagation so neither
// the native nor the VS Code undo fires. Result: keyboard == toolbar button.

export type HistoryKind = 'undo' | 'redo'

// Pure mapping from a keydown to an undo/redo action (or null when it isn't a
// history shortcut). Kept side-effect-free so it can be unit-tested directly.
//   Ctrl/Cmd+Z        → undo
//   Ctrl/Cmd+Shift+Z  → redo
//   Ctrl/Cmd+Y        → redo
// On mac the primary modifier is Cmd (metaKey); elsewhere it's Ctrl. Alt is never
// part of a history shortcut (Ctrl+Alt+E is our edit-in-vscode binding).
export function historyActionFor(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
  >,
  isMac: boolean
): HistoryKind | null {
  const historyMod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey
  if (!historyMod || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !event.shiftKey) return 'redo'
  return null
}

// Invoke Vditor's own undo/redo engine — `window.vditor.vditor.undo[kind](inner)`
// — the same call the toolbar Undo/Redo buttons make. No-ops safely if Vditor (or
// its undo engine) isn't ready yet.
export function runVditorHistory(win: any, kind: HistoryKind): void {
  const inner = win?.vditor?.vditor
  inner?.undo?.[kind]?.(inner)
}

// Wire the keydown listener. `win` is the global object holding the Vditor
// instance (`win.vditor`).
//
// CRITICAL: registered in the CAPTURE phase. VS Code's webview preload installs
// its own keydown→host forwarding listener (which is what makes Ctrl+Z reach VS
// Code's `undo` command and revert the TextDocument → full setValue re-render →
// the editor jumps). That forwarding listener is on `window` in the BUBBLE phase
// and is registered before our page script runs. A bubble-phase handler of ours
// would therefore fire AFTER the forwarding already happened — too late. A
// capture-phase handler runs before ANY bubble-phase listener, so
// stopImmediatePropagation here prevents VS Code from ever seeing the key. The
// document undo never fires; only Vditor's own in-place undo runs.
export function setupHistoryKeybind(win: Window & typeof globalThis): void {
  const isMac = win.navigator.platform.toLowerCase().includes('mac')
  win.addEventListener(
    'keydown',
    (event) => {
      const kind = historyActionFor(event, isMac)
      if (!kind) return
      event.preventDefault()
      event.stopImmediatePropagation()
      runVditorHistory(win, kind)
    },
    true // capture phase — beat VS Code's bubble-phase key forwarding
  )
}
