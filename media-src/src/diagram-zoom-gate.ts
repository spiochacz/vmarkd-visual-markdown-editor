// Ctrl-to-interact gate for the zooming diagram renderers (markmap + ECharts mindmap).
//
// Both capture the wheel (zoom) and drag (pan) the moment the pointer is over them, so scrolling
// the page with the pointer over a diagram zooms it instead of scrolling the document
// ("przechwytuje kursor"). markmap uses d3-zoom (a non-passive `wheel` handler bound on its <svg>);
// the ECharts mindmap uses `roam` (handlers bound deep on the zr <canvas>). Neither exposes a
// reliable per-event Ctrl filter we can configure from outside, so we gate at the DOM with a
// CAPTURE-phase listener on the document: a wheel/mousedown over a RENDERED diagram is blocked from
// reaching the renderer UNLESS Ctrl is held. The capture listener on the document ancestor runs
// before the renderer's own handlers (which are bound deeper), so stopImmediatePropagation keeps
// the event from ever reaching them — and because we never preventDefault the wheel (the listener
// is passive), the document is free to scroll.
//
// Result: plain wheel → page scrolls; Ctrl+wheel → zoom; plain drag → nothing; Ctrl+drag → pan
// (markmap also gets a d3-zoom `.filter` override in the esbuild patch so Ctrl+drag actually pans;
// the mindmap's ECharts roam pans on Ctrl+drag for free once the gate lets the gesture through).
//
// Scoped to RENDERED diagrams only (inside a preview pane) — never the editable source
// `<code class="language-markmap|mindmap">`. Installed once per webview (idempotent); document-level,
// so it survives IR/WYSIWYG/Preview switches and the DOM rebuilds Vditor does per keystroke.

let installed = false

const RENDERED_DIAGRAM = '.language-markmap, .language-mindmap'
const PREVIEW_PANES =
  '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview'

function inRenderedDiagram(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  const diagram = el?.closest(RENDERED_DIAGRAM)
  if (!diagram) return false
  return !!diagram.closest(PREVIEW_PANES)
}

export function installDiagramZoomGate(doc: Document = document): void {
  if (installed) return
  installed = true
  const gate = (e: Event): void => {
    // Ctrl held → let the renderer zoom/pan. Otherwise suppress it over a rendered diagram so the
    // page scrolls (wheel) / nothing happens (drag) instead of the diagram grabbing the gesture.
    if ((e as MouseEvent).ctrlKey) return
    if (!inRenderedDiagram(e.target)) return
    e.stopImmediatePropagation()
  }
  // passive wheel: we only stopImmediatePropagation (allowed while passive) — never preventDefault,
  // so the document scrolls normally. mousedown is non-passive (it only stops propagation too).
  doc.addEventListener('wheel', gate, { capture: true, passive: true })
  doc.addEventListener('mousedown', gate, { capture: true })
}
