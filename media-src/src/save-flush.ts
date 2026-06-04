// Ctrl/Cmd+S flush (task 58).
//
// Webview edits are debounced before being posted to the host (see pending-edit.ts).
// `save` is a host-side command — nothing in the webview flushes the pending edit
// before it runs, so a save fired inside the debounce window persists stale content.
// We intercept the save shortcut in the CAPTURE phase (same precedent as
// undo-keybind.ts: VS Code's preload forwards keys to the host from a bubble-phase
// listener, so a capture-phase handler runs first), flush the pending edit, then —
// unlike undo — let the event continue so VS Code's native save still fires.
import { isMac } from './platform'

// Pure predicate: is this keydown a Save (Ctrl+S on Windows/Linux, Cmd+S on mac)?
// Save-As (adds Shift) also persists, so flushing there is correct too. Alt-combos
// are excluded — they're never a plain save. Side-effect-free for unit testing.
export function isSaveShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  mac: boolean,
): boolean {
  const saveMod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey
  if (!saveMod || event.altKey) return false
  return event.key.toLowerCase() === 's'
}

// Wire the capture-phase keydown listener. On a save shortcut, run `flush` and then
// allow the event to propagate unchanged (no preventDefault / stopPropagation) so
// VS Code's save still runs — we only need our flush to happen first.
export function setupSaveFlushKeybind(
  win: Window & typeof globalThis,
  flush: () => void,
): void {
  const onMac = isMac(win.navigator)
  win.addEventListener(
    'keydown',
    (event) => {
      if (!isSaveShortcut(event, onMac)) return
      flush()
      // Deliberately do NOT preventDefault / stopPropagation: let VS Code save.
    },
    true, // capture phase — flush before VS Code's bubble-phase key forwarding
  )
}
