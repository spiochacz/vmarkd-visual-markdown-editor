// Task 532 step 5a — the editor mode a document OPENS in, as ONE rule for both trees.
//
// The host paints the instant-paint overlay in a mode (markdown-editor-provider.ts) and the webview
// boots Vditor in a mode (media-src/src/boot/vditor-options.ts). When the two disagreed — a
// `vmarkd.editor.defaultMode: wysiwyg` user whose last session ended in IR got an IR overlay and a
// WYSIWYG editor — the whole document re-laid-out at the swap. Both sides now call this function.
//
// Precedence: a configured default (already resolved host-side: setting + defaultModeByGlob) wins
// over the mode the previous session ended in; with no default (`undefined` = "remember") the saved
// mode is used; with neither, `ir`. `preview` is not a Vditor mode — it boots IR and toggles the
// Preview overlay after init (vditor-init.ts), so the overlay and the editor both start as IR.

import type { OpenMode } from './protocol'

export type EditorMode = 'ir' | 'wysiwyg' | 'sv'

const isEditorMode = (m: unknown): m is EditorMode =>
  m === 'ir' || m === 'wysiwyg' || m === 'sv'

// Only stream documents above this size. Streaming spreads Lute's render across
// frames, but each per-frame append forces the browser to re-lay-out the growing
// (4000-block) editor — an O(n²) reflow that dominates wall-clock. Measured in a
// real Chromium on a 326 KB doc: monolithic ~2.5 s vs streaming ~4.9 s (and in the
// VS Code webview, ~0.7 s vs ~14 s once the 1.123 update started freezing the whole
// window). The MONOLITHIC Lute render is ~0.9 s either way (old/new engine alike —
// the task-66 upgrade did NOT speed it up; it's the streaming reflow that's the
// problem). So chunking is net-negative until docs are genuinely huge. Threshold
// raised from 100 KB accordingly. (Streaming's O(n²) reflow remains an open perf
// issue — see task 49.)
// A document longer than this streams in chunk by chunk (task 49) and always boots IR (task 187): the
// webview forces IR for it, so the host overlay must paint IR too. Moved here from stream-render.ts so
// both trees share the number.
export const STREAM_MIN_CHARS = 700_000

/** Does a document of `docChars` stream? `streamLargeFiles` is the `performance.streamLargeFiles` setting. */
export const shouldStream = (
  docChars: number,
  streamLargeFiles: boolean | undefined,
): boolean => streamLargeFiles !== false && docChars > STREAM_MIN_CHARS

/**
 * `streamed` (see `shouldStream`) pins the result to IR: the streamed open writes into the IR pane
 * whatever the configured/saved mode is.
 */
export function resolveOpenMode(
  savedMode: string | undefined,
  defaultMode: OpenMode | undefined,
  streamed = false,
): EditorMode {
  if (streamed) return 'ir'
  if (defaultMode) return defaultMode === 'preview' ? 'ir' : defaultMode
  return isEditorMode(savedMode) ? savedMode : 'ir'
}
