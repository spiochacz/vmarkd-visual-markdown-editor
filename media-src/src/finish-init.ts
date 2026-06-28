import type { InitPayload } from './init-payload'
import type { Disposables } from './disposables'
import { innerVditor } from './inner-vditor'
import { activeModeElement } from './source-map'
import { fixPanelHover, fixResponsiveTables, handleToolbarClick } from './utils'
import { guardToolbarScroll } from './toolbar-scroll-guard'
import { fixTableIr } from './fix-table-ir'
import { setupOutlineFlash } from './outline'
import { setupOutlineResize } from './outline-resize'
import { setupSplitScrollSync } from './split-scroll-sync'
import { setupPreviewScrollPreserve } from './preview-scroll-preserve'
import { observeCallouts } from './callouts'
import { observeDiagramZoom } from './diagram-zoom'
import { observeHtmlComments, observePreviewComments } from './html-comment'
import { observeCodeSource } from './code-source'
import {
  ensureHljsLoaded,
  observeWysiwygCodeHighlight,
  wrapLuteFlatten,
} from './wysiwyg-code-highlight'
import { observeTrailingParagraph } from './gap-paragraph'
import { installDiagramZoomGate } from './diagram-zoom-gate'
import { installEchartsResize } from './echarts-fit'
import { observeSmiles } from './smiles-render'
import { observeCustomDiagrams } from './custom-diagrams'
import { installMarkmapResize } from './markmap-fit'
import { observeAbc } from './abc-fit'
import { observeMindmaps } from './echarts-retheme'

export interface FinishInitDeps {
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
  fixPanelHover()
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
  const app = document.getElementById('app')
  const previewEl = innerVditor()?.preview?.previewElement
  observers.set('callouts', observeCallouts(app))
  // The full Preview overlay (`.vditor-preview`) is rendered by Lute, which emits `[!TYPE]`
  // callouts as PLAIN blockquotes — so style them there too (same dual-node: tag + inject the
  // render). The preview never gets `--expand` (no caret), so it stays "collapsed" → the CSS shows
  // the injected render + hides the source, identical to a collapsed IR callout (so Edit↔Preview
  // match in look AND height). The observer re-applies after each preview re-render (fresh innerHTML).
  observers.set('preview-callouts', observeCallouts(previewEl))
  // HTML comments (`<!-- ... -->`): the browser-invisible preview is replaced with visible
  // styled text (html-comment.ts). Bound to #app (same rationale as callouts — survives mode
  // switches). Preview pane gets its own walker (Comment nodes, not data-type wrappers).
  // Inline zoom/pan + ⛶ fullscreen button on rendered static-SVG diagrams (d2/mermaid/flowchart/
  // graphviz/abc/smiles). Bound to #app (survives mode switches + async/per-keystroke rebuilds), same
  // pattern as callouts. markmap/mindmap have their own zoom (diagram-zoom-gate.ts) and are excluded.
  observers.set('diagram-zoom', observeDiagramZoom(app))
  observers.set('html-comments', observeHtmlComments(app))
  observers.set('preview-html-comments', observePreviewComments(previewEl))
  // Code-block edit surface: tag the editable source `<code>` with `.hljs` so the highlight.js
  // theme styles it like the render (size/padding/bg/base colour) — editing matches preview, no
  // shift. Survives IR DOM rebuilds via its own observer; round-trips (class is invisible to Lute).
  observers.set(
    'code-source',
    observeCodeSource(activeModeElement(window.vditor)),
  )
  // WYSIWYG live code highlighting: while editing a code block in WYSIWYG, paint live syntax
  // colours onto the editable source via the CSS Custom Highlight API (zero DOM mutation, so
  // Lute serialisation/typing stay intact — unlike IR, whose source is monochrome). Bound to the
  // stable `#app` mount (not activeModeElement): the default mode is IR, and runFinishInit runs
  // once, so we must keep working after a later switch into WYSIWYG. hljs is eager-loaded here so
  // highlighting is ready from the start instead of lazily on first render.
  // Make our hljs token spans invisible to Lute (it reparses the wysiwyg source every keystroke +
  // on getValue) so the highlighted edit surface still round-trips byte-clean. Idempotent per Lute.
  wrapLuteFlatten(window.vditor)
  // Eager-load hljs for WYSIWYG live code highlighting so it downloads IN PARALLEL with the diagram
  // engines from the start. addScript appends an async <script> — this does NOT block first paint.
  // Do NOT defer it to requestIdleCallback (task 145 item 1 tried that, REVERTED 2026-06-28): on a
  // diagram-heavy doc the main thread stays busy (D2 wasm compile ~470 ms, mermaid/echarts), so the
  // idle callback starves for seconds and code colouring loads LAST, behind the diagrams ("in
  // sequence"). The observer below reads window.hljs lazily; IR code is highlighted by Vditor's own
  // lazy hljs load too.
  ensureHljsLoaded(cdn).then(() =>
    // Nudge the highlighter once the script lands, in case a code block is already focused + idle.
    document.dispatchEvent(new Event('selectionchange')),
  )
  observers.set(
    'wysiwyg-highlight',
    observeWysiwygCodeHighlight(app, () => (window as any).hljs),
  )
  // Trailing-paragraph invariant: a document ending with a block (callout/code/table/…)
  // always offers an empty paragraph below it — without one there is NO caret position
  // after the last block (arrow-down at EOF dropped the selection → caret+view jumped to
  // the top). Tag is serializer-invisible; survives IR rebuilds via its own observer.
  observers.set(
    'trailing',
    observeTrailingParagraph(activeModeElement(window.vditor)),
  )
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
  observers.set('smiles', observeSmiles(app))
  observers.set('custom-diagrams', observeCustomDiagrams(app))
  // markmap fits its tree to the container only at create time and clips (doesn't shrink) when the
  // column is later resized. Re-fit every visible markmap on a (debounced) window resize — same
  // window-resize-only strategy as installEchartsResize (no mode-switch 0-collapse). Idempotent.
  installMarkmapResize(window)
  // abc (music notation) renders an svg with no viewBox → it clips (doesn't scale) when the column
  // narrows, and is even clipped at the default width. Add a viewBox from its width/height attrs so
  // the main.css max-width:100% scales it. Bound to #app; idempotent (skips svgs that have a viewBox).
  observers.set('abc', observeAbc(app))
  // mindmap (ECharts tree) renders into a tall stock canvas → big empty vertical gaps around a short
  // wide tree. Re-fit it to its content height (≈ leaf count) on render. Idempotent (width+height+
  // theme signature). Window-resize re-fit is handled by installEchartsResize → reconstructMindmaps.
  observers.set('mindmap', observeMindmaps(window, app))
  reportDocMode()
}
