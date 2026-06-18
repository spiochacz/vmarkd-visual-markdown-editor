// Code-block edit surface (task: edit == render, theme-driven).
//
// In Vditor's IR, a code block's editable SOURCE is `pre.vditor-ir__marker--pre > code.language-X`,
// while the RENDER is `pre.vditor-ir__preview > code.hljs` — the highlight.js theme styles `.hljs`
// (background, padding, base colour, size). Because the source lacks `.hljs`, the content/inline-code
// rules leak onto it instead, so the code text was a different size/padding/colour than the render
// and shifted when you entered edit.
//
// Fix: tag the source `<code>` with `hljs` too, so the SAME hljs-theme rules style it — making the
// editing surface identical to the render (only the syntax token colours are absent; the base text
// colour comes from the theme, which is what we want). Verified: the class is transparent to Lute's
// serializer, so the markdown round-trips unchanged.
//
// Vditor rebuilds the IR DOM on each edit, so we re-tag via a MutationObserver. The callback is
// synchronous (no rAF) and the observer does NOT watch attributes — so adding the class neither
// causes a flash (re-applied before paint) nor re-triggers the observer (no loop).

// Diagram/custom blocks share `data-type="code-block"` but render to an SVG/diagram, not `.hljs`
// code — leave their source alone (it isn't syntax-highlighted code).
export const CUSTOM_LANGS = new Set([
  'mermaid',
  'echarts',
  'flowchart',
  'graphviz',
  'plantuml',
  'mindmap',
  'markmap',
  'abc',
  'smiles',
  'math',
  // Custom-diagram renderers (custom-diagrams.ts) — their source is diagram markup, NOT
  // syntax-highlighted code, so it must NOT get the `.hljs` code panel; it sits on the page
  // background like the render. Keep in sync with the renderers in custom-diagrams.ts.
  'wavedrom',
  'nomnoml',
  'geojson',
  'topojson',
  'vega',
  'vega-lite',
  'stl',
  'd2',
])

/** Add `hljs` to every editable code-block source `<code>` (skipping diagram languages). */
export function tagCodeSource(root: ParentNode | null | undefined): void {
  if (!root || typeof (root as ParentNode).querySelectorAll !== 'function')
    return
  const codes = (root as ParentNode).querySelectorAll<HTMLElement>(
    '.vditor-ir__marker--pre > code',
  )
  for (const code of Array.from(codes)) {
    if (code.classList.contains('hljs')) continue
    const langClass = Array.from(code.classList).find((c) =>
      c.startsWith('language-'),
    )
    const lang = langClass ? langClass.slice('language-'.length) : ''
    if (lang && CUSTOM_LANGS.has(lang)) continue
    code.classList.add('hljs')
  }
}

/**
 * Keep code-block sources tagged `.hljs` as the IR editor rebuilds its DOM. Synchronous (before
 * paint, so no flash); observes childList/characterData only (NOT attributes), so adding the class
 * doesn't re-trigger the observer. Returns a disposer.
 */
export function observeCodeSource(
  editorEl: HTMLElement | null | undefined,
): () => void {
  if (!editorEl) return () => {}
  const run = () => tagCodeSource(editorEl)
  const obs = new MutationObserver(run)
  obs.observe(editorEl, { childList: true, subtree: true, characterData: true })
  run()
  return () => obs.disconnect()
}
