import './preload'

import {
  fileToBase64,
  fixCut,
  fixLinkClick,
  fixPanelHover,
  fixResponsiveTables,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'

import { deepMerge } from './deep-merge'
import Vditor from 'vditor/src/index'
import { formatTimestamp } from './format-timestamp'
import { convertForUpload } from './image-convert'
import 'vditor/dist/index.css'
import { lang } from './lang'
import { createToolbar } from './toolbar'
import { fixTableIr } from './fix-table-ir'
import { isMac } from './platform'
import { setupCustomRenderer } from './custom-renderer'
import { patchLuteSerialize, setKnownPagesRef } from './wiki-serialize'
import { setupOutlineFlash, FLASH_CLASS } from './outline'
import { setupOutlineResize } from './outline-resize'
import { setupToolbarDismiss } from './toolbar-dismiss'
import { setupSplitScrollSync } from './split-scroll-sync'
import { findScroller, guardToolbarScroll } from './toolbar-scroll-guard'
import { preserveCaretAndScroll } from './caret-preserve'
import { streamRenderIR, STREAM_MIN_CHARS } from './stream-render'

// Lower bound for the content-visibility band (see initVditor). Its own constant —
// NOT reused from LARGE_DOC_CHARS (which gates undo-delay / incremental serialize) —
// because the layout-cost break-even is a different point from the serialize one.
const CONTENT_VIS_MIN_CHARS = 100_000
import { applyBodyOptions, swapStyle, initOnlyChanged } from './live-config'
import { applyMermaidTheme } from './mermaid-theme'
import { reRenderMermaid } from './mermaid-retheme'
import { setupHistoryKeybind } from './undo-keybind'
import { createPendingEdit } from './pending-edit'
import { createIncrementalMd } from './incremental-md'
import { setupSaveFlushKeybind } from './save-flush'
import { openLinkFromMarker } from './link-click'
import { installLinkOpenGate, applyLinkOpenSetting } from './link-open-policy'
import {
  undoDelayForContentLength,
  LARGE_DOC_CHARS,
  useIncrementalSerialize,
} from './edit-sync-tuning'
import { setBusyCursor, nextPaint } from './busy-cursor'
import {
  getCursorSourceOffset,
  activeModeElement,
  lineAndTextForOffset,
} from './source-map'
import {
  renderDiffMarkers,
  clearDiffMarkers,
  type DiffChange,
} from './diff-markers'
import './main.css'
// loaded after main.css so the VS Code-native chrome rules win on the cascade
import './vscode-chrome.css'

let applyingExtensionUpdate = false
// True while a large document is being streamed into the IR editor chunk-by-chunk
// (task 49). Like applyingExtensionUpdate, it suppresses the edit→host sync — a
// partial getValue() mid-stream would otherwise save a TRUNCATED file. The editor is
// also held read-only for the duration; both are released in streamRenderIR.onDone.
let streaming = false
// Flush of the current editor's debounced edit (task 58). Set per-init to the
// active Vditor's pending-edit controller; the global Ctrl/Cmd+S keybind calls it
// so a save inside the debounce window persists the latest content, not a stale
// snapshot. No-op before the first init.
let flushPendingEdit: () => void = () => {}
// Git-gutter diff markers for the current document (tasks 15/16). Was previously an
// undeclared implicit global — declare it properly at module scope.
let lastDiffChanges: DiffChange[] = []
// Drops the IR incremental-serialize cache (task 69) when the DOM is rebuilt wholesale
// outside the edit path (external setValue / streaming). Set in initVditor.
let invalidateIncrementalIr: () => void = () => {}
// Reports the large/normal document mode (task 69 block-count gate) to the host so it
// can show a status-bar marker. Posts only on change. Set in initVditor.
let reportDocMode: () => void = () => {}
// The last message Vditor was initialised from — used to re-init when a
// constructor-only setting (toolbar, word count, …) changes live (task 26).
let lastInitMsg: any = null

// Shared mutable knownPages set — passed to setupCustomRenderer and updated by
// the host's wiki-update message. Because the custom renderer captures the Set
// reference (not a copy), mutating it here updates chip rendering live.
const wikiKnownPages: Set<string> = new Set()

// Reveal-in-Source (task 16): remember the caret inside the editor. When the
// command runs from VS Code chrome (the toolbar button), focus leaves the
// webview iframe and the live selection collapses to the editor start — so the
// raw selection would read as offset 0. We snapshot the last in-editor caret on
// selectionchange and restore it before measuring, so the button and the command
// palette resolve to the SAME caret. Stored as a cloned Range.
let lastEditorRange: Range | null = null
function trackEditorCaret() {
  const v = window.vditor
  if (!v) return
  const editor = activeModeElement(v)
  if (!editor) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const node = sel.anchorNode
  if (!node || !editor.contains(node)) return
  // ignore a caret collapsed to the very start of the editor (the focus-loss
  // artifact we are guarding against) so it can't overwrite a real position
  if (node === editor && sel.anchorOffset === 0 && sel.isCollapsed) return
  lastEditorRange = sel.getRangeAt(0).cloneRange()
}
document.addEventListener('selectionchange', trackEditorCaret)

// Close toolbar dropdowns when clicking outside them (VS Code-native menu
// behaviour; see toolbar-dismiss.ts).
setupToolbarDismiss()

// Restore the remembered caret when the live selection is missing or collapsed
// to the editor start (focus left the iframe). Returns true if a restore ran.
function restoreEditorCaretIfLost(): boolean {
  const v = window.vditor
  if (!v || !lastEditorRange) return false
  const editor = activeModeElement(v)
  if (!editor) return false
  const sel = window.getSelection()
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null
  const live = node && editor.contains(node)
  const collapsedAtStart =
    node === editor && sel!.anchorOffset === 0 && sel!.isCollapsed
  if (live && !collapsedAtStart) return false // a real caret is present; keep it
  try {
    sel!.removeAllRanges()
    sel!.addRange(lastEditorRange)
    return true
  } catch {
    return false
  }
}

// Apply Vditor's UI + content + code theme via setTheme — the proven path.
// The constructor `theme`/`preview.theme.current` options alone do NOT reliably
// apply the content/code theme at init, which left a dark VS Code showing light
// content text + white tables. Used by both init (after()) and live switching.
//
// We pass the content-theme path EXPLICITLY (4th arg) instead of letting
// setTheme fall back to `options.preview.theme.path`: that option is unreliable
// here — the host strips a stale baked path from saved options (the colors-401
// fix), which would otherwise leave setContentTheme with an empty path and make
// it a no-op, so the table/content theme never followed a live theme switch.
// Resolve the code-block highlight style: the `codeTheme` setting, or — when
// 'auto'/unset — github/github-dark following the VS Code light/dark theme.
function codeHljsStyle(theme: 'dark' | 'light', options: any): string {
  const ct = options?.codeTheme
  if (!ct || ct === 'auto') return theme === 'dark' ? 'github-dark' : 'github'
  return ct
}

function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  const cdn = lastInitMsg?.cdn
  const contentThemePath = cdn ? `${cdn}/dist/css/content-theme` : undefined
  const code = codeHljsStyle(theme, lastInitMsg?.options)
  if (theme === 'dark') {
    vditor.setTheme('dark', 'dark', code, contentThemePath)
  } else {
    vditor.setTheme('classic', 'light', code, contentThemePath)
  }
}

// Show the REAL toolbar in the instant-paint overlay. Vditor builds its toolbar
// element synchronously in the constructor — with the real icons — but only
// attaches it to #app later, in its post-Lute initUI (~150 ms later). So right
// after `new Vditor()` (it builds synchronously now that i18n is inline) we can
// clone that built element into the overlay's empty
// placeholder bar: the teaser shows the actual toolbar (exact layout + icons, no
// host-side replication) during the Lute wait, and it's dropped with the overlay
// at the swap. Best-effort — a missing element just leaves the empty bar.
function showRealToolbarInOverlay() {
  // With i18n passed inline (window.VditorI18n, injected by the host before main.js)
  // Vditor builds the toolbar synchronously in its constructor, so the element is
  // usually present the instant `new Vditor()` returns. Still poll per frame as a
  // fallback — if i18n was missing Vditor loads it async and the toolbar appears a
  // few frames later — until it exists (clone it in) or the overlay is gone (swap).
  let tries = 0
  const tick = () => {
    const bar = document.querySelector('#vmarkd-prerender .vditor-toolbar')
    if (!bar) return // overlay already swapped out — nothing to do
    const real = (window.vditor as any)?.vditor?.toolbar?.element as
      | HTMLElement
      | undefined
    if (real) {
      try {
        const clone = real.cloneNode(true) as HTMLElement
        // indent/outdent start disabled in the live editor (Vditor's EditMode
        // calls disableToolbar(["outdent","indent"]) until the caret is in a
        // list). The static clone hasn't run that, so grey them out to match the
        // default state and avoid a flicker when the real toolbar takes over.
        clone
          .querySelectorAll('[data-type="indent"],[data-type="outdent"]')
          .forEach((el) => {
            el.classList.add('vditor-menu--disabled')
          })
        bar.replaceWith(clone)
      } catch {}
      return
    }
    if (tries++ < 90) requestAnimationFrame(tick)
  }
  tick()
}

// Remove the host-side instant-paint overlay (see src/lute-host.ts). Called once
// the live editor is built AND themed (right after applyVditorTheme), so the
// reveal is seamless — no rAF needed. Idempotent + never throws, so it's safe to
// call from a finally as a guaranteed swap even if a later after() helper throws.
function removePrerenderOverlay() {
  try {
    document.getElementById('vmarkd-prerender')?.remove()
  } catch {}
}

// Streaming spinner (task 49): keeps the top-right "loading" ring spinning after the
// prepaint overlay is swapped out, until a large file finishes streaming in. Styled in
// vscode-chrome.css (#vmarkd-stream-spinner) — subtly distinct from the prepaint
// spinner so the phase change is visible but quiet. Idempotent.
function showStreamSpinner() {
  if (document.getElementById('vmarkd-stream-spinner')) return
  const dot = document.createElement('span')
  dot.id = 'vmarkd-stream-spinner'
  dot.setAttribute('aria-hidden', 'true')
  dot.title = 'vMarkd: loading large file… (read-only)'
  document.body.appendChild(dot)
}
function removeStreamSpinner() {
  try {
    document.getElementById('vmarkd-stream-spinner')?.remove()
  } catch {}
}

// Bridge the prepaint scroll into the live editor (task 49). The inline script the
// host injects before main.js (window.__vmarkdScroll) accumulates the user's wheel/key
// scroll from the instant the teaser paints — main.js (the big bundle) executes a beat
// later, so capturing must start earlier than this code runs. Once the editor exists
// we drive its REAL scroll container (findScroller — in the VS Code webview that's
// `pre.vditor-reset`, which has a bounded height and scrolls; in other layouts it's
// the document) to that accumulated offset for a short window. This bridges the swap-in
// gap, INCLUDING the brief moment a freshly-mounted editor isn't yet responding to
// native wheel, and honours a scroll the user began on the teaser. After the window we
// stop accumulating and hand fully back to native scrolling.
function bridgePrepaintScroll(): void {
  const cap = (window as any).__vmarkdScroll as
    | { intent: number; active: boolean; stop?: () => void }
    | undefined
  if (!cap) return
  let frames = 0
  const tick = () => {
    const editorEl = (window.vditor as any)?.vditor?.ir?.element as
      | HTMLElement
      | undefined
    if (editorEl) {
      const scroller = findScroller(editorEl)
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = Math.min(cap.intent, max)
      // Only ever pull the view DOWN toward the intended offset — never reduce
      // scrollTop. `cap.intent` is the cumulative wheel/key delta (it tracks up-scroll
      // too), so this honours the teaser scroll, covers the dead window right after
      // swap-in, AND corrects a spurious jump-to-top (Vditor scrolling the caret into
      // view when the editor becomes editable at end-of-stream / on reflow) — without
      // ever yanking the user upward or fighting further native scrolling.
      if (scroller.scrollTop < target) scroller.scrollTop = target
    }
    // ~3 s window so it spans a streaming load (the jump-to-top happens at end-of-
    // stream); then stop capturing and hand fully back to native scrolling.
    if (frames++ < 180) requestAnimationFrame(tick)
    else cap.stop?.()
  }
  tick()
}

function initVditor(msg) {
  // Do not log `msg` — it carries the full document content (task 18 §2d).
  lastInitMsg = msg
  // Gate content-visibility (main.css) to docs ≥ 100 KB (see CSS comment). Below
  // that the O(n) layout cost is negligible and the `contain-intrinsic-size` on
  // contenteditable blocks triggered blank-screen bugs in Chromium 148, so leave
  // small docs untouched. No upper bound: huge docs (which ALSO stream) want it most
  // — it keeps tab-switch repaint O(viewport).
  {
    const len = typeof msg.content === 'string' ? msg.content.length : 0
    const cvEnabled = msg.options?.contentVisibility !== false // default on
    document.body.classList.toggle(
      'vmarkd-large-doc',
      cvEnabled && len >= CONTENT_VIS_MIN_CHARS,
    )
  }
  // Force the configured mermaid theme (wraps mermaid.initialize before Vditor
  // lazy-loads/renders it). 'auto' = follow Vditor's own dark/default choice.
  applyMermaidTheme(window, msg.options?.mermaidTheme)
  // Link-open policy (task 62): Ctrl/Cmd+click vs plain-click follow. Applied live
  // here (and on config-changed) so the IR/WYSIWYG patches + fixLinkClick agree.
  applyLinkOpenSetting(msg.options?.linkOpenWithModifier)
  // Debounced edit→host sync. The webview owns the (single) markdown serialize —
  // Vditor no longer serializes per input (fixIrInputSerialize patch). On a large
  // doc the serialize is multi-second and blocks the thread, so the idle path shows
  // a busy cursor and yields a paint before it (task 68). Ctrl/Cmd+S flushes
  // SYNCHRONOUSLY (no yield) so the edit is posted before VS Code saves (task 58).
  // Both guard against firing mid extension-update / streaming (a partial getValue()
  // would post a truncated document).
  // Incremental IR serialization (task 69). The full `vditor.getValue()` reserializes
  // the whole document (Lute, super-linear) on every idle — seconds on a large doc.
  // For IR we instead diff the top-level blocks and re-serialize only what changed,
  // keeping a cached full markdown. Proven byte-identical to getValue() (task-69 spike).
  const incrementalIr = createIncrementalMd((html: string) =>
    (window.vditor as any).vditor.lute.VditorIRDOM2Md(html),
  )
  const irElement = (): HTMLElement | undefined =>
    (window.vditor as any)?.vditor?.ir?.element
  const irTopBlocks = (el: HTMLElement): string[] =>
    Array.from(el.children, (c) => (c as HTMLElement).outerHTML)
  // Cache is IR-only; re-entering IR (after a mode switch) rebaselines.
  let lastSerializeMode: string | null = null
  const isLargeDoc = () =>
    (activeModeElement(window.vditor)?.textContent?.length ?? 0) >=
    LARGE_DOC_CHARS
  // The incremental serializer pays off only with enough top-level blocks — block COUNT
  // (not byte size) drives the super-linear full-serialize cost (task-69 analysis). Returns
  // the IR element when incremental should be used, else undefined (→ plain getValue()).
  // `children.length` is O(1) and correct for code/lists/tables (each is one block).
  const irIncrementalElement = (): HTMLElement | undefined => {
    const el = irElement()
    return el &&
      useIncrementalSerialize(
        window.vditor.getCurrentMode?.(),
        el.children.length,
      )
      ? el
      : undefined
  }
  const serializeForHost = (): string => {
    const el = irIncrementalElement()
    if (el) {
      if (lastSerializeMode !== 'ir-incremental') incrementalIr.invalidate()
      lastSerializeMode = 'ir-incremental'
      return incrementalIr.update(irTopBlocks(el))
    }
    lastSerializeMode = window.vditor.getCurrentMode?.() ?? null
    return vditor.getValue()
  }
  // Drop cached IR state when the DOM is rebuilt wholesale outside the edit path
  // (external setValue / streaming) so the next serialize rebaselines cleanly.
  invalidateIncrementalIr = () => incrementalIr.invalidate()

  // Report which large-document helpers are active to the host, for the status-bar
  // marker + tooltip. content-visibility (≥100 KB) and streaming (>700 KB) are fixed
  // for the doc's lifetime; incremental serialization (≥700 blocks) can flip as the
  // user edits. Post only when the active SET changes, so it's cheap to call often.
  const docChars = typeof msg.content === 'string' ? msg.content.length : 0
  const cvActive =
    msg.options?.contentVisibility !== false &&
    docChars >= CONTENT_VIS_MIN_CHARS
  const streamActive =
    msg.options?.streamLargeFiles !== false && docChars > STREAM_MIN_CHARS
  let lastReportedSig: string | null = null
  reportDocMode = () => {
    const incremental = irIncrementalElement() !== undefined
    const blocks = irElement()?.children.length ?? 0
    const sig = `${cvActive}|${streamActive}|${incremental}`
    if (sig === lastReportedSig) return
    lastReportedSig = sig
    vscode.postMessage({
      command: 'docMode',
      contentVisibility: cvActive,
      streaming: streamActive,
      incremental,
      blocks,
      chars: docChars,
    })
  }

  // Keep Vditor's idle window mode-aware (Vditor reads options.undoDelay live). IR/SV
  // stay snappy (task 69: IR is incremental, SV serialize is trivial); only WYSIWYG, whose
  // full VditorDOM2Md is still super-linear, widens on large docs. Re-evaluated per edit so
  // a mode switch takes effect on the next edit's scheduling.
  const syncUndoDelay = () => {
    const inner = (window.vditor as any)?.vditor
    if (!inner?.options) return
    const mode = window.vditor.getCurrentMode?.()
    const len =
      mode === 'wysiwyg'
        ? (activeModeElement(window.vditor)?.textContent?.length ?? 0)
        : 0
    inner.options.undoDelay = undoDelayForContentLength(len, mode)
  }

  const postEdit = () => {
    vscode.postMessage({ command: 'edit', content: serializeForHost() })
    reportDocMode()
    syncUndoDelay()
  }
  const pendingEdit = createPendingEdit({
    wait: 250,
    onIdle: async () => {
      if (applyingExtensionUpdate || streaming) return
      // IR is now incremental → fast even on large docs (no busy cursor). WYSIWYG/SV
      // still do a full getValue(); keep the busy-cursor + paint for that slow path.
      if (window.vditor.getCurrentMode?.() !== 'ir' && isLargeDoc()) {
        setBusyCursor(true)
        await nextPaint() // let the busy cursor paint before the long serialize
        try {
          postEdit()
        } finally {
          setBusyCursor(false)
        }
      } else {
        postEdit()
      }
    },
    onFlush: () => {
      if (applyingExtensionUpdate || streaming) return
      // Save is authoritative (task 58): on a large IR doc bring the incremental cache
      // current (cheap), then audit it against a full getValue() — drift = a fast-path bug,
      // log + resync so a bad incremental result can never corrupt a saved file. Small docs
      // (below the block-count gate) serialize directly.
      const incrEl = irIncrementalElement()
      if (incrEl) {
        const incremental = incrementalIr.update(irTopBlocks(incrEl))
        const authoritative = vditor.getValue()
        if (incremental !== authoritative) {
          console.warn(
            '[task69] incremental IR markdown drifted from full serialize on save; using authoritative + resyncing',
          )
          incrementalIr.invalidate()
        }
        vscode.postMessage({ command: 'edit', content: authoritative })
      } else {
        vscode.postMessage({ command: 'edit', content: vditor.getValue() })
      }
    },
  })
  flushPendingEdit = () => pendingEdit.flush()
  let defaultOptions: any = msg.cdn ? { cdn: msg.cdn } : {}
  const codeStyle = codeHljsStyle(
    msg.theme === 'dark' ? 'dark' : 'light',
    msg.options,
  )
  if (msg.theme === 'dark') {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = deepMerge(defaultOptions, {
      theme: 'dark',
      preview: {
        theme: {
          current: 'dark',
        },
        hljs: {
          style: codeStyle,
        },
      },
    })
  } else {
    // Explicit light code theme — avoids any init flash of Vditor's default
    // before applyVditorTheme runs (task 05). Honors the codeTheme setting.
    defaultOptions = deepMerge(defaultOptions, {
      preview: {
        hljs: {
          style: codeStyle,
        },
      },
    })
  }
  defaultOptions = deepMerge(defaultOptions, msg.options, {
    preview: {
      math: {
        inlineDigit: true,
      },
      // Drop Vditor's default preview action bar (Desktop/Tablet/Mobile device
      // widths + the China-specific "copy for WeChat 公众号 / Zhihu" buttons) —
      // irrelevant in a VS Code markdown editor.
      actions: [],
    },
  })
  // Code-block line numbers (rendered preview only). deepMerge keeps the
  // dark-theme hljs.style sibling intact.
  if (msg.options?.codeBlockLineNumbers) {
    defaultOptions = deepMerge(defaultOptions, {
      preview: { hljs: { lineNumber: true } },
    })
  }
  // Outline panel: open-by-default + side (tasks 07/08). Default position right.
  defaultOptions = deepMerge(defaultOptions, {
    outline: {
      enable: msg.options?.showOutlineByDefault === true,
      position: msg.options?.outlinePosition === 'left' ? 'left' : 'right',
    },
  })
  if (window.vditor) {
    vditor.destroy()
    window.vditor = null
  }
  // Large documents are streamed in chunk-by-chunk (task 49) instead of handed to
  // Vditor whole — one monolithic Md2VditorIRDOM(fullDoc) blocks the editor for
  // seconds. When streaming, construct empty and fill in after() via streamRenderIR.
  const willStream = streamActive
  // Constructed from `vditor/src` (we bundle from source); the global is typed from the
  // published `vditor` (dist) types — cast across the two identities at the assignment.
  ;(window as any).vditor = new Vditor('app', {
    width: '100%',
    height: '100%',
    minHeight: '100%',
    lang,
    // The host injects the Vditor i18n bundle as a <script> before main.js, so
    // window.VditorI18n is already set here. Passing it inline makes Vditor build
    // the editor (toolbar included) synchronously in the constructor instead of
    // waiting on its own async i18n fetch — so the toolbar is available for the
    // overlay clone immediately. Falls back to Vditor's async load if it's absent.
    i18n: (window as any).VditorI18n,
    value: willStream ? '' : msg.content,
    mode: 'ir',
    cache: { enable: false },
    // Opt-in: the counter recomputes on every keystroke (perf cost on large docs).
    // Word count lives in the VS Code status bar (next to reading time), not in
    // the editor — Vditor's own counter is off.
    counter: { enable: false },
    toolbar:
      msg.options?.showToolbar === false
        ? []
        : createToolbar({ wikiEnabled: Boolean(msg.wiki?.enabled) }),
    toolbarConfig: { pin: true },
    ...defaultOptions,
    // Large-doc responsiveness (perf C2): widen Vditor's reserialise/undo idle
    // window for big files so the multi-second full-document markdown serialise
    // (Lute, super-linear) fires only after a real idle instead of mid-edit. Set
    // from the initial content size; small docs keep the snappy default.
    // Constructed in IR (incremental serialize → snappy default). Kept mode-aware at
    // runtime by syncUndoDelay: only WYSIWYG widens on large docs (still a full serialize).
    undoDelay: undoDelayForContentLength(
      typeof msg.content === 'string' ? msg.content.length : 0,
      'ir',
    ),
    // Capture Tab so it indents/inserts instead of falling through to the browser
    // (which moves focus to the next tabbable element / the host iframe and scrolls
    // the view away). Vditor only handles Tab when `options.tab` is set; it was
    // unset, so Tab escaped focus. A literal tab keeps round-trips clean.
    tab: '\t',
    // IR link UX (task 62): Ctrl/Cmd+click follows the link (the modifier gate is
    // in the patched IR source — fixIrLinkClick), plain click edits. The patched
    // handler only reaches link.click on a modifier click, so this just opens.
    link: {
      click: (markerEl: Element) =>
        openLinkFromMarker(markerEl, (m) => vscode.postMessage(m)),
    },
    // Vditor 3.11.x calls this optional hook unconditionally while rendering
    // the wysiwyg toolbar; without it the editor throws on init and never
    // finishes (window.vditor stays undefined, table panel never mounts).
    customWysiwygToolbar: () => {},
    after() {
      const wikiEnabled = Boolean(msg.wiki?.enabled)
      // Non-visual helpers that need the full editor DOM. Factored out so the
      // streaming path can run them once the whole document is streamed in.
      const finishInit = () => {
        handleToolbarClick()
        guardToolbarScroll(window.vditor)
        fixTableIr()
        fixResponsiveTables()
        fixPanelHover()
        if (msg.options?.outlineHighlight !== false) {
          setupOutlineFlash(window.vditor)
        }
        {
          const oel: HTMLElement | undefined = (window.vditor as any)?.vditor
            ?.outline?.element
          if (oel) {
            const pos =
              msg.options?.outlinePosition === 'left' ? 'left' : 'right'
            setupOutlineResize(oel, pos, (w) =>
              vscode.postMessage({ command: 'save-outline-width', width: w }),
            )
          }
        }
        // Centre-anchored scroll sync for split (sv) view (task 48). Idempotent.
        setupSplitScrollSync()
        // Report the initial large/normal doc mode for the status-bar marker (task 69).
        reportDocMode()
      }
      try {
        // Force the theme through setTheme at init (constructor options don't
        // reliably apply content/code theme — see applyVditorTheme).
        applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
        // Register wiki renderers on the lute instance BEFORE any content render, so
        // both the monolithic path and the streamed chunks (same lute) emit chips.
        // Populate the shared knownPages set (updated live by wiki-update).
        wikiKnownPages.clear()
        if (wikiEnabled && msg.wiki.pageKeys) {
          for (const k of msg.wiki.pageKeys as string[]) wikiKnownPages.add(k)
        }
        setupCustomRenderer(window.vditor, {
          enabled: wikiEnabled,
          knownPages: wikiEnabled ? wikiKnownPages : undefined,
        })
        if (wikiEnabled) {
          setKnownPagesRef(wikiKnownPages)
          patchLuteSerialize(window.vditor)
        }

        if (willStream) {
          // Large doc (task 49): stream it in chunk-by-chunk. Keep the instant-paint
          // overlay until the first chunk paints; hold the editor read-only and
          // suspend the edit→host sync (a partial getValue() would save a truncated
          // file) until the full document is in.
          streaming = true
          const irEl = (window.vditor as any)?.vditor?.ir?.element as
            | HTMLElement
            | undefined
          // Read-only during the stream (avoids edit↔append races), but tag it so
          // our CSS cancels Vditor's [contenteditable=false] { opacity:.3 } fade —
          // the doc should look normal while it fills in, not greyed-out/disabled.
          irEl?.setAttribute('contenteditable', 'false')
          irEl?.classList.add('vmarkd-streaming')
          const endStream = () => {
            streaming = false
            irEl?.setAttribute('contenteditable', 'true')
            irEl?.classList.remove('vmarkd-streaming')
            // The streamed DOM is a wholesale build → drop the IR cache (task 69).
            invalidateIncrementalIr()
          }
          streamRenderIR(window.vditor, msg.content, {
            onFirstChunk: () => {
              // First chunk painted: drop the overlay, keep a (subtly different)
              // spinner going while the rest streams in, and bridge the prepaint
              // scroll into the (now mounting) editor — see bridgePrepaintScroll.
              removePrerenderOverlay()
              showStreamSpinner()
              bridgePrepaintScroll()
            },
            onDone: () => {
              removeStreamSpinner()
              endStream()
              finishInit()
            },
          }).catch(() => {
            // Never leave the editor stuck read-only / under the overlay.
            removeStreamSpinner()
            endStream()
            removePrerenderOverlay()
            finishInit()
          })
          return
        }

        // Small doc: Vditor already rendered msg.content from the constructor. Swap
        // out the host overlay now, BEFORE the helpers, so a throw can't leave it up.
        removePrerenderOverlay()
        if (
          wikiEnabled &&
          typeof msg.content === 'string' &&
          msg.content.includes('[[')
        ) {
          // Re-render so wiki chips apply (constructor ran before setupCustomRenderer).
          applyingExtensionUpdate = true
          try {
            vditor.setValue(msg.content)
          } finally {
            setTimeout(() => {
              applyingExtensionUpdate = false
            }, 0)
          }
        }
        finishInit()
        // Bridge any prepaint scroll into the (fully rendered) editor.
        bridgePrepaintScroll()
      } finally {
        // Belt-and-suspenders for the non-streaming path: guarantee the overlay is
        // gone even if a helper threw. The streaming path manages it via hooks.
        if (!willStream) removePrerenderOverlay()
      }
    },
    input() {
      // Cheap signal (Vditor no longer serialises here — fixIrInputSerialize). The
      // serialize+post happens in the debounced onIdle. Suppressed while applying an
      // extension update / streaming (a partial doc would be posted).
      if (applyingExtensionUpdate || streaming) {
        return
      }
      pendingEdit.schedule()
    },
    upload: {
      url: '/fuzzy', // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        // Convert/scale per the vmarkd.image.* settings (task 74): original or
        // WebP, optional max-width downscale. Conversion runs here on a canvas;
        // convertForUpload falls back to the original bytes on any failure.
        const opts = lastInitMsg?.options ?? {}
        const fileInfos = await Promise.all(
          files.map(async (f) => {
            const { blob, name } = await convertForUpload(f, {
              format: opts.imageFormat,
              quality: opts.imageQuality,
              maxWidth: opts.imageMaxWidth,
            })
            return {
              base64: await fileToBase64(blob),
              name: `${formatTimestamp(new Date())}_${name}`.replace(
                /[^\w-_.]+/,
                '_',
              ),
            }
          }),
        )
        vscode.postMessage({
          command: 'upload',
          files: fileInfos,
        })
      },
    },
  })
  // Vditor built its toolbar synchronously above (icons and all); surface it in
  // the instant-paint overlay now, while Lute is still loading (see helper).
  showRealToolbarInOverlay()
  // Failsafe: after() normally drops the overlay in ~150 ms. But if the webview's
  // own Lute script never loads (network/resource failure), after() never fires
  // and the overlay would stay forever — a frozen, non-interactive teaser. Force
  // it gone after a generous grace period so a broken load degrades to the (empty)
  // editor the user can reload, instead of an indefinite hang. Idempotent no-op
  // on the normal path.
  setTimeout(removePrerenderOverlay, 8000)
}

// Host→webview message handlers, one per `command`. Adding a command means adding
// a handler + a map entry — no central switch to edit (Open/Closed). Each handler
// owns one command and reads the shared module state directly, exactly as the
// previous switch cases did.

function handleUpdate(msg: any) {
  if (msg.type === 'init') {
    // A fresh editor: drop any stale gutter bars from a previous instance.
    lastDiffChanges = []
    clearDiffMarkers()
    document.body.setAttribute('data-wiki-file', msg.wiki?.enabled ? '1' : '0')
    applyBodyOptions(msg.options)
    try {
      initVditor(msg)
    } catch (error) {
      // reset options when error
      console.error(error)
      initVditor({ content: msg.content })
      saveVditorOptions()
    }
    console.log('initVditor')
  } else if (streaming) {
    // A large doc is still streaming in; getValue() is partial. Don't diff/setValue
    // against it (would clobber the stream with a monolithic re-render). The content
    // being streamed is already this init's content; external changes re-fire later.
    return
  } else if (vditor.getValue() !== msg.content) {
    applyingExtensionUpdate = true
    try {
      // setValue rebuilds the DOM and would drop the caret/scroll to the top (#1912).
      // For an external update landing while the user edits, keep them put.
      preserveCaretAndScroll(window.vditor, () => vditor.setValue(msg.content))
      // The DOM was rebuilt wholesale → drop the IR cache (task 69) + refresh the marker.
      invalidateIncrementalIr()
      reportDocMode()
    } finally {
      setTimeout(() => {
        applyingExtensionUpdate = false
        // setValue re-rendered the blocks → re-apply the gutter bars.
        if (window.vditor && lastDiffChanges.length) {
          renderDiffMarkers(window.vditor, lastDiffChanges)
        }
      }, 0)
    }
    console.log('setValue')
  }
}

function handleSetTheme(msg: any) {
  // Live re-theme without re-initialising (keeps cursor/scroll). Chrome colors
  // already follow via --vscode-* CSS vars.
  const theme = msg.theme === 'dark' ? 'dark' : 'light'
  applyVditorTheme(theme)
  // Mermaid doesn't re-theme on setTheme — re-render existing diagrams (task 59).
  // reRenderMermaid renders offscreen and swaps the SVG in atomically, so the live DOM
  // never collapses (no scroll jump, no flash).
  applyMermaidTheme(window, lastInitMsg?.options?.mermaidTheme)
  const el = (window.vditor as any)?.vditor?.[window.vditor.getCurrentMode()]
    ?.element as HTMLElement | undefined
  reRenderMermaid(
    el,
    lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
    theme,
  )
}

function handleConfigChanged(msg: any) {
  // Live config reload (task 26): body-attr / CSS-var options apply without
  // touching Vditor. Constructor-only options (toolbar, word count, …) can't
  // — re-init Vditor with the merged options, preserving the current content.
  applyBodyOptions(msg.options)
  // Link-open policy is a plain runtime flag — apply it live (no re-init needed).
  applyLinkOpenSetting(msg.options?.linkOpenWithModifier)
  const codeThemeChanged =
    lastInitMsg && lastInitMsg.options?.codeTheme !== msg.options?.codeTheme
  const mermaidThemeChanged =
    lastInitMsg &&
    lastInitMsg.options?.mermaidTheme !== msg.options?.mermaidTheme
  if (lastInitMsg && initOnlyChanged(lastInitMsg.options, msg.options)) {
    const content =
      window.vditor && !applyingExtensionUpdate
        ? vditor.getValue()
        : lastInitMsg.content
    initVditor({
      ...lastInitMsg,
      content,
      options: { ...lastInitMsg.options, ...msg.options },
    })
    return
  }
  if (!lastInitMsg || !window.vditor) return
  lastInitMsg.options = { ...lastInitMsg.options, ...msg.options }
  // Code-block theme isn't a constructor-only option — apply it live via setTheme
  // (swaps the hljs stylesheet) without re-init, keeping cursor.
  if (codeThemeChanged) {
    applyVditorTheme(lastInitMsg.theme === 'dark' ? 'dark' : 'light')
  }
  // Mermaid theme: apply LIVE via the task-59 offscreen re-render (used to re-init, which
  // scrolled big docs to the top — the reported bug). applyMermaidTheme updates the
  // mermaid.initialize wrapper; reRenderMermaid swaps each diagram's SVG in place.
  if (mermaidThemeChanged) {
    applyMermaidTheme(window, msg.options?.mermaidTheme)
    reRenderMermaid(
      activeModeElement(window.vditor) ?? undefined,
      lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
      lastInitMsg.theme === 'dark' ? 'dark' : 'light',
    )
  }
}

function handleReloadCss(msg: any) {
  // Live CSS swap (tasks 12/26): replace the customCss or external-CSS <style>
  // node in place.
  swapStyle(msg.id, msg.css)
}

function handleGetCursorOffset(_msg: any) {
  // Reveal-in-Source (task 16): report the caret position so the host can select
  // the matching line. Restore the last in-editor caret first (the toolbar button
  // blurs the iframe and collapses the live selection). Reply with the line number
  // AND that line's text — both measured against vditor.getValue() — so the host
  // can match by content in the on-disk doc (which may differ by Vditor's on-load
  // reflow) rather than a raw offset that drifts across the two text spaces. Always
  // reply (line -1 when unresolved) so the host's awaited round-trip never hangs.
  let line = -1
  let lineText = ''
  if (window.vditor) {
    restoreEditorCaretIfLost()
    const offset = getCursorSourceOffset(window.vditor)
    if (offset >= 0) {
      const res = lineAndTextForOffset(window.vditor.getValue(), offset)
      line = res.line
      lineText = res.lineText
    }
  }
  vscode.postMessage({ command: 'cursor-offset', line, lineText })
}

function handleDiffInfo(msg: any) {
  // Git gutters (task 17): stash + render the change bars.
  lastDiffChanges = (msg.changes || []) as DiffChange[]
  if (window.vditor) renderDiffMarkers(window.vditor, lastDiffChanges)
}

function handleUploaded(msg: any) {
  msg.files.forEach((f: string) => {
    if (f.endsWith('.wav')) {
      vditor.insertValue(
        `\n\n<audio controls="controls" src="${f}"></audio>\n\n`,
      )
    } else {
      vditor.insertValue(`\n\n![](${f})\n\n`)
    }
  })
}

// Scroll the webview to the Nth heading (the native-outline tree click, task 78).
// Headings render in document order across IR/WYSIWYG/SV, so the source-parsed
// ordinal lines up with the Nth <h1-6> in the active editor element.
function handleScrollToHeading(msg: any) {
  const el = activeModeElement(window.vditor)
  if (!el) return
  const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const target = headings[msg.index] as HTMLElement | undefined
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target.classList.add(FLASH_CLASS)
  setTimeout(() => target.classList.remove(FLASH_CLASS), 1400)
}

const messageHandlers: Record<string, (msg: any) => void> = {
  update: handleUpdate,
  'set-theme': handleSetTheme,
  'config-changed': handleConfigChanged,
  'reload-css': handleReloadCss,
  'get-cursor-offset': handleGetCursorOffset,
  'diff-info': handleDiffInfo,
  uploaded: handleUploaded,
  'scroll-to-heading': handleScrollToHeading,
  'wiki-update': (msg: any) => {
    if (!Array.isArray(msg.pageKeys)) return
    wikiKnownPages.clear()
    for (const k of msg.pageKeys as string[]) wikiKnownPages.add(k)
  },
}

window.addEventListener('message', (e) => {
  const msg = e.data
  // console.log('msg from vscode', msg)
  messageHandlers[msg?.command]?.(msg)
})

fixLinkClick()
fixCut()

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

// Route Ctrl/Cmd+Z·Y to Vditor's own undo engine instead of the browser/VS Code
// document undo — see undo-keybind.ts for the full rationale.
setupHistoryKeybind(window)

// Flush the debounced edit before VS Code saves, so Ctrl/Cmd+S never persists a
// stale snapshot (task 58). Capture phase + non-suppressing — see save-flush.ts.
setupSaveFlushKeybind(window, () => flushPendingEdit())

vscode.postMessage({ command: 'ready' })
