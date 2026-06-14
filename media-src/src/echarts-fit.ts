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

type EchartsInstance = { resize?: () => void }
type EchartsGlobal = {
  getInstanceByDom?: (el: Element) => EchartsInstance | null | undefined
}

const TRAILING_MS = 120

let installed = false

export function installEchartsResize(
  win: Window & { echarts?: EchartsGlobal },
): void {
  if (installed) return
  installed = true
  const fit = () => {
    const ec = win.echarts
    if (!ec?.getInstanceByDom) return
    for (const el of Array.from(
      win.document.querySelectorAll<HTMLElement>(
        '.language-echarts, .language-mindmap',
      ),
    )) {
      // Skip HIDDEN containers (clientWidth 0 — e.g. the IR pane while the full Preview overlay is
      // shown). Resizing a chart to a 0×0 container collapses it to nothing, and since no resize
      // event fires when it's shown again, it would stay blank — "po przełączeniu z preview na
      // edycję echarts się nie pojawia". Skipping keeps its last good size until it's visible again.
      if (el.clientWidth === 0 || el.clientHeight === 0) continue
      const inst = ec.getInstanceByDom(el)
      try {
        inst?.resize?.()
      } catch {
        /* a single chart must never throw into the resize handler */
      }
    }
  }
  let trailing = 0
  const onResize = () => {
    win.clearTimeout(trailing)
    trailing = win.setTimeout(fit, TRAILING_MS)
  }
  win.addEventListener('resize', onResize)
}
