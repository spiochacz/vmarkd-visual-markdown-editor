// Re-render already-drawn mermaid diagrams in the current theme (task 59).
//
// Code highlighting follows the VS Code theme live (setTheme), but mermaid does not:
// Vditor renders each diagram to an <svg> once (marked `data-processed="true"`) and never
// re-runs it, so flipping dark↔light leaves diagrams in the stale theme until reopen.
//
// The editable source survives in a sibling `<code class="language-mermaid">` (the preview
// pane's `.language-mermaid` had its text replaced by the SVG). So to re-theme we: restore
// each preview's source text, clear `data-processed`, and re-run Vditor's `mermaidRender`
// SCOPED TO THE PREVIEW PANES — never the whole editor, or the editable source `<code>`
// would itself be turned into an SVG. Async + best-effort; a doc with no diagrams no-ops.
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
  let any = false
  for (const pane of panes) {
    const rendered = pane.querySelector<HTMLElement>('.language-mermaid')
    if (!rendered) continue
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
    rendered.removeAttribute('data-processed')
    rendered.textContent = source
    any = true
  }
  if (!any) return
  // Re-run render per preview pane (mermaidRender reads textContent as the diagram source
  // and writes back the new-theme SVG). Theme: 'dark' → mermaid dark; anything else →
  // mermaid default. An explicit `mermaidTheme` setting still wins via the
  // mermaid.initialize wrapper in applyMermaidTheme.
  for (const pane of panes) {
    if (pane.querySelector('.language-mermaid')) {
      mermaidRender(pane, cdn, theme)
    }
  }
}
