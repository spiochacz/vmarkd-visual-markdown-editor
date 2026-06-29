import './preload'
import type { HostMessage } from '../../src/protocol'
import { logToHost, reportError } from './webview-log'
import { setD2Config } from './d2-config'

import { fileToBase64, fixCut, fixLinkClick, saveVditorOptions } from './utils'

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
import { isMac } from './platform'
import { setupCustomRenderer } from './custom-renderer'
import { patchLuteSerialize, setKnownPagesRef } from './wiki-serialize'
import { FLASH_CLASS } from './outline'
import { setupToolbarDismiss } from './toolbar-dismiss'
import { preserveCaretAndScroll } from './caret-preserve'
import {
  installEditorCaretTracking,
  restoreEditorCaretIfLost,
} from './editor-caret'
import { Disposables } from './disposables'
import { innerVditor } from './inner-vditor'
import type { InitPayload } from './init-payload'
import { createEditSync, type EditSync } from './edit-sync'
import { runFinishInit } from './finish-init'
import {
  bridgePrepaintScroll,
  removePrerenderOverlay,
  removeStreamSpinner,
  showRealToolbarInOverlay,
  showStreamSpinner,
} from './prerender-overlay'
import { streamRenderIR, STREAM_MIN_CHARS } from './stream-render'

// Lower bound for the content-visibility band (see initVditor). Its own constant —
// NOT reused from LARGE_DOC_CHARS (which gates undo-delay / incremental serialize) —
// because the layout-cost break-even is a different point from the serialize one.
const CONTENT_VIS_MIN_CHARS = 100_000
import { applyBodyOptions, swapStyle, initOnlyChanged } from './live-config'
import { applyMermaidTheme, resolveMermaidInit } from './mermaid-theme'
import { resolveEchartsTheme } from '../../src/echarts-theme'
import { applyEchartsTheme, readVscodePalette } from './echarts-apply'
import { configureDiagramRetheme, rethemeDiagrams } from './diagram-retheme'
import { calloutWysiwygToolbar } from './callouts'
import { observeGapParagraphs, setupTrailingNav } from './gap-paragraph'
import { setupCaretScroll } from './caret-scroll'
import { setupCalloutArrowNav } from './callout-nav'
import { setupHrArrowNav } from './hr-nav'
import { setupHistoryKeybind } from './undo-keybind'
import { setupSaveFlushKeybind } from './save-flush'
import { openLinkFromMarker } from './link-click'
import { installLinkOpenGate, applyLinkOpenSetting } from './link-open-policy'
import { undoDelayForContentLength } from './edit-sync-tuning'
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
// The active editor's edit→host sync controller (task 152 item 1, edit-sync.ts). Set
// per-init; its flush() (Ctrl/Cmd+S), invalidate() (external setValue / streaming) and
// reportDocMode() (status-bar marker) are driven from the handlers + keybind below.
// Null before the first init.
let editSync: EditSync | null = null
// Git-gutter diff markers for the current document (tasks 15/16). Was previously an
// undeclared implicit global — declare it properly at module scope.
let lastDiffChanges: DiffChange[] = []
// The last message Vditor was initialised from — used to re-init when a
// constructor-only setting (toolbar, word count, …) changes live (task 26).
let lastInitMsg: InitPayload | null = null
// Task 38: the content we already booted Vditor from via the inlined `#vmark-init` payload (null when
// we didn't inline-init). The host still posts `init` after `ready`; that echo with identical content
// is no-op'd in handleUpdate so it doesn't re-mount (which would reset caret/scroll).
let inlineInitedContent: string | null = null
// The per-init observer registry (task 152 item 2): runFinishInit re-wires its ~12
// MutationObservers through `observers.set(key, observeX(...))`, which disposes the
// previous observer under that key — replacing the old hand-written `disposeX?.()`
// module-global pairs. Stable singleton across re-inits (the set() calls re-key it).
const observers = new Disposables()

// Shared mutable knownPages set — passed to setupCustomRenderer and updated by
// the host's wiki-update message. Because the custom renderer captures the Set
// reference (not a copy), mutating it here updates chip rendering live.
const wikiKnownPages: Set<string> = new Set()
const wikiDisplayNames: Set<string> = new Set()

// Snapshot the in-editor caret on selectionchange (so Reveal-in-Source survives the
// iframe focus loss); the state + restore live in editor-caret.ts. Wired once.
installEditorCaretTracking()

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

// Step the caret ACROSS void `<hr>` thematic breaks (they have no text node, so the native move
// drops the selection on them → stuck above a rule). Wired once; reads the active editor lazily.
// hr-nav.ts (task 100).
setupHrArrowNav(() =>
  window.vditor ? (activeModeElement(window.vditor) ?? null) : null,
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

// Inject the per-init state the diagram re-theme authority needs (lastInitMsg
// options/cdn read lazily so a re-init is reflected) + the code-theme applier that
// also runs at init. Wired once; rethemeDiagrams (diagram-retheme.ts) then drives
// every renderer's live re-theme from the two flip sites (task 152 items 1+3).
configureDiagramRetheme({
  getOptions: () => lastInitMsg?.options,
  getCdn: () => lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
  applyCodeTheme: applyVditorTheme,
})

function initVditor(msg: InitPayload) {
  lastInitMsg = msg
  // D2 render config (layout/theme/contentTheme/mode) — the typed owner (d2-config.ts)
  // is the single channel custom-diagrams.ts renderD2/reRenderD2 read (task 152 item 5).
  setD2Config({
    layout: msg.options?.d2Layout,
    theme: msg.options?.d2Theme,
    contentTheme: msg.options?.contentTheme,
    mode: msg.theme === 'dark' ? 'dark' : 'light',
    // geojson/topojson basemap style (theme.geoBasemap) — read by initLeafletMap.
    geoBasemap: msg.options?.geoBasemap,
  })
  // Whether remote basemap tiles may load on geojson/topojson maps (task 99) — read by initLeafletMap.
  ;(window as any).__vmarkdAllowRemoteImages = msg.options?.allowRemoteImages
  // Large-document mode flags, fixed for this document's lifetime. Computed once here
  // and handed to createEditSync (status-bar marker) below; willStream also gates the
  // streaming construction path. content-visibility gates main.css's O(viewport) repaint;
  // streaming gates chunked rendering (task 49).
  const docChars = typeof msg.content === 'string' ? msg.content.length : 0
  // Gate content-visibility (main.css) to docs ≥ 100 KB (see CSS comment). Below that the
  // O(n) layout cost is negligible and `contain-intrinsic-size` on contenteditable blocks
  // triggered blank-screen bugs in Chromium 148, so leave small docs untouched. No upper
  // bound: huge docs (which ALSO stream) want it most — it keeps tab-switch repaint O(viewport).
  const cvActive =
    msg.options?.contentVisibility !== false &&
    docChars >= CONTENT_VIS_MIN_CHARS
  const streamActive =
    msg.options?.streamLargeFiles !== false && docChars > STREAM_MIN_CHARS
  document.body.classList.toggle('vmarkd-large-doc', cvActive)
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
  // Debounced edit→host serialize controller (task 152 item 1, edit-sync.ts). It owns
  // the incremental-IR serialize (task 69), the busy-cursor idle path (task 68), the
  // synchronous save flush (task 58) and the status-bar doc-mode report. Suppressed while
  // an extension-update / streaming is in flight (a partial getValue() would post a
  // truncated document) — the flags live here, so they're read through a getter.
  editSync = createEditSync({
    isSuppressed: () => applyingExtensionUpdate || streaming,
    docMode: { cvActive, streamActive, docChars },
  })
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
      // Non-visual helpers that need the full editor DOM (finish-init.ts). Factored
      // out so the streaming path can run them once the whole document is streamed in;
      // main.ts injects the observer registry + edit-sync report + resolved cdn.
      const finishInit = () =>
        runFinishInit(msg, {
          observers,
          cdn: lastInitMsg?.cdn || (window.vditor as any)?.options?.cdn || '',
          reportDocMode: () => editSync?.reportDocMode(),
        })
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
          const irEl = innerVditor()?.ir?.element
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
            editSync?.invalidate()
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
      editSync?.schedule()
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
              // imageFormat is the raw setting string; convertForUpload treats any
              // non-'webp' value as 'original' (safe degrade), so the cast is sound.
              format: opts.imageFormat as 'original' | 'webp' | undefined,
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

function handleUpdate(msg: Extract<HostMessage, { command: 'update' }>) {
  if (msg.type === 'init') {
    // Task 38: the host re-sends `init` after `ready` even when we already inline-inited. If this echo
    // carries the same content we booted from `#vmark-init`, skip the re-mount (it would reset
    // caret/scroll). Cleared either way so a genuine re-init (content changed mid-open) still runs.
    if (inlineInitedContent !== null && msg.content === inlineInitedContent) {
      inlineInitedContent = null
      return
    }
    inlineInitedContent = null
    // A fresh editor: drop any stale gutter bars from a previous instance.
    lastDiffChanges = []
    clearDiffMarkers()
    document.body.setAttribute('data-wiki-file', msg.wiki?.enabled ? '1' : '0')
    applyBodyOptions(msg.options)
    try {
      initVditor(msg)
    } catch (error) {
      // Init failed with the saved options — log it to the Output channel (not the
      // hidden webview console, task 151 item 3) and retry with content only.
      reportError(error, 'initVditor failed; retrying with content only')
      initVditor({ content: msg.content })
      saveVditorOptions()
    }
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
      editSync?.invalidate()
      editSync?.reportDocMode()
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

function handleSetTheme(msg: Extract<HostMessage, { command: 'set-theme' }>) {
  // Live re-theme without re-initialising (keeps cursor/scroll). Chrome colors
  // already follow via --vscode-* CSS vars.
  const theme = msg.theme === 'dark' ? 'dark' : 'light'
  // Keep the mode current so the D2 'auto' theme picks the right light/dark palette when D2
  // re-renders below. Set BEFORE rethemeDiagrams.
  setD2Config({ mode: theme })
  // A VS Code theme flip re-themes EVERYTHING — route through the single authority with all flags on.
  rethemeDiagrams({
    theme,
    code: true,
    mermaid: true,
    echarts: true,
    smiles: true,
    flowchart: true,
    vega: true,
    monoGroup: true,
    geo: true,
    d2: true,
  })
}

function handleConfigChanged(
  msg: Extract<HostMessage, { command: 'config-changed' }>,
) {
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
  const geoBasemapChanged =
    lastInitMsg && lastInitMsg.options?.geoBasemap !== msg.options?.geoBasemap
  // Keep the D2 + geo config current so a re-render uses the new engine/theme/basemap (set before any
  // re-render).
  setD2Config({
    layout: msg.options?.d2Layout,
    theme: msg.options?.d2Theme,
    contentTheme: msg.options?.contentTheme,
    geoBasemap: msg.options?.geoBasemap,
  })
  ;(window as any).__vmarkdAllowRemoteImages = msg.options?.allowRemoteImages
  // Mode only rides on a config message when the content theme pins a new light/dark; leave the
  // existing value otherwise (a non-theme config change carries no msg.theme).
  if (typeof msg.theme === 'string')
    setD2Config({ mode: msg.theme === 'dark' ? 'dark' : 'light' })
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
  // Live re-theme through the single authority (task 152 item 3) — each renderer gated by what
  // actually changed. Code/mermaid/echarts re-theme on their own setting OR a content-theme switch
  // (which can flip the paired palette / effective mode, task 86/90); the foreground-baked +
  // monochrome SVG renderers re-theme on a content switch; D2 fires once for a content switch OR its
  // own layout/theme change (was a separate reRenderD2 that could double-fire with the group).
  rethemeDiagrams({
    theme: lastInitMsg.theme === 'dark' ? 'dark' : 'light',
    code: codeThemeChanged || contentThemeChanged,
    mermaid: mermaidThemeChanged || contentThemeChanged,
    echarts: echartsThemeChanged || contentThemeChanged,
    smiles: contentThemeChanged,
    flowchart: contentThemeChanged,
    vega: contentThemeChanged,
    monoGroup: contentThemeChanged,
    // geojson/topojson re-render on a content flip (palette) OR a geoBasemap setting change. Separate
    // from monoGroup so changing only the basemap doesn't needlessly re-render plantuml/graphviz/etc.
    geo: contentThemeChanged || geoBasemapChanged,
    d2: contentThemeChanged || d2LayoutChanged || d2ThemeChanged,
  })
}

function handleReloadCss(msg: Extract<HostMessage, { command: 'reload-css' }>) {
  // Live CSS swap (tasks 12/26): replace the customCss or external-CSS <style>
  // node in place.
  swapStyle(msg.id, msg.css)
}

function handleGetCursorOffset(
  _msg: Extract<HostMessage, { command: 'get-cursor-offset' }>,
) {
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

function handleDiffInfo(msg: Extract<HostMessage, { command: 'diff-info' }>) {
  // Git gutters (task 17): stash + render the change bars.
  lastDiffChanges = (msg.changes || []) as DiffChange[]
  if (window.vditor) renderDiffMarkers(window.vditor, lastDiffChanges)
}

function handleUploaded(msg: Extract<HostMessage, { command: 'uploaded' }>) {
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
function handleScrollToHeading(
  msg: Extract<HostMessage, { command: 'scroll-to-heading' }>,
) {
  const el = activeModeElement(window.vditor)
  if (!el) return
  const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const target = headings[msg.index] as HTMLElement | undefined
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target.classList.add(FLASH_CLASS)
  setTimeout(() => target.classList.remove(FLASH_CLASS), 1400)
}

// One handler per command, keyed by the HostMessage discriminant so adding a
// command is a compile error until a handler exists (exhaustive) and each handler
// receives its narrowed variant — no `any`, so a field rename in protocol.ts
// breaks here at compile time (task 151).
type HostMessageHandlers = {
  [K in HostMessage['command']]: (
    msg: Extract<HostMessage, { command: K }>,
  ) => void
}

const messageHandlers: HostMessageHandlers = {
  update: handleUpdate,
  'set-theme': handleSetTheme,
  'config-changed': handleConfigChanged,
  'reload-css': handleReloadCss,
  'get-cursor-offset': handleGetCursorOffset,
  'diff-info': handleDiffInfo,
  uploaded: handleUploaded,
  'scroll-to-heading': handleScrollToHeading,
  'wiki-update': (msg) => {
    if (!Array.isArray(msg.pageKeys)) return
    wikiKnownPages.clear()
    for (const k of msg.pageKeys) wikiKnownPages.add(k)
    wikiDisplayNames.clear()
    if (Array.isArray(msg.displayNames)) {
      for (const n of msg.displayNames) wikiDisplayNames.add(n)
    }
  },
}

window.addEventListener('message', (e) => {
  const msg = e.data as HostMessage | undefined
  if (!msg || typeof msg.command !== 'string') return
  // Indexed through a string record because TS can't prove `handler` matches
  // `msg` once the discriminant is a runtime string — the map type above already
  // guarantees each entry is sound, so the per-call narrowing is safe to bridge.
  const handler = (
    messageHandlers as Record<string, ((m: HostMessage) => void) | undefined>
  )[msg.command]
  if (!handler) {
    logToHost(`[main] unhandled host message: ${msg.command}`)
    return
  }
  handler(msg)
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
setupSaveFlushKeybind(window, () => editSync?.flush())

// Task 38: boot Vditor synchronously from the inlined init payload (host emits `#vmark-init` for
// non-wiki, non-huge docs) so we don't wait for the serial `ready→init` roundtrip. Set the echo-guard
// AFTER the init runs (so this first call isn't itself skipped); fall back to `ready→init` if the
// payload is absent (wiki/large docs) or fails to parse. `ready` is still posted so the host runs
// onReady (wiki cache/watcher + the no-op init echo).
const inlineInitEl = document.getElementById('vmark-init')
if (inlineInitEl?.textContent) {
  try {
    const payload = JSON.parse(inlineInitEl.textContent) as InitPayload
    handleUpdate({ command: 'update' as const, ...payload })
    inlineInitedContent = payload.content
  } catch (err) {
    logToHost(
      `[main] inline init failed, falling back to ready→init: ${String(err)}`,
    )
  }
}

vscode.postMessage({ command: 'ready' })
