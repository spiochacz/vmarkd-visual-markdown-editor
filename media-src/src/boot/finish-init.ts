import type { InitPayload } from './init-payload'
import type { Disposables } from '../util/disposables'
import { innerVditor } from '../util/inner-vditor'
import { activeModeElement, blockModeElement } from '../util/source-map'
import { fixResponsiveTables } from '../chrome/responsive-tables'
import { handleToolbarClick } from '../chrome/toolbar-actions'
import { guardToolbarScroll } from '../chrome/toolbar-scroll-guard'
import { fixTableIr } from '../editing/fix-table-ir'
import { setupOutlineFlash } from '../nav/outline'
import { installOutlineKeyboard } from '../nav/outline-keyboard'
import { setupOutlineResize } from '../nav/outline-resize'
import { installPreviewMorph } from '../editing/preview-morph'
import { reportEditorMode } from '../chrome/toolbar-actions'
import { setupSplitScrollSync } from '../nav/split-scroll-sync'
import { setupPreviewScrollPreserve } from '../nav/preview-scroll-preserve'
import { observeCaretLink } from '../links/caret-link-decorate'
import { type ObserveContext, observeDecorators } from './content-decorators'
import type { WebviewMessage } from '../../../src/shared/protocol'
import {
  ensureHljsLoaded,
  wrapLuteFlatten,
} from '../editing/wysiwyg-code-highlight'
import { observeTrailingParagraph } from '../editing/gap-paragraph'
import { installDiagramZoomGate } from '../diagrams/diagram-zoom-gate'
import { installGatedDiagramZoomKeys } from '../diagrams/diagram-zoom-keys-gated'
import { installListBackspace } from '../editing/list-backspace'
import {
  installEscapeToolbar,
  refreshToolbarRoving,
} from '../editing/escape-toolbar'
import { installToolbarOverflow } from '../chrome/toolbar-overflow'
import { installToolbarSubmenuAria } from '../chrome/toolbar-submenu-aria'
import { installCalloutPopoverKeys } from '../editing/callout-popover-keys'
import { installFormatWordExpand } from '../editing/format-word-expand'
import { installDiagramRuntime } from '../diagrams/diagram-runtime'
import { disposeDiagramRethemeGate } from '../diagrams/diagram-retheme'
import { installEditActivity } from '../editing/edit-activity'
import { placeInitialCaret } from '../editing/initial-caret'
import { installDblclickWordSelectFix } from '../editing/dblclick-word-select'

interface FinishInitDeps {
  /** The shared observer registry — every observer below registers through it so a
   *  re-init disposes the previous instance (task 152 item 2). */
  observers: Disposables
  /** Resolved Vditor asset cdn (for the lazy hljs load). */
  cdn: string
  /** Post the active large-doc helper set to the host (status-bar marker). */
  reportDocMode: () => void
}

// Non-visual editor wiring that needs the fully-built editor DOM (task 152 item 1,
// extracted from main.ts). Runs once per (re-)init — for the streaming path, only after
// the whole document is streamed in. main.ts owns the editor instance + the observer
// registry + the edit-sync controller; they're injected via deps.
export function runFinishInit(msg: InitPayload, deps: FinishInitDeps): void {
  const { observers, cdn, reportDocMode } = deps
  handleToolbarClick()
  guardToolbarScroll(window.vditor)
  fixTableIr()
  fixResponsiveTables()
  if (msg.options?.outlineHighlight !== false) {
    setupOutlineFlash(window.vditor)
  }
  {
    const oel: HTMLElement | undefined = innerVditor()?.outline?.element
    if (oel) {
      const pos = msg.options?.outlinePosition === 'left' ? 'left' : 'right'
      setupOutlineResize(oel, pos, (w) =>
        vscode.postMessage({ command: 'save-outline-width', width: w }),
      )
    }
  }
  // Task 458 (outline panel keyboard operability): role="tree"/"treeitem" + roving tabindex +
  // ArrowUp/Down/Left/Right + Enter/Space on the outline items — the resize handle's own keyboard
  // support is wired above, inside setupOutlineResize itself.
  observers.set('outline-keyboard', installOutlineKeyboard(window.vditor))
  // Task 187: must be installed before the first preview.render (sv entry / Preview
  // toggle) — the patched vditor render consumes window.__vmarkdMorphPreview.
  installPreviewMorph()
  // Task 187: seed the status-bar mode label (a persisted sv/wysiwyg mode reopens
  // directly in that mode, so the label must not assume the default).
  reportEditorMode()
  setupSplitScrollSync()
  // Preserve scroll position when toggling edit (IR/WYSIWYG) ↔ full Preview overlay.
  setupPreviewScrollPreserve()
  const app = document.getElementById('app')
  const previewEl = innerVditor()?.preview?.previewElement
  // Debounce diagram re-render while typing in a diagram's source (task 161 step 1): arms a quiet-timer
  // on every editor input and exposes window.__vmarkdDeferIrDiagramRender for the patched ir/input.ts
  // processCodeRender loop (Vditor-native engines) — observeCustomDiagrams (d2/…) consults the same gate.
  observers.set('edit-activity', installEditActivity(app))
  // Task 532 step 4: wrapLuteFlatten MUST precede the wysiwyg-highlight observer (it makes our hljs
  // token spans invisible to Lute — it reparses the wysiwyg source every keystroke + on getValue — so
  // the highlighted edit surface round-trips byte-clean). Idempotent per Lute.
  wrapLuteFlatten(window.vditor)
  // Every content decorator (callouts, soft breaks, code refs, diagram zoom, html comments, code
  // source tagging, WYSIWYG live highlight) is a registry entry (content-decorators.ts) — the same
  // list the instant-paint overlay is decorated from, so a decorator cannot reach one stage and miss
  // another. The edit pass binds to the STABLE `#app` mount, NOT activeModeElement (runFinishInit runs
  // once, but the user can switch to WYSIWYG and Preview toggles can replace a mode's editor element —
  // a mode-specific observer then dies); each entry's own doc says why it is bound where it is. The
  // preview pass gives the full Preview pane its own instances (a separate DOM tree Lute re-renders
  // wholesale, which `#app`'s observer never sees). Registry keys: `<name>` / `preview-<name>`.
  const post = (m: WebviewMessage) => vscode.postMessage(m)
  const register = (key: string, dispose: () => void) =>
    observers.set(key, dispose)
  const decoratorCtx: ObserveContext = {
    app,
    previewEl,
    activeMode: activeModeElement(window.vditor),
    blockMode: () => blockModeElement(window.vditor),
    post,
    getHljs: () => (window as any).hljs,
  }
  observeDecorators('edit', decoratorCtx, register)
  observeDecorators('preview', decoratorCtx, register)
  // Task 457 — caret-targeted link activation (Ctrl/Cmd+Enter, link-click-fix.ts): paint
  // `data-caret-inside` on whatever link-like element (wiki chip, code ref, plain `[text](url)`)
  // the caret currently sits in. Bound to #app only, NOT previewEl — the read-only Preview pane has
  // no caret, so there's nothing for this to track there.
  observers.set('caret-link', observeCaretLink(app))
  // Task 391's `tight-lists` repair observer was RETIRED here by task 461: its only measured trigger
  // (Backspace at the start of a nested item merging into the parent and leaving a lone `<p>`) is now
  // prevented upstream by task 462's `patchFixListOutdent`, which routes every nested case through
  // `listOutdent` — a path that never block-wraps. Nothing left to repair, so the per-mutation
  // observer is gone rather than kept as a no-op.
  // Eager-load hljs for WYSIWYG live code highlighting so it downloads IN PARALLEL with the diagram
  // engines from the start. addScript appends an async <script> — this does NOT block first paint.
  // Do NOT defer it to requestIdleCallback (task 145 item 1 tried that, REVERTED 2026-06-28): on a
  // diagram-heavy doc the main thread stays busy (D2 wasm compile ~470 ms, mermaid/echarts), so the
  // idle callback starves for seconds and code colouring loads LAST, behind the diagrams ("in
  // sequence"). The wysiwyg-highlight observer reads window.hljs lazily; IR code is highlighted by
  // Vditor's own lazy hljs load too.
  // ensureHljsLoaded never rejects (it catches internally, see wysiwyg-code-highlight.ts) — `void`
  // marks this fire-and-forget deliberately, not an oversight (task 482).
  void ensureHljsLoaded(cdn).then(() =>
    // Nudge the highlighter once the script lands, in case a code block is already focused + idle.
    document.dispatchEvent(new Event('selectionchange')),
  )
  // Trailing-paragraph invariant: a document ending with a block (callout/code/table/…)
  // always offers an empty paragraph below it — without one there is NO caret position
  // after the last block (arrow-down at EOF dropped the selection → caret+view jumped to
  // the top). Tag is serializer-invisible; survives IR rebuilds via its own observer.
  // Block modes only: sv saves its pane's `textContent`, so a manufactured `<p>` (ZWSP seed) in the sv
  // pane landed in the file as "\n\n<ZWSP>\n" on every edit — sv has no "below the last block" to
  // escape to, the pane IS the source.
  // Stable #app + lazy block-mode getter: follows a live mode switch, stays off in sv.
  observers.set(
    'trailing',
    observeTrailingParagraph(app, () => blockModeElement(window.vditor)),
  )
  // Task 439: place the caret at offset 0 of the first block on open (Vditor's own init leaves NO
  // selection at all — see initial-caret.ts). Run AFTER observeTrailingParagraph: its install call
  // (`run()` at the end of observeTrailingParagraph) mutates the editor's DOM synchronously, so
  // placing the caret first would risk resolving the TreeWalker before that settles.
  placeInitialCaret(window.vditor)
  // Ctrl-to-interact gate for the zooming diagrams (markmap + ECharts mindmap): plain wheel scrolls
  // the page, Ctrl+wheel zooms, Ctrl+drag pans. Document-level + idempotent.
  installDiagramZoomGate()
  // Task 459: `+`/`-`/`0` keyboard zoom for the gated diagrams (markmap/mindmap/geojson/topojson),
  // once installDiagramZoomGate's Ctrl+mousedown branch above has focused one.
  observers.set('gated-diagram-zoom-keys', installGatedDiagramZoomKeys())
  // Tasks 428/525: list-item Backspace (start of text → outdent/lift, empty item → back to the line
  // above), Tab/Shift+Tab anywhere in the item, and a typed marker converting an empty item — like a
  // real editor, instead of Vditor's text-merge / "\n\n" branches.
  observers.set(
    'list-backspace',
    installListBackspace(() => innerVditor()),
  )
  // Task 456 (WCAG 2.1.2 keyboard trap): Tab can never leave the editable surface today because
  // `tab: '\t'` makes Vditor preventDefault every Tab. Escape arms a one-shot "next Tab leaves"
  // flag instead of weakening that setting; ships with role="toolbar" + roving tabindex on the
  // toolbar so the destination is actually reachable/traversable by keyboard too.
  observers.set('escape-toolbar', installEscapeToolbar())
  // Task 506: a collapsed caret inside a word + Ctrl+B/I/D (or the matching toolbar click) wraps
  // THAT WORD instead of inserting open markers at the caret — capture-phase click word-expansion
  // in front of Vditor's MenuItem handler, uniform across the hotkey and toolbar paths.
  observers.set('format-word-expand', installFormatWordExpand())
  const toolbarEl = innerVditor()?.toolbar?.element
  if (toolbarEl) {
    observers.set(
      'toolbar-overflow',
      installToolbarOverflow(toolbarEl, refreshToolbarRoving),
    )
    // Task 492 Phase 5: aria-haspopup/aria-expanded + menu semantics for the toolbar's other three
    // submenu triggers (more's own H-subset wiring lives inside installToolbarOverflow above).
    observers.set('toolbar-submenu-aria', installToolbarSubmenuAria(toolbarEl))
  }
  // Task 459: Ctrl/Cmd+Alt+Enter (caret inside a WYSIWYG callout) focuses the callout popover's
  // type/title controls — Tab can't reach them (same trap as above; the popover is a SIBLING of the
  // contenteditable, not inside it, so Tab-trapping doesn't even apply, but there's still no in-editor
  // Tab stop to LEAVE from). Escape from inside the popover returns focus + caret to the editor.
  observers.set('callout-popover-keys', installCalloutPopoverKeys())
  // Task 404: the runtime installer preserves the prior ECharts→SMILES→cache→custom→
  // Markmap→ABC→mindmap→Mermaid sequence while making the synchronous cache-before-render
  // contract structural and registering every teardown through Disposables.
  installDiagramRuntime({
    app,
    win: window,
    observers,
    postCacheMessage: (message) => vscode.postMessage(message),
  })
  // Task 412 — tear down the shared viewport-gate IntersectionObserver diagram-retheme.ts's
  // reThemeMono/reRenderEcharts/reThemeGeoAndD2 use, on every re-init — same lifecycle as mermaid's
  // own defer observer (installDiagramRuntime's mermaid adapter, above): a re-init rebuilds Vditor's
  // DOM, and any node the observer still tracked from the OLD tree would otherwise leak (observed
  // forever, never intersecting once detached). Registered directly here, not through
  // installDiagramRuntime's per-lang adapter table — this gate is shared across several engines, not
  // owned by one lang.
  observers.set('diagram-retheme-gate', undefined)
  observers.set('diagram-retheme-gate', disposeDiagramRethemeGate)
  // Task 485 — trim a double-click word selection's trailing whitespace (Windows Chromium only
  // over-selects it). document-level, not #app/previewEl: see dblclick-word-select.ts's header.
  observers.set('dblclick-word-select', installDblclickWordSelectFix())
  reportDocMode()
}
