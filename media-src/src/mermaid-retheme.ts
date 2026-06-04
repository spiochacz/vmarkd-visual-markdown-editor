// Re-render already-drawn mermaid diagrams in the current theme (task 59).
//
// Code highlighting follows the VS Code theme live (setTheme), but mermaid does not:
// Vditor renders each diagram to an <svg> once (marked `data-processed="true"`) and never
// re-runs it, so flipping dark↔light leaves diagrams in the stale theme until reopen.
//
// We re-render OFFSCREEN and swap the SVG in atomically: rendering in place would mean
// setting the preview's textContent back to the (short) source for mermaid to read, which
// momentarily collapses the diagram's height — and if the diagram sits above the viewport
// that shrinks the document and scrolls the view toward the top (the user-reported jump,
// mermaid-only). Instead we build a hidden sandbox holding the source, run Vditor's
// `mermaidRender` there, then copy each finished SVG back into its live preview node — the
// live DOM never collapses, so there's no scroll jump and no flash. The editable source is
// read from the sibling `<code class="language-mermaid">`. Async + best-effort; no diagrams
// → no-op.
import { mermaidRender } from 'vditor/src/ts/markdown/mermaidRender'

export function reRenderMermaid(
  editorEl: HTMLElement | undefined,
  cdn: string,
  theme: 'dark' | 'light',
): void {
  if (!editorEl) return
  const panes = Array.from(
    editorEl.querySelectorAll<HTMLElement>(
      '.vditor-ir__preview, .vditor-wysiwyg__preview',
    ),
  )
  const jobs: { live: HTMLElement; source: string }[] = []
  for (const pane of panes) {
    const live = pane.querySelector<HTMLElement>('.language-mermaid')
    if (!live) continue
    // The source is the other `.language-mermaid` in the same block — the editable
    // `<code>` that lives outside this preview pane.
    const block =
      pane.closest<HTMLElement>(
        '.vditor-ir__node, .vditor-wysiwyg__block, [data-type="code-block"]',
      ) || pane.parentElement
    const source = block
      ? Array.from(
          block.querySelectorAll<HTMLElement>('.language-mermaid'),
        ).find((m) => !pane.contains(m))?.textContent
      : undefined
    if (source == null) continue
    jobs.push({ live, source })
  }
  if (jobs.length === 0) return

  // Hidden sandbox, off-flow so it can't affect layout/scroll while rendering.
  const sandbox = document.createElement('div')
  sandbox.setAttribute('aria-hidden', 'true')
  sandbox.style.cssText =
    'position:absolute;left:-99999px;top:0;width:800px;visibility:hidden;pointer-events:none'
  const temps = jobs.map((j) => {
    const t = document.createElement('div')
    t.className = 'language-mermaid'
    t.textContent = j.source
    sandbox.appendChild(t)
    return t
  })
  document.body.appendChild(sandbox)
  // Theme: 'dark' → mermaid dark; anything else → mermaid default. An explicit
  // `mermaidTheme` setting still wins via the mermaid.initialize wrapper in
  // applyMermaidTheme.
  mermaidRender(sandbox, cdn, theme)

  // mermaidRender is fire-and-forget async; poll until every temp finished, then swap each
  // finished SVG into its live node and drop the sandbox. Bounded so a stuck render can't
  // leak the sandbox.
  let tries = 0
  const swap = () => {
    const done = temps.every((t) => t.getAttribute('data-processed') === 'true')
    if (done || tries++ > 180) {
      jobs.forEach((j, i) => {
        if (temps[i].querySelector('svg')) j.live.innerHTML = temps[i].innerHTML
      })
      sandbox.remove()
      return
    }
    requestAnimationFrame(swap)
  }
  requestAnimationFrame(swap)
}
