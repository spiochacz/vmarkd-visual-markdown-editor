// Re-render already-drawn flowchart.js diagrams in the current content theme — task 91 (mirrors
// reRenderMermaid/reRenderEcharts). flowchart.js bakes explicit colours into the SVG at draw time
// (no `currentColor` — Raphael can't parse it), so a live content-/VS Code-theme flip leaves a
// flowchart in the OLD palette until reopen. The fence source still holds the flowchart text, so we
// re-parse it and redraw with the new themed foreground (the same options the esbuild patch on
// flowchartRender passes on first render: line/element/font = foreground, fill = none).
//
// Scoped to the IR/WYSIWYG preview panes (which carry an editable source sibling we can recover the
// flowchart text from); the standalone `.vditor-preview` pane has no source sibling and re-renders
// via previewRender on its own.

type FlowchartGlobal = {
  parse?: (text: string) => {
    drawSVG: (el: HTMLElement, opts?: object) => void
  }
}

export function reRenderFlowchart(
  win: Window & { flowchart?: FlowchartGlobal },
  editorEl: HTMLElement | undefined,
): void {
  const fc = win.flowchart
  if (!editorEl || !fc || typeof fc.parse !== 'function') return
  const panes = Array.from(
    editorEl.querySelectorAll<HTMLElement>(
      '.vditor-ir__preview, .vditor-wysiwyg__preview',
    ),
  )
  for (const pane of panes) {
    const live = pane.querySelector<HTMLElement>('.language-flowchart')
    if (!live) continue
    // Source = the other `.language-flowchart` in this block (the editable <code> outside the
    // preview pane) — the rendered SVG clobbered the preview node's own text.
    const block =
      pane.closest<HTMLElement>(
        '.vditor-ir__node, .vditor-wysiwyg__block, [data-type="code-block"]',
      ) || pane.parentElement
    const source = block
      ? Array.from(
          block.querySelectorAll<HTMLElement>('.language-flowchart'),
        ).find((m) => !pane.contains(m))?.textContent
      : undefined
    if (source == null || !source.trim()) continue
    // Themed foreground (rgb() — flowchart.js's Raphael parses it). fill:none = transparent boxes.
    const color = win.getComputedStyle(live).color || '#000'
    try {
      const obj = fc.parse(source)
      live.innerHTML = ''
      obj.drawSVG(live, {
        'line-color': color,
        'element-color': color,
        'font-color': color,
        fill: 'none',
      })
      live.setAttribute('data-processed', 'true')
    } catch {
      /* a malformed flowchart is the user's to fix; never throw into the theme handler */
    }
  }
}
