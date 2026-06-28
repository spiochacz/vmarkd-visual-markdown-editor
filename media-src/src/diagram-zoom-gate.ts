// Ctrl-to-interact gate for the interactive diagram renderers:
//   - markmap + ECharts mindmap: wheel = zoom, drag = pan — both grab the pointer the moment it's over
//     them, so a plain scroll/drag over the diagram hijacks the gesture ("przechwytuje kursor").
//   - geojson/topojson Leaflet maps: a plain drag PANS the map (Leaflet `dragging` defaults on);
//     wheel-zoom is already off (scrollWheelZoom:false). Same hijack class — gate the pan behind Ctrl.
//
// markmap uses d3-zoom (a non-passive `wheel` on its <svg>); the ECharts mindmap uses `roam`
// (handlers deep on the zr <canvas>); Leaflet binds drag on `mousedown` deep in the map pane. None
// exposes a reliable per-event Ctrl filter we can configure from outside, so we gate at the DOM with a
// CAPTURE-phase listener on the document: a wheel/mousedown over a RENDERED diagram is blocked from
// reaching the renderer UNLESS Ctrl is held. The capture listener on the document ancestor runs before
// the renderer's own (deeper) handlers, so stopImmediatePropagation keeps the event from ever reaching
// them — and because we never preventDefault the wheel (the listener is passive), the document is free
// to scroll.
//
// Result: plain wheel → page scrolls; Ctrl+wheel → zoom; plain drag → nothing; Ctrl+drag → pan
// (markmap also gets a d3-zoom `.filter` override in the esbuild patch so Ctrl+drag actually pans; the
// mindmap's ECharts `roam` and Leaflet's `dragging` both pan on Ctrl+drag for free once the gate lets
// the gesture through — neither filters on Ctrl itself).
//
// Leaflet EXCEPTION: a map's +/- zoom control (and the attribution control) must stay plain-clickable.
// Our document-CAPTURE gate runs BEFORE Leaflet's own bubble-phase `disableClickPropagation`, so it
// would otherwise swallow the control click — so exempt any event whose target is inside a
// `.leaflet-control` (a control click is not a pan gesture). markmap/mindmap have no such sub-controls,
// so the exemption is a no-op for them.
//
// Scoped to RENDERED diagrams only (inside a preview pane) — never the editable source
// `<code class="language-…">`. Installed once per webview (idempotent); document-level, so it
// survives IR/WYSIWYG/Preview switches and the DOM rebuilds Vditor does per keystroke.

let installed = false

const RENDERED_DIAGRAM =
  '.language-markmap, .language-mindmap, .language-geojson, .language-topojson'
const PREVIEW_PANES =
  '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview'
// Leaflet's zoom (+/-) + attribution controls — clicking them is not a pan, so it must reach Leaflet.
const LEAFLET_CONTROL = '.leaflet-control'

// The rendered diagram this event should be suppressed for, or null to let it through.
function gatedDiagram(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : null
  const diagram = el?.closest(RENDERED_DIAGRAM) ?? null
  if (!diagram?.closest(PREVIEW_PANES)) return null
  // A click on a Leaflet map's +/- / attribution control is not a pan — let it reach Leaflet.
  if (el?.closest(LEAFLET_CONTROL)) return null
  return diagram
}

export function installDiagramZoomGate(doc: Document = document): void {
  if (installed) return
  installed = true
  const gate = (e: Event): void => {
    // Ctrl held → let the renderer zoom/pan. Otherwise suppress it over a rendered diagram so the
    // page scrolls (wheel) / nothing happens (drag) instead of the diagram grabbing the gesture.
    if ((e as MouseEvent).ctrlKey) return
    if (!gatedDiagram(e.target)) return
    e.stopImmediatePropagation()
  }
  // passive wheel: we only stopImmediatePropagation (allowed while passive) — never preventDefault,
  // so the document scrolls normally. mousedown is non-passive (it only stops propagation too).
  doc.addEventListener('wheel', gate, { capture: true, passive: true })
  doc.addEventListener('mousedown', gate, { capture: true })
}
