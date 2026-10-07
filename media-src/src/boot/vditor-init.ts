// Vditor construction + the init/re-init lifecycle (task 399, split out of main.ts).
// Owns building a live Vditor instance from an InitPayload — including the
// large-document streaming path — and the thin live-theme wrapper. Reads/writes
// the fields of sessionState it shares with message-router.ts (which drives
// re-inits from host messages); state that's purely internal to this lifecycle
// (the observer registry) stays local to this module.
import type { InitPayload } from './init-payload'
import Vditor from 'vditor/src/index'
import { d2ConfigFromOptions, setD2Config } from '../diagram-kit/d2-config'
import { buildVditorOptions, codeHljsStyle } from './vditor-options'
import { setVditorTheme } from './vditor-theme'
import { createUploadHandler } from '../clipboard/upload-handler'
import { lang } from '../util/lang'
import { createToolbar } from '../chrome/toolbar'
import {
  installReflowToggleSync,
  syncReflowToggle,
  toggleReflowLineBreaks,
} from '../editing/reflow-toggle'
import { setupCustomRenderer } from '../links/custom-renderer'
import { patchLuteSerialize, setKnownPagesRef } from '../links/wiki-serialize'
import { Disposables } from '../util/disposables'
import { innerVditor } from '../util/inner-vditor'
import { createEditSync } from '../bridge/edit-sync'
import { runFinishInit } from './finish-init'
import { openInPreview } from '../chrome/open-preview'
import {
  bridgePrepaintScroll,
  removePrerenderOverlay,
  removeStreamSpinner,
  showRealToolbarInOverlay,
  showStreamSpinner,
} from '../chrome/prerender-overlay'
import { streamRenderIR, STREAM_MIN_CHARS } from '../diagrams/stream-render'
import { setRenderCacheConfig } from '../diagrams/render-cache-client'
import {
  applyMermaidTheme,
  resolveMermaidInit,
} from '../diagrams/mermaid/mermaid-theme'
import { resolveEchartsTheme } from '../../../src/shared/echarts-theme'
import { applyEchartsTheme, readVscodePalette } from '../diagrams/echarts-apply'
import {
  applyFlowchartLabelHalo,
  flowchartDrawOptions,
} from '../diagrams/flowchart-retheme'
import { calloutWysiwygToolbar } from '../editing/callouts'
import { openLinkFromMarker } from '../links/link-click'
import { tryScrollToSameDocAnchor } from '../links/same-doc-anchor'
import { applyLinkOpenSetting } from '../links/link-open-policy'
import { applyPasteUrlSetting } from '../links/link-url'
import { applyPasteCsvSetting } from '../clipboard/paste-table'
import { applySlugifyModeSetting } from '../links/same-doc-anchor'
import { applyHardBreakStyle } from '../../../src/shared/lute-hard-break'
import { applyReflowLineBreaks } from '../editing/reflow-line-breaks'
import { undoDelayForContentLength } from '../bridge/edit-sync-tuning'
import { setPersistModeOverride } from '../chrome/toolbar-actions'
import { sessionState } from './editor-session-state'

// Lower bound for the content-visibility band (see initVditor). Its own constant —
// NOT reused from LARGE_DOC_CHARS (which gates undo-delay / incremental serialize) —
// because the layout-cost break-even is a different point from the serialize one.
const CONTENT_VIS_MIN_CHARS = 100_000

// The per-init observer registry (task 152 item 2): runFinishInit re-wires its ~12
// MutationObservers through `observers.set(key, observeX(...))`, which disposes the
// previous observer under that key — replacing the old hand-written `disposeX?.()`
// module-global pairs. Stable singleton across re-inits (the set() calls re-key it).
// Local to this module — nothing outside the init lifecycle touches it.
const observers = new Disposables()

// Apply the editor's light/dark mode + paired code style to the live Vditor. Thin
// wrapper that pulls the current instance/options/cdn from sessionState; the Vditor
// theme-API coupling itself lives in vditor-theme.ts (setVditorTheme). Used by both
// init (after()) and live switching (wired to the diagram-retheme authority in
// main.ts's one-time configureDiagramRetheme call).
export function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  setVditorTheme(
    window.vditor,
    theme,
    codeHljsStyle(theme, sessionState.lastInitMsg?.options),
    sessionState.lastInitMsg?.cdn,
  )
}

// Task 184 (narrowed task 408) — the cache themeKey: the GLOBAL fragment, i.e. everything that
// changes EVERY diagram engine's render output regardless of which one it is (mode + content
// theme + font size). A change here flips every hash → a miss → a live re-render (correct), while
// the old entry lingers for an instant flip-back. Per-engine settings (mermaidTheme, d2Layout, …)
// used to live here too — folded into one flat string every engine's hash shared, so e.g. a
// D2-only setting change silently invalidated mermaid's/vega's/etc. cached SVGs too. They now feed
// render-cache-client.ts's per-lang engineCacheKeyFragment instead (task 408's diagram-config-
// delta.ts, driven by each engine's registry-declared configKeys), so hashOf combines this GLOBAL
// fragment with the one affected engine's OWN fragment. Exported: message-router.ts's
// handleConfigChanged re-keys the cache on a live config change.
export function renderCacheThemeKey(msg: InitPayload): string {
  const o = msg.options ?? {}
  const mode = msg.theme === 'dark' ? 'dark' : 'light'
  return [mode, o.contentTheme, o.fontSize].map((v) => v ?? '').join('|')
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: builds Vditor's full init options across every render-engine/theme/mode config channel; pre-existing (task 469 baseline)
export function initVditor(msg: InitPayload) {
  sessionState.lastInitMsg = msg
  // D2 render config (layout/theme/contentTheme/mode) — the typed owner (d2-config.ts)
  // is the single channel custom-diagrams.ts renderD2/reRenderD2 read (task 152 item 5).
  setD2Config({
    ...d2ConfigFromOptions(msg.options),
    mode: msg.theme === 'dark' ? 'dark' : 'light',
  })
  // Whether remote basemap tiles may load on geojson/topojson maps (task 99) — read by initLeafletMap.
  ;(window as any).__vmarkdAllowRemoteImages = msg.options?.allowRemoteImages
  // Task 175/180 — defer the per-keystroke spin in fenced diagram/code bodies + for inert prose
  // keystrokes. ALWAYS ON (no user setting); edit-activity reads window.__vmarkdFast* as a `!== false`
  // default-on, so an unset global = ON. (The globals remain a test-only seam for the 175/180 spikes.)
  // Task 184 — persistent diagram render cache (always on). The version + themeKey fold every
  // render determinant into the cache hash so a theme/engine change misses; cdn + mode feed the
  // native cache-miss offscreen re-render.
  setRenderCacheConfig({
    version: msg.options?.assetsVersion ?? '0',
    themeKey: renderCacheThemeKey(msg),
    // Task 408 — the per-engine settings hashOf reads via engineCacheKeyFragment (mermaidTheme,
    // d2Layout, …) live in `options`, not the (now-reduced) global themeKey above.
    options: msg.options,
    cdn: msg.cdn || (window.vditor as any)?.options?.cdn || '',
    mode: msg.theme === 'dark' ? 'dark' : 'light',
  })
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
  // Task 112 — opt-in ELK layout for mermaid. Stash the setting + cdn on window: mermaid-theme.ts's
  // initialize wrapper reads __vmarkdMermaidLayout to inject `config.layout`, and elk-bundled-shim reads
  // __vmarkdCdn to boot the shared ELK. No pre-load/settle needed: mermaid-theme.ts registers the ELK
  // loaders synchronously the moment mermaid loads, and mermaid AWAITS the (lazy) loader before its first
  // render — so an ELK diagram is ELK on first paint (no dagre flash) while a dagre doc fetches nothing.
  const cdn = msg.cdn || (window.vditor as any)?.options?.cdn || ''
  ;(window as any).__vmarkdCdn = cdn
  ;(window as any).__vmarkdMermaidLayout = msg.options?.mermaidLayout
  // Task 376 — the patched flowchartRender reads its drawSVG colours through this global, so the
  // FIRST render and the live re-theme (diagram-retheme → reRenderFlowchart) share one definition
  // instead of two copies that can drift. The patch keeps its own foreground fallback for the case
  // where this global is not there yet.
  ;(window as any).__vmarkdFlowchartOpts = (el: HTMLElement) =>
    flowchartDrawOptions(window, el)
  // …and the post-draw pass (task 378: halo the edge labels so the routed line doesn't strike
  // through them). Same reason it lives here: one definition for the first render and the re-theme.
  ;(window as any).__vmarkdFlowchartAfterDraw = (el: HTMLElement) =>
    applyFlowchartLabelHalo(window, el)
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
  // Task 392 — paste-a-URL-as-a-link, on by default and switchable off.
  applyPasteUrlSetting(msg.options?.pasteUrlAsLink)
  // Task 218 — a change to vmarkd.paste.csvFormat must take effect without a reopen, exactly like
  // the URL-paste toggle above.
  applyPasteCsvSetting(msg.options?.pasteCsvAsTable)
  // Task 243 — which heading-slug flavor `#fragment` anchor links resolve against.
  applySlugifyModeSetting(msg.options?.slugifyMode)
  // Task 530 — how a new hard line break (Shift+Enter) is written; live, like the toggles above.
  applyHardBreakStyle(msg.options?.hardBreakStyle)
  // Task 83 — soft line breaks reflow in the Preview (the flag must be set before the first preview render).
  applyReflowLineBreaks(msg.options?.reflowLineBreaks)
  // Debounced edit→host serialize controller (task 152 item 1, edit-sync.ts). It owns
  // the incremental-IR serialize (task 69), the busy-cursor idle path (task 68), the
  // synchronous save flush (task 58) and the status-bar doc-mode report. Suppressed while
  // an extension-update / streaming is in flight (a partial getValue() would post a
  // truncated document) — the flags live on sessionState, so they're read through a getter.
  sessionState.editSync = createEditSync({
    isSuppressed: () =>
      sessionState.applyingExtensionUpdate || sessionState.streaming,
    docMode: { cvActive, streamActive, docChars },
  })
  const defaultOptions = buildVditorOptions(msg)
  // Task 187: streaming writes DIRECTLY into the IR pane (streamRenderIR) — booting a
  // streamed (huge) doc in a persisted sv/wysiwyg mode would show an EMPTY visible pane
  // while the hidden IR fills (and an edit there could save emptiness). Booting sv
  // directly instead is a measured 5 s whole-doc Md2VditorSVDOM at 312k chars (12 s+ at
  // the streaming threshold) — the exact freeze streaming exists to kill — so the
  // streamed open runs in IR. SESSION-ONLY: setPersistModeOverride keeps save-options
  // persisting the USER'S mode until they explicitly switch (their sv preference must
  // not be stomped by an unrelated toolbar click in this session). Chunked sv streaming
  // is the recorded follow-up (task 187 file).
  if (streamActive && defaultOptions.mode !== 'ir') {
    setPersistModeOverride(defaultOptions.mode)
    defaultOptions.mode = 'ir'
  }
  if (window.vditor) {
    vditor.destroy()
    // `Window.vditor` is typed non-nullable (vscode-api.ts) — true for the whole session except
    // this one transient tick between destroy() and the reconstruction below, which re-assigns
    // it through the same `any` bridge two lines down (source vs dist Vditor identity mismatch).
    ;(window as any).vditor = null
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
        : createToolbar({
            wikiEnabled: Boolean(msg.wiki?.enabled),
            onToggleReflow: toggleReflowLineBreaks,
          }),
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
        openLinkFromMarker(markerEl, (m) => {
          // Task 243 — same as fixLinkClick's real-<a> path: a bare `#fragment` IR marker
          // resolves + scrolls in-process (never posted to the host) before falling through
          // to the normal open-link post for every other href shape.
          if (
            m.command === 'open-link' &&
            tryScrollToSameDocAnchor(m.href, window.vditor)
          ) {
            return
          }
          vscode.postMessage(m)
        }),
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
                    sessionState.wikiDisplayNames.size > 0
                      ? sessionState.wikiDisplayNames
                      : sessionState.wikiKnownPages
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
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: post-mount wiring for every non-visual helper that needs the full editor DOM (wiki/caret/theme/diagram runtime, …); pre-existing (task 469 baseline)
    after() {
      // The toolbar is attached to the document by now: (re)assert the reflow toggle's pressed state.
      syncReflowToggle()
      const wikiEnabled = Boolean(msg.wiki?.enabled)
      // Non-visual helpers that need the full editor DOM (finish-init.ts). Factored
      // out so the streaming path can run them once the whole document is streamed in;
      // this injects the observer registry + edit-sync report + resolved cdn.
      const finishInit = () =>
        runFinishInit(msg, {
          observers,
          cdn:
            sessionState.lastInitMsg?.cdn ||
            (window.vditor as any)?.options?.cdn ||
            '',
          reportDocMode: () => sessionState.editSync?.reportDocMode(),
        })
      try {
        // Force the theme through setTheme at init (constructor options don't
        // reliably apply content/code theme — see applyVditorTheme).
        applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
        // Register wiki renderers on the lute instance BEFORE any content render, so
        // both the monolithic path and the streamed chunks (same lute) emit chips.
        // Populate the shared knownPages set (updated live by wiki-update).
        sessionState.wikiKnownPages.clear()
        sessionState.wikiDisplayNames.clear()
        // `wikiEnabled` (Boolean(msg.wiki?.enabled)) already implies `msg.wiki` exists, but that's
        // not visible to control-flow narrowing through a separate boolean variable — `?.` here
        // re-establishes the same guard TS can actually track.
        if (wikiEnabled && msg.wiki?.pageKeys) {
          for (const k of msg.wiki.pageKeys as string[])
            sessionState.wikiKnownPages.add(k)
        }
        if (wikiEnabled && msg.wiki?.displayNames) {
          for (const n of msg.wiki.displayNames as string[])
            sessionState.wikiDisplayNames.add(n)
        }
        setupCustomRenderer(window.vditor, {
          enabled: wikiEnabled,
          knownPages: wikiEnabled ? sessionState.wikiKnownPages : undefined,
        })
        if (wikiEnabled) {
          setKnownPagesRef(sessionState.wikiKnownPages)
          patchLuteSerialize(window.vditor)
        }

        if (willStream) {
          // Large doc (task 49): stream it in chunk-by-chunk. Keep the instant-paint
          // overlay until the first chunk paints; hold the editor read-only and
          // suspend the edit→host sync (a partial getValue() would save a truncated
          // file) until the full document is in.
          sessionState.streaming = true
          const irEl = innerVditor()?.ir?.element
          // Read-only during the stream (avoids edit↔append races), but tag it so
          // our CSS cancels Vditor's [contenteditable=false] { opacity:.3 } fade —
          // the doc should look normal while it fills in, not greyed-out/disabled.
          irEl?.setAttribute('contenteditable', 'false')
          irEl?.classList.add('vmarkd-streaming')
          const endStream = () => {
            sessionState.streaming = false
            irEl?.setAttribute('contenteditable', 'true')
            irEl?.classList.remove('vmarkd-streaming')
            // The streamed DOM is a wholesale build → drop the IR cache (task 69).
            sessionState.editSync?.invalidate()
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
          sessionState.applyingExtensionUpdate = true
          try {
            vditor.setValue(msg.content)
          } finally {
            setTimeout(() => {
              sessionState.applyingExtensionUpdate = false
            }, 0)
          }
        }
        finishInit()
        // Task 282 — boot straight into the Preview overlay when configured. Deliberately NOT done
        // on the streaming path: rendering a >700KB document into the preview pane is the same
        // whole-doc freeze the streaming gate above exists to avoid, so a huge file opens editable
        // regardless of this setting (the gate already overrides the mode there for the same
        // reason). After finishInit so the toolbar and observers are live.
        if (msg.options?.defaultMode === 'preview') openInPreview()
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
      if (sessionState.applyingExtensionUpdate || sessionState.streaming) {
        return
      }
      sessionState.editSync?.schedule()
    },
    upload: {
      url: '/fuzzy', // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      // Split out to upload-handler.ts (task 191 §5.4) so the e2e harness drives the real
      // handler; it converts per vmarkd.image.* and posts a sanitized upload message.
      handler: createUploadHandler(() => sessionState.lastInitMsg?.options),
    },
  })
  // Vditor built its toolbar synchronously above (icons and all); surface it in
  // the instant-paint overlay now, while Lute is still loading (see helper).
  // Pressed state of the reflow toggle must be on the toolbar BEFORE it is cloned into the overlay (no flicker).
  syncReflowToggle()
  installReflowToggleSync()
  showRealToolbarInOverlay()
  // Failsafe: after() normally drops the overlay in ~150 ms. But if the webview's
  // own Lute script never loads (network/resource failure), after() never fires
  // and the overlay would stay forever — a frozen, non-interactive teaser. Force
  // it gone after a generous grace period so a broken load degrades to the (empty)
  // editor the user can reload, instead of an indefinite hang. Idempotent no-op
  // on the normal path.
  setTimeout(removePrerenderOverlay, 8000)
}
