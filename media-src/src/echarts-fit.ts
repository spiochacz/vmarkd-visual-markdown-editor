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
// Debounce strategy: a per-frame throttle (rAF) keeps it smooth DURING a live drag, AND a trailing
// timeout fires once events stop — the latter is load-bearing. A discrete resize (e.g. collapsing
// the sidebar) animates the pane over a moment; an rAF-only pass would resize to the INTERMEDIATE
// width and then never correct (no further resize event arrives after the layout settles), leaving
// the chart at the wrong size. The trailing pass re-fits to the SETTLED width.

type EchartsInstance = { resize?: () => void }
type EchartsGlobal = {
  getInstanceByDom?: (el: Element) => EchartsInstance | null | undefined
}

const TRAILING_MS = 200

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
      const inst = ec.getInstanceByDom(el)
      try {
        inst?.resize?.()
      } catch {
        /* a single chart must never throw into the resize handler */
      }
    }
  }
  let raf = 0
  let trailing = 0
  const onResize = () => {
    if (!raf) {
      raf = win.requestAnimationFrame(() => {
        raf = 0
        fit()
      })
    }
    win.clearTimeout(trailing)
    trailing = win.setTimeout(fit, TRAILING_MS)
  }
  win.addEventListener('resize', onResize)
}
