import {
  firstShapeViolation,
  type RequiredField,
} from '../shared/message-shape'
import type { WebviewMessage } from '../shared/protocol'

// Task 148 item 3 (payload-shape validation, host side): mirrors
// `media-src/src/message-router.ts`'s `firstShapeViolation` for the OPPOSITE direction. The host's
// `onDidReceiveMessage` dispatcher (`src/editor-session.ts`'s `EditorSession.buildMessageHandlers`)
// has no runtime check that a webview→host message actually carries the fields its handler
// unconditionally reads — TypeScript's `WebviewMessage` union only checks internal callers, not
// what arrives on the wire, so a malformed or drifted message becomes a runtime shape error inside
// a handler instead of a rejection at the dispatch seam.
//
// Deliberately a standalone module rather than inline in `editor-session.ts`: that class's webview
// message dispatcher was deliberately NOT split into its own module by task 405 (too tightly
// coupled to the panel's disposables/session fields — see tasks/405-*.md; the CLASS itself did
// move out of `extension.ts` into `editor-session.ts` as that task's own final step, but the
// dispatcher method stayed inline within it), so this pure, dependency-free validator lives on its
// own and is wired in with a one-line call at the dispatch site.
//
// The field table is DELIBERATELY not "every field protocol.ts marks non-optional" — a field is
// listed only when the ACTUAL handler (`editor-session.ts`'s `buildMessageHandlers`, or a module it
// delegates to, e.g. `asset-link-actions.ts`) reads it unconditionally, with no coercion/fallback
// that already makes a missing/malformed value harmless. Fields a handler already defends
// (`Number()`, `Boolean()`, `?? ''`, `?.`) are deliberately left off — requiring them here would be
// STRICTER than the handler needs and could reject a message the handler would have handled fine.
// Verified against the real handler bodies (2026-07-28), not inferred from the type:
//   - edit / save: `onEdit`/`onSave` read `message.content` unconditionally.
//   - upload: `asset-link-actions.ts`'s `onUpload` does `message.files.map(...)` — a non-array
//     throws a TypeError inside the handler.
//   - open-link / open-wikilink: `onOpenLink`/`onOpenWikilink` do `String(message.href/target)` —
//     technically coerces without throwing, but an ABSENT field silently becomes the literal string
//     "undefined" and is then treated as a real (bogus) path/target — worth catching here, unlike
//     the true no-op coercions below.
//   - save-outline-width: `message.width` is written straight into `globalState`, no coercion.
//   - set-reflow-line-breaks: `message.value` is written straight into the user's settings.
//   - editorMode: `message.mode` is written straight into a map read back for the status-bar label.
//   - diagram-cache-get: `for (const hash of message.hashes)` throws if `hashes` isn't iterable;
//     `requestId` is echoed verbatim in the reply.
//   - diagram-render-cached: all three fields are passed straight into `diagramCache.put(...)`.
//   - save-options: `sanitizeVditorOptions(message.options)` is BUILT to tolerate any shape — no
//     required fields.
//   - docMode: `onDocMode` coerces every field (`Number()`/`Boolean()`) — nothing can crash, so
//     nothing is required even though the protocol type marks them all non-optional.
//   - log / copy-html / copy-markdown / copy-code: each already has an `?? ''` fallback before use.
//   - ready / edit-in-vscode / navigate-back / open-settings / list-wiki-pages / cursor-offset:
//     carry no payload the handler reads at all.
const REQUIRED_WEBVIEW_MESSAGE_FIELDS: Partial<
  Record<WebviewMessage['command'], RequiredField[]>
> = {
  ready: [],
  edit: [['content', 'string']],
  save: [['content', 'string']],
  'save-options': [],
  'save-outline-width': [['width', 'number']],
  docMode: [],
  editorMode: [['mode', 'string']],
  log: [],
  upload: [['files', 'array']],
  'open-link': [['href', 'string']],
  'open-wikilink': [['target', 'string']],
  'edit-in-vscode': [],
  'navigate-back': [],
  'open-settings': [],
  'set-reflow-line-breaks': [['value', 'boolean']],
  'list-wiki-pages': [],
  'copy-html': [],
  'copy-markdown': [],
  'copy-code': [],
  'diagram-cache-get': [
    ['requestId', 'string'],
    ['hashes', 'array'],
  ],
  'diagram-render-cached': [
    ['diagramId', 'string'],
    ['hash', 'string'],
    ['svg', 'string'],
  ],
  'cursor-offset': [],
}

// The TABLE is what this module owns; the check itself is shared with the webview's mirror of it.
export function firstWebviewMessageShapeViolation(
  msg: Record<string, unknown>,
  command: string,
): string | null {
  return firstShapeViolation(REQUIRED_WEBVIEW_MESSAGE_FIELDS, msg, command)
}
