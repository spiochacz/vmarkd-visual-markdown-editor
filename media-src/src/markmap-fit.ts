// markmap renders an interactive SVG and fits the tree to the container ONCE at create time; it does
// NOT re-fit when the container later changes size. markmap sets the svg to `width:100%`, so the svg
// ELEMENT shrinks with a narrowing column — but the content keeps its original pixel layout and just
// CLIPS (doesn't shrink). markmap-view's `autoFit` would handle this via a ResizeObserver, but that
// 0×0-collapses the diagram when a mode pane is hidden (the trap echarts-fit.ts documents), so we
// don't use it.
//
// Instead, mirror echarts-fit: the esbuild patch (patchMarkmapStatic) stashes each markmap instance
// on its svg as `__vmarkdMm`; here we re-fit every VISIBLE instance on a (debounced) window 'resize'.
// `mm.fit()` relayouts the tree to the svg's current size (instant — duration:0 from the patch). A
// tried-and-rejected viewBox approach scaled the content via CSS but captured the bbox at an unstable
// moment in WYSIWYG (mid-render) → it blew the content up; a real re-fit is robust.
//
// window 'resize' ONLY (never a ResizeObserver/MutationObserver): a mode switch doesn't resize the
// window, so this never fires during that DOM churn; trailing setTimeout (not rAF, which is throttled
// when the webview is backgrounded), to the SETTLED width. Same rationale as echarts-fit.ts.

type Markmap = { fit?: () => unknown }
const TRAILING_MS = 120
let installed = false

export function installMarkmapResize(win: Window): void {
  if (installed) return
  installed = true
  const fit = () => {
    for (const svg of Array.from(
      win.document.querySelectorAll<SVGSVGElement & { __vmarkdMm?: Markmap }>(
        '.language-markmap svg',
      ),
    )) {
      // Skip HIDDEN containers (clientWidth 0 — e.g. the IR pane while the full Preview overlay is
      // shown, or the inactive mode). Fitting to a 0×0 svg collapses the tree, and no resize event
      // fires when it's shown again → it would stay collapsed (cf. echarts-fit's hidden-skip).
      if (svg.clientWidth === 0 || svg.clientHeight === 0) continue
      try {
        svg.__vmarkdMm?.fit?.()
      } catch {
        /* one markmap must never throw into the shared resize handler */
      }
    }
  }
  let trailing = 0
  win.addEventListener('resize', () => {
    win.clearTimeout(trailing)
    trailing = win.setTimeout(fit, TRAILING_MS)
  })
}
