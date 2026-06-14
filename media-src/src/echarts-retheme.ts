// Re-render already-drawn ECharts charts in the current theme — task 90 (mirrors task 59 for
// mermaid). Vditor renders each chart once (`data-processed="true"`) and never re-runs it, so a
// live content-/VS Code-theme flip leaves charts in the stale palette until reopen. The theme is
// fixed at `echarts.init(el, theme)` time, so re-theming means dispose + re-init.
//
// We re-init SYNCHRONOUSLY here rather than delegating to Vditor's `chartRender` (which loads the
// script via an async `addScript().then`): on rapid theme switches the deferred callbacks raced
// and the `data-processed` guard let a stale-theme render win, and a chart could end up blank.
// echarts is already loaded (the charts exist), so we can init directly. We also capture the
// container's size BEFORE dispose and pass it back to `init` — disposing clears the inline size
// echarts had set, and if a CSS theme swap is mid-reflow the bare container can measure 0×0,
// which makes echarts render an empty chart (the "stops working after a few switches" report).
// The chart's JSON source is read from the sibling editable `<code class="language-echarts">`
// (the marker pre), like reRenderMermaid; parsed with Vditor's own looseJsonParse for parity.
import { looseJsonParse } from 'vditor/src/ts/util/function'

export function reRenderEcharts(
  win: any,
  editorEl: HTMLElement | undefined,
  mode: 'dark' | 'light',
): void {
  const ec = win.echarts
  if (!editorEl || !ec || typeof ec.init !== 'function') return
  const name = win.__vmarkdEchartsResolve
    ? win.__vmarkdEchartsResolve(ec)
    : mode === 'dark'
      ? 'dark'
      : undefined

  const panes = Array.from(
    editorEl.querySelectorAll<HTMLElement>(
      '.vditor-ir__preview, .vditor-wysiwyg__preview',
    ),
  )
  for (const pane of panes) {
    const live = pane.querySelector<HTMLElement>('.language-echarts')
    if (!live) continue
    // Source = the other `.language-echarts` in this block (the editable <code> outside the
    // preview pane); the rendered canvas clobbered the preview node's own text.
    const block =
      pane.closest<HTMLElement>(
        '.vditor-ir__node, .vditor-wysiwyg__block, [data-type="code-block"]',
      ) || pane.parentElement
    const source = block
      ? Array.from(
          block.querySelectorAll<HTMLElement>('.language-echarts'),
        ).find((m) => !pane.contains(m))?.textContent
      : undefined
    if (source == null || !source.trim()) continue

    // Capture the rendered size before dispose clears echarts' inline width/height.
    const w = live.clientWidth
    const h = live.clientHeight
    try {
      ec.getInstanceByDom?.(live)?.dispose()
      // looseJsonParse is fire-and-forget (it may resolve async for ${} expressions); for plain
      // JSON it returns synchronously. Guard parse + render so one bad chart can't break the rest.
      Promise.resolve(looseJsonParse(source)).then(
        (option: unknown) => {
          if (!option) return
          const inst = ec.init(
            live,
            name,
            w > 0 && h > 0 ? { width: w, height: h } : undefined,
          )
          inst.setOption(option)
          live.setAttribute('data-processed', 'true')
        },
        () => {
          /* leave the (now disposed) chart; a bad source is the user's to fix */
        },
      )
    } catch {
      /* defensive: never let a re-theme throw into the theme-change handler */
    }
  }

  // mindmap (also an ECharts instance — a `tree`) has the SAME stale-on-flip problem. Unlike
  // charts there's no plain-JSON source to re-`setOption` (Vditor builds the tree config in
  // mindmapRender), so re-theme by preserving the LIVE instance's option: read getOption(),
  // dispose, re-init with the new theme name, re-apply. Since mindmapRender no longer hardcodes
  // colours (fixMindmapTheme), the option carries no explicit palette → the new theme drives the
  // colours; data + geometry are preserved. getInstanceByDom returns null for the editable source
  // `<code class="language-mindmap">`, so only the rendered div is re-themed.
  const mmNodes = Array.from(
    editorEl.querySelectorAll<HTMLElement>('.language-mindmap'),
  )
  // ECharts' `tree` ignores the registered theme's palette, so the node/label/line colours are
  // set explicitly from the resolved theme (window.__vmarkdMindmapStyle, mirrors the mindmapRender
  // patch). The preserved option carries the OLD colours, so re-apply the CURRENT style on top.
  const mmStyle = win.__vmarkdMindmapStyle as
    | {
        node: string
        label: string
        labelBg: string
        labelBorder: string
        line: string
      }
    | undefined
  for (const live of mmNodes) {
    const inst = ec.getInstanceByDom?.(live)
    if (!inst) continue
    let opt: any
    try {
      opt = inst.getOption()
    } catch {
      continue
    }
    if (mmStyle && Array.isArray(opt?.series)) {
      for (const s of opt.series) {
        if (!s || s.type !== 'tree') continue
        s.itemStyle = { ...(s.itemStyle || {}), color: mmStyle.node }
        s.label = {
          ...(s.label || {}),
          color: mmStyle.label,
          backgroundColor: mmStyle.labelBg,
          borderColor: mmStyle.labelBorder,
        }
        s.lineStyle = { ...(s.lineStyle || {}), color: mmStyle.line }
      }
    }
    const w = live.clientWidth
    const h = live.clientHeight
    try {
      inst.dispose()
      const ni = ec.init(
        live,
        name,
        w > 0 && h > 0 ? { width: w, height: h } : undefined,
      )
      ni.setOption(opt)
    } catch {
      /* defensive: a single mindmap must not break the theme-change handler */
    }
  }
}
