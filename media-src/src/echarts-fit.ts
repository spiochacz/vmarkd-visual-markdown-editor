// ECharts charts + mindmaps are init'd ONCE at the container width at render time and never resize
// themselves. Two symptoms:
//   1. In the full Preview overlay the chart renders ~15px short: the vertical scrollbar settles
//      AFTER echarts measured the container (canvas 689 inside a 704 column) → an asymmetric right
//      gap, and the chart looked narrower than the same chart in the edit pane.
//   2. Charts keep a stale width when the window/pane is later resized (echarts.init installs no
//      resize handler), so they don't track a window resize at all.
// Fix: observe every rendered echarts container with a ResizeObserver and resize the instance to
// fill it. The observer's INITIAL callback (fired once per observed element) closes the scrollbar
// gap; later callbacks make the charts responsive.
//
// Observe the CONTAINER element (`.language-echarts` / `.language-mindmap`), NEVER the canvas:
// `resize()` changes the canvas, not the container, so there is no feedback loop. A MutationObserver
// picks up containers as Vditor (re-)renders them (the Preview pane rebuilds its innerHTML on every
// show); re-observing an already-observed element is a no-op.

type EchartsInstance = { resize?: () => void }
type EchartsGlobal = {
  getInstanceByDom?: (el: Element) => EchartsInstance | null | undefined
}

export function observeEchartsFit(
  win: { echarts?: EchartsGlobal; ResizeObserver?: typeof ResizeObserver },
  root: HTMLElement | null | undefined,
): () => void {
  if (!root || typeof win.ResizeObserver !== 'function') return () => {}
  const ro = new win.ResizeObserver((entries) => {
    const ec = win.echarts
    if (!ec?.getInstanceByDom) return
    for (const entry of entries) {
      const inst = ec.getInstanceByDom(entry.target)
      try {
        inst?.resize?.()
      } catch {
        /* a single chart must never throw into the observer */
      }
    }
  })
  const observeAll = () => {
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>(
        '.language-echarts, .language-mindmap',
      ),
    )) {
      ro.observe(el)
    }
  }
  observeAll()
  const mo = new MutationObserver(observeAll)
  mo.observe(root, { childList: true, subtree: true })
  return () => {
    mo.disconnect()
    ro.disconnect()
  }
}
