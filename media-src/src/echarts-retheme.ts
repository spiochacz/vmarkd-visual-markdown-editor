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

  // mindmap (also an ECharts instance — a `tree`) has the SAME stale-on-flip problem, but it
  // CANNOT be re-themed by preserving the live instance's option:
  //   1. In the IR/WYSIWYG preview pane the rendered `.language-mindmap` node carries a canvas but
  //      NO retrievable echarts instance (getInstanceByDom returns null — the painted node is a
  //      detached snapshot, not the live-bound element), so a "find the instance" path silently
  //      skips it and the mindmap never re-themes (the reported "background doesn't follow the
  //      theme" bug). The chart path works precisely because it RECONSTRUCTS from source.
  //   2. getOption().backgroundColor carries the OLD theme's background, so re-`setOption`ing it
  //      would re-pin the stale background even when an instance exists.
  // So reconstruct the mindmap exactly like the chart: read the tree JSON from `data-code` (what
  // Vditor's mindmapRender itself parses — `decodeURIComponent` → JSON), dispose + clear any
  // orphaned canvas, re-init with the new theme NAME (which drives the backgroundColor), and apply
  // the explicit tree colours from the resolved theme. This mirrors mindmapRender's option (geometry
  // kept verbatim); ECharts' `tree` ignores the registered theme's categorical palette, so node/
  // label/line colours come from window.__vmarkdMindmapStyle (installed by echarts-apply.ts), with
  // the same GitHub-light fallback as the mindmapRender patch.
  const mmStyle = (win.__vmarkdMindmapStyle as
    | {
        node: string
        label: string
        labelBg: string
        labelBorder: string
        line: string
      }
    | undefined) ?? {
    node: '#4285f4',
    label: '#586069',
    labelBg: '#f6f8fa',
    labelBorder: '#d1d5da',
    line: '#d1d5da',
  }
  // Scope to RENDERED mindmaps only — those inside a preview pane. The editable source
  // `<code class="language-mindmap">` (in `.vditor-ir__marker--pre` / `.vditor-wysiwyg__pre`)
  // also carries a `data-code`, so a bare `.language-mindmap` sweep would render a chart INTO the
  // editing surface (Vditor's own mindmapRender guards the same parents). Preview-scoping excludes it.
  const mmNodes = Array.from(
    editorEl.querySelectorAll<HTMLElement>(
      '.vditor-ir__preview .language-mindmap, .vditor-wysiwyg__preview .language-mindmap, .vditor-preview .language-mindmap',
    ),
  )
  for (const live of mmNodes) {
    const code = live.getAttribute('data-code')
    if (!code) continue
    let data: unknown
    try {
      data = JSON.parse(decodeURIComponent(code))
    } catch {
      continue
    }
    const w = live.clientWidth
    const h = live.clientHeight
    try {
      ec.getInstanceByDom?.(live)?.dispose()
      live.innerHTML = '' // drop any orphaned snapshot canvas before re-init
      const ni = ec.init(
        live,
        name,
        w > 0 && h > 0 ? { width: w, height: h } : undefined,
      )
      ni.setOption({
        series: [
          {
            type: 'tree',
            data: [data],
            initialTreeDepth: -1,
            roam: true,
            symbol: (_v: number, params: { data?: { children?: unknown } }) =>
              params?.data?.children ? 'circle' : 'path://',
            itemStyle: { borderWidth: 0, color: mmStyle.node },
            label: {
              backgroundColor: mmStyle.labelBg,
              borderColor: mmStyle.labelBorder,
              borderRadius: 5,
              borderWidth: 0.5,
              color: mmStyle.label,
              lineHeight: 20,
              offset: [-5, 0],
              padding: [0, 5],
              position: 'insideRight',
            },
            lineStyle: { color: mmStyle.line, width: 1 },
          },
        ],
        tooltip: { trigger: 'item', triggerOn: 'mousemove' },
      })
      live.setAttribute('data-processed', 'true')
    } catch {
      /* defensive: a single mindmap must not break the theme-change handler */
    }
  }
}
