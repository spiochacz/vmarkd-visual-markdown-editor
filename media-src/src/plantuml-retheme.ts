// Re-render PlantUML, Graphviz, and abc diagrams on a live theme flip.
//
// All three bake their palette at draw time. The patched render functions save source in
// `data-code`; clearing `data-processed` + calling the render on the PREVIEW PANE (not the
// whole editor — the editor also has editable source .language-* elements) re-draws fresh.

import { plantumlRender } from 'vditor/src/ts/markdown/plantumlRender'
import { graphvizRender } from 'vditor/src/ts/markdown/graphvizRender'
import { abcRender } from 'vditor/src/ts/markdown/abcRender'

function reRenderLang(
  editorEl: HTMLElement,
  langClass: string,
  renderFn: (el: HTMLElement | Document, cdn: string) => void,
  cdn: string,
): void {
  const previews = editorEl.querySelectorAll<HTMLElement>(
    '.vditor-ir__preview, .vditor-wysiwyg__preview',
  )
  for (const pane of Array.from(previews)) {
    const el = pane.querySelector<HTMLElement>(`.${langClass}`)
    if (!el) continue
    el.removeAttribute('data-processed')
    el.innerHTML = ''
    renderFn(pane, cdn)
  }
}

export function reRenderPlantuml(
  editorEl: HTMLElement | null | undefined,
  cdn: string,
): void {
  if (!editorEl) return
  reRenderLang(editorEl, 'language-plantuml', plantumlRender, cdn)
}

export function reRenderGraphviz(
  editorEl: HTMLElement | null | undefined,
  cdn: string,
): void {
  if (!editorEl) return
  reRenderLang(editorEl, 'language-graphviz', graphvizRender, cdn)
}

export function reRenderAbc(
  editorEl: HTMLElement | null | undefined,
  cdn: string,
): void {
  if (!editorEl) return
  reRenderLang(editorEl, 'language-abc', abcRender, cdn)
}
