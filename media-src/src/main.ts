import './preload'
import type { HostMessage } from './protocol'

import {
  fileToBase64,
  fixCut,
  fixLinkClick,
  fixPanelHover,
  fixResponsiveTables,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'

import { buildVditorOptions, codeHljsStyle } from './vditor-options'
import { setVditorTheme } from './vditor-theme'
import Vditor from 'vditor/src/index'
import { formatTimestamp } from './format-timestamp'
import { convertForUpload } from './image-convert'
// Vditor's index.css is NOT bundled here. The host links the COPIED media/vditor/dist/index.css
// (html-builder.ts) — the same single copy the harness and HTML-export load — so build.mjs
// patchVditorIndexCss() (run post-sync) is the SOLE patch site for it. Bundling it (the old
// `import 'vditor/dist/index.css'`) pulled the UNPATCHED node_modules copy into media/dist/main.css
// → editor and harness drifted (the WYSIWYG inline-code 0-padding trap, ADR-0004). One copy = no drift.
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
import { setupPreviewScrollPreserve } from './preview-scroll-preserve'
import { findScroller, guardToolbarScroll } from './toolbar-scroll-guard'
import { preserveCaretAndScroll } from './caret-preserve'
import { streamRenderIR, STREAM_MIN_CHARS } from './stream-render'

// Lower bound for the content-visibility band (see initVditor). Its own constant —
// NOT reused from LARGE_DOC_CHARS (which gates undo-delay / incremental serialize) —
// because the layout-cost break-even is a different point from the serialize one.
const CONTENT_VIS_MIN_CHARS = 100_000
import { applyBodyOptions, swapStyle, initOnlyChanged } from './live-config'
import { applyMermaidTheme, resolveMermaidInit } from './mermaid-theme'
import { reRenderMermaid } from './mermaid-retheme'
import { resolveEchartsTheme } from '../../src/echarts-theme'
import { applyEchartsTheme, readVscodePalette } from './echarts-apply'
import { observeMindmaps, reRenderEcharts } from './echarts-retheme'
import { reRenderFlowchart } from './flowchart-retheme'
import {
  reRenderPlantuml,
  reRenderGraphviz,
  reRenderAbc,
} from './plantuml-retheme'
import { installDiagramZoomGate } from './diagram-zoom-gate'
import { observeDiagramZoom } from './diagram-zoom'
import { installEchartsResize } from './echarts-fit'
import { calloutWysiwygToolbar, observeCallouts } from './callouts'
import { observeCodeSource } from './code-source'
import { observeSmiles, repairSmiles } from './smiles-render'
import {
  observeCustomDiagrams,
  reRenderWavedrom,
  reRenderNomnoml,
  reRenderGeojson,
  reRenderTopojson,
  reRenderStl,
  reRenderVega,
  reRenderD2,
} from './custom-diagrams'
import { observeHtmlComments, observePreviewComments } from './html-comment'
import { installMarkmapResize } from './markmap-fit'
import { observeAbc } from './abc-fit'
import {
  ensureHljsLoaded,
  observeWysiwygCodeHighlight,
  wrapLuteFlatten,
} from './wysiwyg-code-highlight'
import {
  observeGapParagraphs,
  observeTrailingParagraph,
  setupTrailingNav,
} from './gap-paragraph'
import { setupCaretScroll } from './caret-scroll'
import { setupCalloutArrowNav } from './callout-nav'
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
// Disposer for the active callouts MutationObserver (task 106); torn down + replaced on re-init.
let disposeCallouts: (() => void) | null = null
let disposePreviewCallouts: (() => void) | null = null
let disposeCodeSource: (() => void) | null = null
let disposeWysiwygHighlight: (() => void) | null = null
let disposeTrailing: (() => void) | null = null
let disposeSmiles: (() => void) | null = null
let disposeHtmlComments: (() => void) | null = null
let disposePreviewHtmlComments: (() => void) | null = null
let disposeAbc: (() => void) | null = null
let disposeDiagramZoom: (() => void) | null = null
let disposeCustomDiagrams: (() => void) | null = null
let disposeMindmap: (() => void) | null = null

// Shared mutable knownPages set — passed to setupCustomRenderer and updated by
// the host's wiki-update message. Because the custom renderer captures the Set
// reference (not a copy), mutating it here updates chip rendering live.
const wikiKnownPages: Set<string> = new Set()
const wikiDisplayNames: Set<string> = new Set()

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
  () => (window.vditor as any)?.vditor,
)

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

// Apply the editor's light/dark mode + paired code style to the live Vditor. Thin
// wrapper that pulls the current instance/options/cdn from module state; the Vditor
// theme-API coupling itself lives in vditor-theme.ts (setVditorTheme). Used by both
// init (after()) and live switching.
function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  setVditorTheme(
    window.vditor,
    theme,
    codeHljsStyle(theme, lastInitMsg?.options),
    lastInitMsg?.cdn,
  )
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
interface PrepaintCapture {
  intent: number
  active: boolean
  stop?: () => void
  stopKeys?: () => void
}

// Hand the prepaint teaser scroll (window.__vmarkdScroll) to the live editor.
// Two paths, because they have fundamentally different timing:
//   • streaming (huge files > STREAM_MIN_CHARS): content arrives over time, so the
//     target offset is only reachable as the document grows AND the end-of-load
//     jump-to-top happens seconds later — a bounded rAF window is the simplest fit.
//   • monolithic (the common case): the whole document is laid out at mount, so
//     there is nothing growing over time. Pure event-driven: apply once, then guard
//     ONLY the single spurious jump-to-top reactively until the user takes over —
//     no arbitrary multi-second timer.
function bridgePrepaintScroll(willStream: boolean): void {
  const cap = (window as any).__vmarkdScroll as PrepaintCapture | undefined
  if (!cap) return
  if (willStream) bridgeStreamingScroll(cap)
  else bridgeMonolithicScroll(cap)
}

function irEditorEl(): HTMLElement | undefined {
  return (window.vditor as any)?.vditor?.ir?.element as HTMLElement | undefined
}

// Streaming path: re-apply intent across the ~3 s load window (content grows; the
// jump-to-top lands at end-of-stream), then hand back to native scrolling.
function bridgeStreamingScroll(cap: PrepaintCapture): void {
  let frames = 0
  let keysStopped = false
  const tick = () => {
    const editorEl = irEditorEl()
    if (editorEl) {
      if (cap.intent === 0) {
        cap.stop?.()
        return
      }
      if (!keysStopped) {
        cap.stopKeys?.()
        keysStopped = true
      }
      const scroller = findScroller(editorEl)
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = Math.min(cap.intent, max)
      // Only ever pull DOWN toward the intended offset — honours the teaser scroll,
      // covers the swap-in dead window, and corrects the end-of-stream jump-to-top,
      // without ever yanking the user upward or fighting native scrolling.
      if (scroller.scrollTop < target) scroller.scrollTop = target
    }
    if (frames++ < 180) requestAnimationFrame(tick)
    else cap.stop?.()
  }
  tick()
}

// Monolithic path (the common case): the whole document is rendered by the Vditor
// constructor and is editable BEFORE this runs, and we apply the offset AFTER
// finishInit() (settled layout) — so there's no end-of-load jump-to-top to chase
// (that's a streaming-only symptom). Just apply the teaser offset once and hand
// fully back to native scrolling. No scroll guard, no timer.
function bridgeMonolithicScroll(cap: PrepaintCapture): void {
  const apply = () => {
    const editorEl = irEditorEl()
    if (!editorEl) {
      requestAnimationFrame(apply)
      return
    }
    if (cap.intent > 0) {
      const scroller = findScroller(editorEl)
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      scroller.scrollTop = Math.min(cap.intent, max)
    }
    // stop() removes BOTH the wheel and keydown capture (so a Space typed in the
    // freshly-opened editor isn't read as a teaser PageDown) and marks it inactive.
    cap.stop?.()
  }
  apply()
}

function runFinishInit(msg: any): void {
  handleToolbarClick()
  guardToolbarScroll(window.vditor)
  fixTableIr()
  fixResponsiveTables()
  fixPanelHover()
  if (msg.options?.outlineHighlight !== false) {
    setupOutlineFlash(window.vditor)
  }
  {
    const oel: HTMLElement | undefined = (window.vditor as any)?.vditor?.outline
      ?.element
    if (oel) {
      const pos = msg.options?.outlinePosition === 'left' ? 'left' : 'right'
      setupOutlineResize(oel, pos, (w) =>
        vscode.postMessage({ command: 'save-outline-width', width: w }),
      )
    }
  }
  setupSplitScrollSync()
  // Preserve scroll position when toggling edit (IR/WYSIWYG) ↔ full Preview overlay.
  setupPreviewScrollPreserve()
  // Callouts / GitHub Alerts (task 106): restyle `[!TYPE]` blockquotes (attribute-only, so it's
  // safe in the editable IR/WYSIWYG and round-trips). Bind to the STABLE `#app` mount, NOT
  // activeModeElement: runFinishInit runs once, but the user can be in (or switch to) WYSIWYG, and
  // toggling the full Preview overlay can make Vditor re-render/replace a mode's editor element — a
  // mode-specific observer then dies and callouts stop re-colouring on return (reported: WYSIWYG →
  // Preview → WYSIWYG drops the colours). #app survives every mode switch / element rebuild and
  // covers IR + WYSIWYG; applyCallouts is rAF-debounced + idempotent, so the wider scope is cheap.
  // (Same rationale as the WYSIWYG code-highlight observer below.)
  disposeCallouts?.()
  disposeCallouts = observeCallouts(document.getElementById('app'))
  // The full Preview overlay (`.vditor-preview`) is rendered by Lute, which emits `[!TYPE]`
  // callouts as PLAIN blockquotes — so style them there too (same dual-node: tag + inject the
  // render). The preview never gets `--expand` (no caret), so it stays "collapsed" → the CSS shows
  // the injected render + hides the source, identical to a collapsed IR callout (so Edit↔Preview
  // match in look AND height). The observer re-applies after each preview re-render (fresh innerHTML).
  disposePreviewCallouts?.()
  disposePreviewCallouts = observeCallouts(
    (
      window.vditor as unknown as {
        vditor?: { preview?: { previewElement?: HTMLElement } }
      }
    ).vditor?.preview?.previewElement,
  )
  // HTML comments (`<!-- ... -->`): the browser-invisible preview is replaced with visible
  // styled text (html-comment.ts). Bound to #app (same rationale as callouts — survives mode
  // switches). Preview pane gets its own walker (Comment nodes, not data-type wrappers).
  // Inline zoom/pan + ⛶ fullscreen button on rendered static-SVG diagrams (d2/mermaid/flowchart/
  // graphviz/abc/smiles). Bound to #app (survives mode switches + async/per-keystroke rebuilds), same
  // pattern as callouts. markmap/mindmap have their own zoom (diagram-zoom-gate.ts) and are excluded.
  disposeDiagramZoom?.()
  disposeDiagramZoom = observeDiagramZoom(document.getElementById('app'))
  disposeHtmlComments?.()
  disposeHtmlComments = observeHtmlComments(document.getElementById('app'))
  disposePreviewHtmlComments?.()
  disposePreviewHtmlComments = observePreviewComments(
    (
      window.vditor as unknown as {
        vditor?: { preview?: { previewElement?: HTMLElement } }
      }
    ).vditor?.preview?.previewElement,
  )
  // Code-block edit surface: tag the editable source `<code>` with `.hljs` so the highlight.js
  // theme styles it like the render (size/padding/bg/base colour) — editing matches preview, no
  // shift. Survives IR DOM rebuilds via its own observer; round-trips (class is invisible to Lute).
  disposeCodeSource?.()
  disposeCodeSource = observeCodeSource(activeModeElement(window.vditor))
  // WYSIWYG live code highlighting: while editing a code block in WYSIWYG, paint live syntax
  // colours onto the editable source via the CSS Custom Highlight API (zero DOM mutation, so
  // Lute serialisation/typing stay intact — unlike IR, whose source is monochrome). Bound to the
  // stable `#app` mount (not activeModeElement): the default mode is IR, and runFinishInit runs
  // once, so we must keep working after a later switch into WYSIWYG. hljs is eager-loaded here so
  // highlighting is ready from the start instead of lazily on first render.
  disposeWysiwygHighlight?.()
  // Make our hljs token spans invisible to Lute (it reparses the wysiwyg source every keystroke +
  // on getValue) so the highlighted edit surface still round-trips byte-clean. Idempotent per Lute.
  wrapLuteFlatten(window.vditor)
  ensureHljsLoaded(
    lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
    // Nudge the highlighter once the script lands, in case a code block is already focused
    // and idle (no further mutations would otherwise trigger the first paint).
  ).then(() => document.dispatchEvent(new Event('selectionchange')))
  disposeWysiwygHighlight = observeWysiwygCodeHighlight(
    document.getElementById('app'),
    () => (window as any).hljs,
  )
  // Trailing-paragraph invariant: a document ending with a block (callout/code/table/…)
  // always offers an empty paragraph below it — without one there is NO caret position
  // after the last block (arrow-down at EOF dropped the selection → caret+view jumped to
  // the top). Tag is serializer-invisible; survives IR rebuilds via its own observer.
  disposeTrailing?.()
  disposeTrailing = observeTrailingParagraph(activeModeElement(window.vditor))
  // Ctrl-to-interact gate for the zooming diagrams (markmap + ECharts mindmap): plain wheel scrolls
  // the page, Ctrl+wheel zooms, Ctrl+drag pans. Document-level + idempotent.
  installDiagramZoomGate()
  // Make ECharts charts/mindmaps responsive to a window/pane resize (echarts installs no resize
  // handler → the chart stays anchored left while the container grows). window-resize ONLY, so it
  // never fires on a mode switch (which would flicker the IR source behind the canvas). Idempotent.
  installEchartsResize(window)
  // SMILES diagrams: Lute flattens the `<code>`-wrapped smiles preview's SVG to text on the WYSIWYG
  // DOM round-trip at a DIRECT open (mermaid's `<div>` survives) and `data-processed` sticks, so the
  // diagram vanishes. Re-draw it from the intact source. Bound to stable `#app` (covers IR+WYSIWYG,
  // survives mode switches); idempotent (skips previews that already hold an svg).
  disposeSmiles?.()
  disposeSmiles = observeSmiles(document.getElementById('app'))
  disposeCustomDiagrams?.()
  disposeCustomDiagrams = observeCustomDiagrams(document.getElementById('app'))
  // markmap fits its tree to the container only at create time and clips (doesn't shrink) when the
  // column is later resized. Re-fit every visible markmap on a (debounced) window resize — same
  // window-resize-only strategy as installEchartsResize (no mode-switch 0-collapse). Idempotent.
  installMarkmapResize(window)
  // abc (music notation) renders an svg with no viewBox → it clips (doesn't scale) when the column
  // narrows, and is even clipped at the default width. Add a viewBox from its width/height attrs so
  // the main.css max-width:100% scales it. Bound to #app; idempotent (skips svgs that have a viewBox).
  disposeAbc?.()
  disposeAbc = observeAbc(document.getElementById('app'))
  // mindmap (ECharts tree) renders into a tall stock canvas → big empty vertical gaps around a short
  // wide tree. Re-fit it to its content height (≈ leaf count) on render. Idempotent (width+height+
  // theme signature). Window-resize re-fit is handled by installEchartsResize → reconstructMindmaps.
  disposeMindmap?.()
  disposeMindmap = observeMindmaps(window, document.getElementById('app'))
  reportDocMode()
}

function initVditor(msg) {
  lastInitMsg = msg
  // D2 layout engine (vmarkd.diagram.d2Layout) — read by custom-diagrams.ts renderD2 to pick
  // dagre (default) vs ELK. A plain window global keeps custom-diagrams decoupled from main.ts.
  ;(window as any).__vmarkdD2Layout = msg.options?.d2Layout
  // D2 colour theme (vmarkd.theme.d2) — read by custom-diagrams.ts → d2Theme(). Same global pattern.
  ;(window as any).__vmarkdD2Theme = msg.options?.d2Theme
  // Whether remote basemap tiles may load on geojson/topojson maps (task 99) — read by initLeafletMap.
  ;(window as any).__vmarkdAllowRemoteImages = msg.options?.allowRemoteImages
  // Content theme + editor mode — only consumed by the D2 'auto' theme (pairs to the content palette).
  ;(window as any).__vmarkdContentTheme = msg.options?.contentTheme
  ;(window as any).__vmarkdMode = msg.theme === 'dark' ? 'dark' : 'light'
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
  // lazy-loads/renders it). 'auto' follows the content-theme pairing if any, else
  // Vditor's own dark/default choice (task 86).
  applyMermaidTheme(
    window,
    resolveMermaidInit(
      msg.options?.mermaidTheme,
      msg.options?.contentTheme,
      msg.theme === 'dark' ? 'dark' : 'light',
    ),
  )
  // ECharts follows the content-theme palette too (task 90). Installs the resolver the patched
  // chartRender reads on init; no diagrams → harmless.
  applyEchartsTheme(
    window,
    resolveEchartsTheme(
      msg.options?.echartsTheme,
      msg.options?.contentTheme,
      msg.theme === 'dark' ? 'dark' : 'light',
      readVscodePalette(window),
    ),
  )
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
  const defaultOptions = buildVditorOptions(msg)
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
    ...(msg.wiki?.enabled
      ? {
          hint: {
            parse: false,
            extend: [
              {
                key: '[[',
                hint(value: string) {
                  const esc = (s: string) =>
                    s.replace(
                      /[&<>"]/g,
                      (c: string) =>
                        ({
                          '&': '&amp;',
                          '<': '&lt;',
                          '>': '&gt;',
                          '"': '&quot;',
                        })[c] ?? c,
                    )
                  const lower = value.toLowerCase()
                  const results: { html: string; value: string }[] = []
                  const pages =
                    wikiDisplayNames.size > 0
                      ? wikiDisplayNames
                      : wikiKnownPages
                  for (const page of pages) {
                    if (page.toLowerCase().includes(lower)) {
                      const src = `[[${page}]]`
                      results.push({
                        html: page,
                        value: `<span class="wiki-link-chip" data-wiki-link="1" data-wiki-target="${esc(page)}" data-wiki-source="${esc(src)}">${esc(page)}</span>`,
                      })
                    }
                  }
                  return results
                },
              },
            ],
          },
        }
      : {}),
    // Vditor 3.11.x calls this optional hook unconditionally while rendering
    // the wysiwyg toolbar; without it the editor throws on init and never
    // finishes (window.vditor stays undefined, table panel never mounts).
    // We use it to add a callout TYPE picker to the blockquote popover (the
    // floating ∧ ∨ 🗑 panel) — like a code block's language field.
    customWysiwygToolbar: (type: string, popover: HTMLElement) =>
      calloutWysiwygToolbar(type, popover),
    after() {
      const wikiEnabled = Boolean(msg.wiki?.enabled)
      // Non-visual helpers that need the full editor DOM. Factored out so the
      // streaming path can run them once the whole document is streamed in.
      const finishInit = () => runFinishInit(msg)
      try {
        // Force the theme through setTheme at init (constructor options don't
        // reliably apply content/code theme — see applyVditorTheme).
        applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
        // Register wiki renderers on the lute instance BEFORE any content render, so
        // both the monolithic path and the streamed chunks (same lute) emit chips.
        // Populate the shared knownPages set (updated live by wiki-update).
        wikiKnownPages.clear()
        wikiDisplayNames.clear()
        if (wikiEnabled && msg.wiki.pageKeys) {
          for (const k of msg.wiki.pageKeys as string[]) wikiKnownPages.add(k)
        }
        if (wikiEnabled && msg.wiki.displayNames) {
          for (const n of msg.wiki.displayNames as string[])
            wikiDisplayNames.add(n)
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
              bridgePrepaintScroll(true)
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
        bridgePrepaintScroll(false)
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
  // Keep the mode global current so the D2 'auto' theme picks the right light/dark palette when the
  // D2 re-render fires (via reThemePlantumlGraphviz below). Set BEFORE any re-render.
  ;(window as any).__vmarkdMode = theme
  applyVditorTheme(theme)
  // Mermaid doesn't re-theme on setTheme — re-render existing diagrams (task 59).
  // reRenderMermaid renders offscreen and swaps the SVG in atomically, so the live DOM
  // never collapses (no scroll jump, no flash).
  applyMermaidTheme(
    window,
    resolveMermaidInit(
      lastInitMsg?.options?.mermaidTheme,
      lastInitMsg?.options?.contentTheme,
      theme,
    ),
  )
  const el = (window.vditor as any)?.vditor?.[window.vditor.getCurrentMode()]
    ?.element as HTMLElement | undefined
  reRenderMermaid(
    el,
    lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
    theme,
  )
  // ECharts likewise paints once — re-render in the new theme (task 90).
  applyEchartsTheme(
    window,
    resolveEchartsTheme(
      lastInitMsg?.options?.echartsTheme,
      lastInitMsg?.options?.contentTheme,
      theme,
      readVscodePalette(window),
    ),
  )
  reRenderEcharts(window, el, theme)
  // flowchart.js bakes its colours (no currentColor) → re-render in the new theme's foreground
  // (deferred so it reads the SETTLED colour after the content-theme <link> applies).
  reThemeFlowchart()
  // Vega bakes axis/label colours from getComputedStyle too → same foreground-settle polling.
  reThemeVega()
  // PlantUML bakes dark/light at render time → re-render with the new mode.
  // Graphviz uses currentColor but a re-render guarantees a fresh SVG.
  reThemePlantumlGraphviz()
  // SMILES picks its palette from the page BACKGROUND luminance (bgIsDark), not the editor mode —
  // and a theme flip changes that background via CSS WITHOUT mutating the #app subtree, so
  // observeSmiles' MutationObserver never fires. Re-run repairSmiles explicitly. (No-op when the
  // background's darkness didn't change — it's idempotent per bg darkness.)
  reThemeSmiles()
}

/** Re-evaluate every smiles preview's palette after a theme flip. The new background CSS (and the
 *  content-theme `<link>`) settles asynchronously and outside #app, so schedule a few passes across
 *  the settle; repairSmiles is idempotent per bg-darkness, so the redundant calls are cheap no-ops. */
function reThemeSmiles(): void {
  const app = document.getElementById('app')
  if (!app) return
  requestAnimationFrame(() => repairSmiles(app))
  window.setTimeout(() => repairSmiles(app), 200)
  window.setTimeout(() => repairSmiles(app), 600)
}

/** Re-render a renderer that BAKES its colours from `getComputedStyle(...).color` at draw time, once
 *  the new theme's foreground actually LANDS. Such engines (flowchart.js, vega-embed) go stale on a
 *  live flip: the content-theme `<link>` applies asynchronously and can settle LATE (>400ms), so a
 *  fixed-delay re-render bakes the OLD colour (reported: vega axis numbers/ticks keep the previous
 *  theme's colour until the file is reopened). POLL the foreground (probe = a rendered block whose
 *  computed colour mirrors what the renderer reads) for ~2s and re-render only when it CHANGES —
 *  cheap (a couple of re-renders at most), and the LAST one uses the settled colour. `reRender`
 *  re-parses from source, so with no such block in the doc it's a no-op. */
function reThemeOnForegroundChange(
  probeSelector: string,
  reRender: (root?: HTMLElement) => void,
): void {
  let lastFg = ''
  let ticks = 0
  const tick = () => {
    ticks++
    const editorEl = activeModeElement(window.vditor) ?? undefined
    const probe = editorEl?.querySelector(probeSelector) as HTMLElement | null
    const fg = probe ? getComputedStyle(probe).color : ''
    if (fg && fg !== lastFg) {
      lastFg = fg
      reRender(editorEl)
    }
    if (ticks < 14) window.setTimeout(tick, 150) // watch for a late content-theme settle (~2s)
  }
  requestAnimationFrame(tick)
}

function reThemeFlowchart(): void {
  reThemeOnForegroundChange(
    '.vditor-ir__preview .language-flowchart, .vditor-wysiwyg__preview .language-flowchart',
    (root) => reRenderFlowchart(window, root),
  )
}

/** Vega/Vega-Lite bake axis/label/legend/title colours from `getComputedStyle(wrapper).color` at
 *  render time — same late-settle trap as flowchart, so poll the foreground rather than re-rendering
 *  on a fixed delay (which left the axis numbers in the old theme's colour until reopen). */
function reThemeVega(): void {
  reThemeOnForegroundChange(
    '.vditor-ir__preview .language-vega, .vditor-wysiwyg__preview .language-vega,' +
      '.vditor-ir__preview .language-vega-lite, .vditor-wysiwyg__preview .language-vega-lite',
    reRenderVega,
  )
}

/** Re-render PlantUML (dark/light palette) + Graphviz (currentColor) after a theme flip.
 *  Deferred so the content-theme `<link>` and vditor--dark class have settled. */
function reThemePlantumlGraphviz(): void {
  const cdn = lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || ''
  const run = () => {
    const el = activeModeElement(window.vditor) ?? undefined
    reRenderPlantuml(el, cdn)
    reRenderGraphviz(el, cdn)
    reRenderAbc(el, cdn)
    reRenderWavedrom(el ?? undefined)
    reRenderNomnoml(el ?? undefined)
    reRenderGeojson(el ?? undefined)
    reRenderTopojson(el ?? undefined)
    // Vega is re-themed via reThemeVega() (foreground polling) instead — its axis/label colours come
    // from getComputedStyle, which settles too late for this fixed 400ms delay (the old colour stuck).
    reRenderStl(el ?? undefined)
    // One edit covers BOTH theme-flip sites: reThemePlantumlGraphviz() runs from
    // handleSetTheme AND handleConfigChanged, so D2 re-renders on a content-theme flip
    // and a config change alike (D2 SVG bakes currentColor, so a flip needs a re-render).
    reRenderD2(el ?? undefined)
  }
  requestAnimationFrame(run)
  window.setTimeout(run, 400)
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
  const echartsThemeChanged =
    lastInitMsg &&
    lastInitMsg.options?.echartsTheme !== msg.options?.echartsTheme
  const d2LayoutChanged =
    lastInitMsg && lastInitMsg.options?.d2Layout !== msg.options?.d2Layout
  const d2ThemeChanged =
    lastInitMsg && lastInitMsg.options?.d2Theme !== msg.options?.d2Theme
  // Keep the D2 globals current so a re-render uses the new engine + theme (set before any re-render).
  ;(window as any).__vmarkdD2Layout = msg.options?.d2Layout
  ;(window as any).__vmarkdD2Theme = msg.options?.d2Theme
  ;(window as any).__vmarkdAllowRemoteImages = msg.options?.allowRemoteImages
  ;(window as any).__vmarkdContentTheme = msg.options?.contentTheme
  // Mode only rides on a config message when the content theme pins a new light/dark; leave the
  // existing global otherwise (a non-theme config change carries no msg.theme).
  if (typeof msg.theme === 'string')
    (window as any).__vmarkdMode = msg.theme === 'dark' ? 'dark' : 'light'
  // Rendering theme (task 82): a GitHub theme pins the editor's light/dark mode to
  // its own (so content + code blocks are themed, not VS Code-dark). The host sends
  // the new effective mode in msg.theme; re-theme live so the content follows it.
  const contentThemeChanged =
    lastInitMsg &&
    lastInitMsg.options?.contentTheme !== msg.options?.contentTheme
  if (lastInitMsg && initOnlyChanged(lastInitMsg.options, msg.options)) {
    const content =
      window.vditor && !applyingExtensionUpdate
        ? vditor.getValue()
        : lastInitMsg.content
    const wiki = lastInitMsg.wiki
      ? {
          ...lastInitMsg.wiki,
          enabled: msg.options?.wikiEnabled ?? lastInitMsg.wiki.enabled,
        }
      : lastInitMsg.wiki
    initVditor({
      ...lastInitMsg,
      content,
      options: { ...lastInitMsg.options, ...msg.options },
      wiki,
    })
    return
  }
  if (!lastInitMsg || !window.vditor) return
  lastInitMsg.options = { ...lastInitMsg.options, ...msg.options }
  // A content-theme switch flips the effective light/dark mode (e.g. github-dark
  // under a light VS Code theme) — adopt the host's effective mode so the re-theme
  // below uses it. The github <link>/markdown-body class toggle in applyBodyOptions.
  if (contentThemeChanged && typeof msg.theme === 'string') {
    lastInitMsg.theme = msg.theme
  }
  // Code-block + content theme aren't constructor-only options — apply live via
  // setTheme (swaps the hljs stylesheet + UI mode) without re-init, keeping cursor.
  if (codeThemeChanged || contentThemeChanged) {
    applyVditorTheme(lastInitMsg.theme === 'dark' ? 'dark' : 'light')
  }
  // Mermaid theme: apply LIVE via the task-59 offscreen re-render (used to re-init, which
  // scrolled big docs to the top — the reported bug). applyMermaidTheme updates the
  // mermaid.initialize wrapper; reRenderMermaid swaps each diagram's SVG in place. A
  // content-theme switch can change the paired palette / effective mode, so re-render on
  // that too (task 86 — previously mermaid stayed stale until a VS Code theme flip).
  if (mermaidThemeChanged || contentThemeChanged) {
    const mode = lastInitMsg.theme === 'dark' ? 'dark' : 'light'
    applyMermaidTheme(
      window,
      resolveMermaidInit(
        lastInitMsg.options?.mermaidTheme,
        lastInitMsg.options?.contentTheme,
        mode,
      ),
    )
    reRenderMermaid(
      activeModeElement(window.vditor) ?? undefined,
      lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
      mode,
    )
  }
  // ECharts: re-theme live when its own setting changes OR the content theme it pairs with
  // (`auto`) changes (task 90).
  if (echartsThemeChanged || contentThemeChanged) {
    const mode = lastInitMsg.theme === 'dark' ? 'dark' : 'light'
    applyEchartsTheme(
      window,
      resolveEchartsTheme(
        lastInitMsg.options?.echartsTheme,
        lastInitMsg.options?.contentTheme,
        mode,
        readVscodePalette(window),
      ),
    )
    reRenderEcharts(window, activeModeElement(window.vditor) ?? undefined, mode)
  }
  // SMILES follows the page background luminance — a content-theme switch flips that background, so
  // re-theme it too (same reason as handleSetTheme: the bg change doesn't mutate #app).
  if (contentThemeChanged) reThemeSmiles()
  // flowchart.js bakes its foreground colour → re-render on a content-theme switch (deferred so it
  // reads the SETTLED foreground after the content-theme <link> applies).
  if (contentThemeChanged) reThemeFlowchart()
  // Vega axis/label colours come from getComputedStyle → poll the settled foreground (same as flowchart).
  if (contentThemeChanged) reThemeVega()
  if (contentThemeChanged) reThemePlantumlGraphviz()
  // D2 layout engine switch (dagre↔ELK) or colour-theme switch — re-render D2 blocks. (A content-theme
  // change already re-renders D2 via reThemePlantumlGraphviz above — which is what the 'auto' D2 theme
  // needs to follow the content palette — so it's not repeated here.)
  if (d2LayoutChanged || d2ThemeChanged)
    reRenderD2(activeModeElement(window.vditor) ?? undefined)
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

const messageHandlers: Record<string, (msg: HostMessage) => void> = {
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
    wikiDisplayNames.clear()
    if (Array.isArray(msg.displayNames)) {
      for (const n of msg.displayNames as string[]) wikiDisplayNames.add(n)
    }
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
