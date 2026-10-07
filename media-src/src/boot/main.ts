import './preload'
import type { InitPayload } from './init-payload'
import { logToHost } from '../util/webview-log'

import { fixLinkClick } from '../links/link-click-fix'
import { installClipboardLine } from '../clipboard/clipboard-line'
import { installCodeCopy } from '../clipboard/code-copy'
import { fixCut } from '../util/utils'

import {
  applyVditorTheme,
  initVditor,
  renderCacheThemeKey,
} from './vditor-init'
import { applyBodyOptions, swapStyle, initOnlyChanged } from './live-config'
import { sessionState } from './editor-session-state'
import {
  configureMessageRouter,
  handleUpdate,
  installMessageRouter,
  markInlineInited,
} from '../bridge/message-router'
// Vditor's index.css is NOT bundled here. The host links the COPIED media/vditor/dist/index.css
// (html-builder.ts) — the same single copy the harness and HTML-export load — so build.mjs
// patchVditorIndexCss() (run post-sync) is the SOLE patch site for it. Bundling it (the old
// `import 'vditor/dist/index.css'`) pulled the UNPATCHED node_modules copy into media/dist/main.css
// → editor and harness drifted (the WYSIWYG inline-code 0-padding trap, ADR-0004). One copy = no drift.
import { isMac } from '../util/platform'
import { setupToolbarDismiss } from '../chrome/toolbar-dismiss'
import { installFocusRestore } from '../editing/focus-restore'
import { installSelectedUrl } from '../links/link-url'
import { installPasteTransform } from '../clipboard/paste-transform'
import { innerVditor } from '../util/inner-vditor'
import { configureDiagramRetheme } from '../diagrams/diagram-retheme'
import {
  observeGapParagraphs,
  setupTrailingNav,
} from '../editing/gap-paragraph'
import { setupCaretScroll } from '../editing/caret-scroll'
import { setupCalloutArrowNav } from '../editing/callout-nav'
import { setupGapClick } from '../editing/gap-click'
import { setupGapNav } from '../editing/gap-nav'
import { setupHardBreakKey } from '../editing/hard-break-key'
import { setupHistoryKeybind } from '../editing/undo-keybind'
import { setupFormatHotkeyGuard } from '../editing/format-hotkey-guard'
import { setupSaveFlushKeybind } from '../bridge/save-flush'
import { installLinkOpenGate } from '../links/link-open-policy'
import { activeModeElement, blockModeElement } from '../util/source-map'
import { installEditorCaretTracking } from '../editing/editor-caret'
import {
  installCaretInvalidation,
  installCaretWindowBridge,
} from '../editing/caret'
import '../main.css'
// loaded after main.css so the VS Code-native chrome rules win on the cascade
import '../vscode-chrome.css'

// ADR-0007 / task 446 — the caret authority's "a real user gesture wins" listeners. MUST be wired
// FIRST, before anything that sets a caret intent from inside its OWN keydown handler (gap-nav.ts's
// setupGapNav, gap-paragraph.ts's setupTrailingNav, both below): same-target capture-phase
// listeners fire in registration order, so registering this one first guarantees it clears any
// STALE intent before those handlers run and set a FRESH one in the same event — never the reverse,
// which would wipe out the fresh intent immediately after those handlers set it. See caret.ts's
// installCaretInvalidation doc comment.
installCaretInvalidation()

// Task 445 — expose requestCaret to the patched Vditor undo module (esbuild-shared.mjs's
// patchUndoCaretSplitRestore), which lives outside this file's own TS module graph (ADR-0004,
// vendored source). No ordering constraint like the invalidation listeners above: the undo
// snapshot this bridges to only ever fires from an 800ms-debounced setTimeout, long after main.ts's
// synchronous top-level code (this line included) has already run.
installCaretWindowBridge()

// Snapshot the in-editor caret on selectionchange (so Reveal-in-Source survives the
// iframe focus loss); the state + restore live in editor-caret.ts. Wired once.
installEditorCaretTracking()

// Task 389: leaving the vMarkd tab and coming back leaves focus on the webview's BODY — the
// selection survives (retainContextWhenHidden) but no caret is painted and keystrokes go nowhere.
// Put focus back on the editable surface, keeping the Range that is already there. Wired once.
installFocusRestore(window)

// Reclaim transient empty "gap" paragraphs Vditor splices when arrowing between adjacent
// blocks (blockquote↔code, code↔code). Wired once; reads the active editor lazily so it
// covers every re-init. See gap-paragraph.ts.
observeGapParagraphs(() =>
  window.vditor ? (activeModeElement(window.vditor) ?? null) : null,
)

// Keep the caret visible during programmatic arrow moves (table-cell up/down sets the
// selection without scrolling). Wired once; reads the active editor lazily. caret-scroll.ts.
setupCaretScroll(() =>
  window.vditor ? (activeModeElement(window.vditor) ?? null) : null,
)

// Arrow nav INTO collapsed callouts (their source is display:none — native caret movement
// can't enter, skipped them, and at EOF dropped the selection → caret jumped to the top).
// Wired once; reads the active editor lazily. callout-nav.ts.
setupCalloutArrowNav(
  () => (window.vditor ? (activeModeElement(window.vditor) ?? null) : null),
  () => innerVditor(),
)

// The gap cursor is a BLOCK-DOM feature, so it is explicitly ir/wysiwyg only: those two render a
// CHAIN of block elements, while sv renders the markdown source and Vditor's setValue wraps the
// WHOLE document in a single `<div data-block="0">` (task 495 measured this). "The boundary between
// two blocks" therefore does not exist in sv — and worse, the rule would read that one wrapper as a
// single atomic block and splice a paragraph into the source at its edges. Measured, not theorised:
// wiring it to every mode turned four sv/split specs red in the FAST tier.
const blockSurface = (): HTMLElement | null =>
  window.vditor ? blockModeElement(window.vditor) : null

// Arrow nav across VOID boundaries: step ACROSS a `<hr>` (no text node → the native move drops the
// selection on it, stuck above a rule — task 100), and STOP in a manufactured gap paragraph where
// no caret position exists at all (task 292). Wired once; reads the active editor lazily. gap-nav.ts.
setupGapNav(blockSurface)

// Task 530: Shift+Enter in prose is a real hard line break (IR and WYSIWYG); everything else (headings,
// cells, code, math) keeps the stock behaviour. hard-break-key.ts.
setupHardBreakKey(blockSurface, () => window.vditor?.vditor)

// The same boundaries, reached with the mouse: a click that MISSED every block (the empty strip
// above a document that starts with a diagram, the few px between two rendered blocks) lands in a
// manufactured gap paragraph instead of inside the block above it. gap-click.ts (task 292).
setupGapClick(blockSurface)

// Move the caret INTO the trailing paragraph at end-of-file. The invariant (above) keeps the
// paragraph present; this actively places the caret there on ArrowDown so the native EOF move
// can't drop the selection (→ Vditor normalising it to the editor start = the jump-to-top).
// Wired once; reads the active editor lazily. gap-paragraph.ts.
setupTrailingNav(() =>
  window.vditor ? (activeModeElement(window.vditor) ?? null) : null,
)

// Close toolbar dropdowns when clicking outside them (VS Code-native menu
// behaviour; see toolbar-dismiss.ts).
setupToolbarDismiss()

// Inject the per-init state the diagram re-theme authority needs (sessionState.lastInitMsg
// options/cdn read lazily so a re-init is reflected) + the code-theme applier that also
// runs at init (vditor-init.ts). rethemeDiagrams (diagram-retheme.ts, driven from
// message-router.ts) then drives every renderer's live re-theme from the two flip sites
// (task 152 items 1+3).
configureDiagramRetheme({
  getOptions: () => sessionState.lastInitMsg?.options,
  getCdn: () =>
    sessionState.lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
  applyCodeTheme: applyVditorTheme,
})

// Task 460 phase 3 — message-router.ts no longer imports these boot-layer VALUES directly (that
// was the last remaining cross-module cycle). main.ts is the composition root: it already needs
// live-config/vditor-init/editor-session-state for its own wiring above, so it hands the same
// live bindings to message-router here. MUST run before installMessageRouter (below) and before
// the direct handleUpdate() call further down for the inline-init path — both dispatch through
// handlers that read routerDeps.
configureMessageRouter({
  applyBodyOptions,
  swapStyle,
  initOnlyChanged,
  sessionState,
  initVditor,
  renderCacheThemeKey,
})

// Wire the host→webview message listener (message-router.ts): one handler per
// `command`, keyed by the HostMessage discriminant.
installMessageRouter(window)

// Task 505 — must be installed before the first formatting keypress: blocks the browser's native
// contenteditable execCommand for the promoted FORMAT_HOTKEYS keys, which would otherwise corrupt
// the DOM ahead of the VS Code command's round trip. See format-hotkey-guard.ts's header.
setupFormatHotkeyGuard(window)

fixLinkClick()
fixCut()

// Task 385: give a collapsed Ctrl+C / Ctrl+X the current line, the way VS Code does — and stop the
// two defects that made the collapsed paths worse than useless (sv wiped the clipboard; cut ate a
// character). Must be installed before the first copy/cut; the Vditor patches call it by name.
installClipboardLine(window)
installCodeCopy(window, (message) => vscode.postMessage(message))

window.addEventListener('keydown', (event) => {
  const modifierPressed = isMac()
    ? event.metaKey && event.ctrlKey
    : event.ctrlKey && event.altKey
  if (modifierPressed && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    event.stopPropagation()
    vscode.postMessage({ command: 'edit-in-vscode' })
  }
})

// Install the link-open gate the IR/WYSIWYG Vditor patches call (task 62). The
// mode is set per-init from the config setting; this just exposes the global.
installLinkOpenGate(window)

// Task 390: let the patched IR/WYSIWYG toolbar handlers see a URL-shaped selection, so clicking the
// link button on a selected URL puts it in BOTH halves of the link instead of leaving the
// destination as the `https://` placeholder. See link-url.ts.
installSelectedUrl(window)

// Task 242: strip ANSI escape sequences out of pasted plain text before Vditor sees it. Installed
// as a window hook for the same reason as above — the patched vditor source cannot import from our
// bundle, and one global keeps the patch itself to a single line. See paste-transform.ts.
installPasteTransform(window)

// Route Ctrl/Cmd+Z·Y to Vditor's own undo engine instead of the browser/VS Code
// document undo — see undo-keybind.ts for the full rationale (task 463 measured that a
// build-time patch cannot fully replace this: it has no reach outside the editable element).
setupHistoryKeybind(window)

// Flush the debounced edit before VS Code saves, so Ctrl/Cmd+S never persists a
// stale snapshot (task 58). Capture phase + non-suppressing — see save-flush.ts.
setupSaveFlushKeybind(window, () => sessionState.editSync?.flush())

// Task 38: boot Vditor synchronously from the inlined init payload (host emits `#vmark-init` for
// non-wiki, non-huge docs) so we don't wait for the serial `ready→init` roundtrip. Set the echo-guard
// AFTER the init runs (so this first call isn't itself skipped) via markInlineInited; fall back to
// `ready→init` if the payload is absent (wiki/large docs) or fails to parse. `ready` is still posted
// so the host runs onReady (wiki cache/watcher + the no-op init echo).
// Task 432 — record whether the host actually shipped an instant-paint teaser for THIS open, while it
// still exists (initVditor's after() removes it within ~150 ms, so a later DOM query can't tell "never
// emitted" from "already swapped"). The host omits it whenever its own Lute isn't warm yet
// (lute-host.ts renderForMode → prewarmLute, `setTimeout(0)`), which is precisely the race this flag
// exists to observe: the FIRST open of a session may be the one that gets no masking at all. Read by
// prerender-first-open.spec.ts; two assignments, no cost.
;(window as any).__vmarkdHadTeaser =
  !!document.getElementById('vmarkd-prerender')

const inlineInitEl = document.getElementById('vmark-init')
if (inlineInitEl?.textContent) {
  try {
    const payload = JSON.parse(inlineInitEl.textContent) as InitPayload
    handleUpdate({ command: 'update' as const, ...payload })
    markInlineInited(payload.content)
  } catch (err) {
    logToHost(
      `[main] inline init failed, falling back to ready→init: ${String(err)}`,
    )
  }
}

vscode.postMessage({ command: 'ready' })
