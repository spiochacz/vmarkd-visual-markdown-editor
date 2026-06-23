// ECharts charts + mindmaps are sized to the container width ONCE at init and echarts installs no
// resize handler, so they don't track later width changes — the editor's reading column settling
// AFTER init (instant-paint→live swap / iframe layout / scrollbar), or a window/pane resize. Two
// symptoms: "czasami pierwszy render za szeroki" (the column settled narrower than the init width)
// and charts not shrinking with the window.
//
// CRITICAL — we do NOT use `instance.resize()`. The chart Vditor renders has an ORPHANED instance:
// `getInstanceByDom(el)` returns null (Vditor re-creates the preview element after init, leaving a
// dead `_echarts_instance_` attr), so `resize()` is a silent no-op — which is why the previous
// window-resize + deferred-timer (`[150,450,1000,2000]`) approach never actually resized anything.
// Instead we RECONSTRUCT from the source JSON at the current container width (reconstructCharts /
// reconstructMindmaps in echarts-retheme.ts) — proven in the real editor to fix a stuck canvas.
//
// Trigger = a ResizeObserver on each chart/mindmap container (the only thing that fires exactly when
// the reading column settles — a width change is a LAYOUT change, not a DOM mutation, so the old
// timers guessed and a MutationObserver can't see it). rAF-coalesced. The reconstruct* are dedupe-
// guarded (skip when the canvas already fits its container, skip hidden 0-width), so a mode switch
// (width unchanged / pane hidden) does NOT reconstruct → no "tekst w tle" flicker (the trap that
// killed the earlier ResizeObserver-that-called-resize()). A window 'resize' listener (trailing
// debounce) is kept as a belt-and-suspenders path (also dedupe-guarded, so it's a no-op when nothing
// changed). mindmap INITIAL render is still handled by observeMindmaps (a MutationObserver — it fires
// on the DOM mutation when Vditor first draws the canvas).

import { reconstructCharts, reconstructMindmaps } from './echarts-retheme'

type EchartsGlobal = { getInstanceByDom?: (el: Element) => unknown }

const TRAILING_MS = 120

let installed = false

export function installEchartsResize(
  win: Window & {
    echarts?: EchartsGlobal
    __vmarkdEchartsResolve?: (ec: unknown) => string | undefined
    // ResizeObserver/MutationObserver are global constructors (lib.dom `declare var`) but not members of
    // the `Window` interface, so accessing them as win.* needs declaring. ResizeObserver is optional —
    // guarded at runtime for older webviews; MutationObserver is always present.
    ResizeObserver?: typeof ResizeObserver
    MutationObserver: typeof MutationObserver
  },
): void {
  if (installed) return
  installed = true

  // Re-fit every chart + mindmap to its container by reconstructing from source. Both reconstruct*
  // skip elements whose canvas already fits (dedupe) and hidden 0-width containers, so calling this
  // redundantly (window resize AND ResizeObserver) is cheap.
  const fit = () => {
    const ec = win.echarts
    if (!ec) return
    reconstructCharts(win, win.document)
    reconstructMindmaps(win, win.document, win.__vmarkdEchartsResolve?.(ec))
  }

  // Window resize — trailing debounce (settled width, not an intermediate one mid-drag). setTimeout
  // not rAF (rAF is paused when the webview is backgrounded; a timer still fires).
  let trailing = 0
  win.addEventListener('resize', () => {
    win.clearTimeout(trailing)
    trailing = win.setTimeout(fit, TRAILING_MS)
  })

  // ResizeObserver on the diagram containers → catches the first-render column settle (and pane
  // resizes) exactly when the width changes. rAF-coalesced so a burst of container resizes fits once.
  if (typeof win.ResizeObserver !== 'function') return
  let raf = 0
  const onResize = () => {
    if (!raf)
      raf = win.requestAnimationFrame(() => {
        raf = 0
        fit()
      })
  }
  const ro = new win.ResizeObserver(onResize)
  const SEL =
    '.vditor-ir__preview .language-echarts, .vditor-wysiwyg__preview .language-echarts, .vditor-ir__preview .language-mindmap, .vditor-wysiwyg__preview .language-mindmap'
  // (Re)observe diagram containers as Vditor (re)builds them. ResizeObserver.observe is idempotent
  // for an already-observed element, so re-scanning on every mutation is safe.
  const reobserve = () => {
    for (const el of Array.from(
      win.document.querySelectorAll<HTMLElement>(SEL),
    ))
      ro.observe(el)
  }
  const app = win.document.getElementById('app') || win.document.body
  new win.MutationObserver(reobserve).observe(app, {
    childList: true,
    subtree: true,
  })
  reobserve()
}
