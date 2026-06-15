// ECharts charts/mindmaps are init'd at the container width ONCE and echarts installs NO resize
// handler, so when the VS Code window / editor pane is resized the chart keeps its old pixel width:
// it stays anchored left while the container grows to the right ("lewa nie zmienia, prawa rozciąga
// się w prawo"). Add the standard responsive handler: on window 'resize', resize every echarts
// instance to fill its container.
//
// IMPORTANT: listen ONLY to `window` resize — NOT a MutationObserver/ResizeObserver. A mode switch
// (Preview→IR/WYSIWYG) does not change the window size, so this never fires during that DOM churn.
// An earlier ResizeObserver-based "fit" DID fire on the switch, and resize() during the churn
// flickered the IR diagram's editable source text behind the canvas ("tekst w tle"). A window
// resize redraws the canvas in place with the source still hidden, so there is no flicker.
//
// Debounce strategy: a TRAILING timeout (re-armed on every resize event), so we fit once the burst
// of resize events settles — to the SETTLED container width, not an intermediate one mid-animation
// (e.g. collapsing the sidebar). We deliberately use setTimeout, NOT requestAnimationFrame: rAF is
// throttled/paused when the webview is backgrounded, which made the fit unreliable; a timer still
// fires. A short delay keeps a live window drag feeling responsive.

import { reconstructMindmaps } from './echarts-retheme'

type EchartsInstance = { resize?: () => void }
type EchartsGlobal = {
  getInstanceByDom?: (el: Element) => EchartsInstance | null | undefined
}

const TRAILING_MS = 120

let installed = false

export function installEchartsResize(
  win: Window & {
    echarts?: EchartsGlobal
    __vmarkdEchartsResolve?: (ec: unknown) => string | undefined
  },
): void {
  if (installed) return
  installed = true
  const fit = () => {
    const ec = win.echarts
    if (!ec?.getInstanceByDom) return
    // Charts have a live, retrievable instance → cheap resize() (re-reads the container + redraws).
    for (const el of Array.from(
      win.document.querySelectorAll<HTMLElement>('.language-echarts'),
    )) {
      // Skip HIDDEN containers (clientWidth 0 — e.g. the IR pane while the full Preview overlay is
      // shown). Resizing a chart to a 0×0 container collapses it to nothing, and since no resize
      // event fires when it's shown again, it would stay blank — "po przełączeniu z preview na
      // edycję echarts się nie pojawia". Skipping keeps its last good size until it's visible again.
      if (el.clientWidth === 0 || el.clientHeight === 0) continue
      try {
        ec.getInstanceByDom(el)?.resize?.()
      } catch {
        /* a single chart must never throw into the resize handler */
      }
    }
    // Mindmaps are a snapshot canvas with NO retrievable instance → resize() is a no-op. Rebuild
    // them from `data-code` at the new container size instead (reconstructMindmaps skips hidden).
    const name = win.__vmarkdEchartsResolve?.(ec)
    reconstructMindmaps(win, win.document, name)
  }
  let trailing = 0
  const onResize = () => {
    win.clearTimeout(trailing)
    trailing = win.setTimeout(fit, TRAILING_MS)
  }
  win.addEventListener('resize', onResize)
  // FIRST-RENDER race: echarts sizes its canvas to the container's clientWidth at init() and never
  // re-fits itself. When init() (after the async script load) runs BEFORE the editor's reading-column
  // width settles (instant-paint→live swap / iframe layout), the canvas captures a too-wide size and,
  // since no window 'resize' fires afterward, stays wide ("czasami pierwszy render za szeroki"). Re-fit
  // a few times over the first ~2s to catch the settle. Safe: this runs during quiet init, NOT during
  // a mode-switch transition (the churn that made an unconditional ResizeObserver flicker), and with
  // animation:false a resize() of an already-correct chart is a cheap no-op.
  for (const d of [150, 450, 1000, 2000]) win.setTimeout(fit, d)
}
