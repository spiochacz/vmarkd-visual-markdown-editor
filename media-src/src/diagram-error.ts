// Unified validation/render-error box for diagram engines (task 178), generalizing the mermaid
// parse-error box (patchMermaidErrorRender) to every engine that can report an error. On a
// parse/validation/render failure an engine shows this ONE compact themed box — engine name + the
// engine's message in a newline-preserving `<pre>` — instead of a raw "X render error:" dump, a blank
// block, or the bare source. Replaces the old per-engine inconsistency (unformatted red text / silent
// nothing / raw source) with a single readable, themed signal.
//
// Lute-safety: the box carries `data-render="1"` and always lives inside an engine's preview half
// (`.vditor-ir__preview` / `.vditor-wysiwyg__preview`, already `data-render="2"`), so it is invisible
// to BOTH AST walkers — never serialized, round-trip byte-identical (see the vmarkd-lute-features
// skill). Theme-var driven (`.vmarkd-diagram-error` in main.css), no palette interaction.
//
// The NATIVE Vditor renderers (echarts/mindmap/flowchart/mermaid) cannot import this module — they are
// rewritten at bundle time by esbuild source patches that inline BYTE-IDENTICAL markup (same class,
// same escape, same `<pre>`). Our own TS modules (graphviz/plantuml/nomnoml/wavedrom/vega/smiles/stl)
// import `renderDiagramError` directly. Keep the two in sync: a markup change here must mirror in
// esbuild-shared.mjs (and its `vditor-source-patches.test.ts`).

// Engine slug → display title. Keeps the box label consistent and human regardless of the
// `language-X` class slug (e.g. `vega-lite` → "Vega-Lite", `nomnoml` stays lowercase by convention).
const ENGINE_TITLES: Record<string, string> = {
  mermaid: 'Mermaid',
  graphviz: 'Graphviz',
  echarts: 'ECharts',
  mindmap: 'Mindmap',
  flowchart: 'Flowchart',
  plantuml: 'PlantUML',
  d2: 'D2',
  vega: 'Vega',
  'vega-lite': 'Vega-Lite',
  wavedrom: 'WaveDrom',
  nomnoml: 'nomnoml',
  smiles: 'SMILES',
  geojson: 'GeoJSON',
  topojson: 'TopoJSON',
  stl: 'STL',
  math: 'Math',
  abc: 'abc',
  markmap: 'Markmap',
}

// Escape &/</> so an engine error that echoes the user's source (most parsers quote the offending
// token) cannot inject HTML into the box. `&` first so it doesn't double-escape the entities below.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Human title for an engine slug (falls back to the slug itself for an unknown engine). */
export function diagramErrorTitle(engine: string): string {
  return ENGINE_TITLES[engine] ?? engine
}

/** The `.vmarkd-diagram-error` box markup for an engine + message (escaped, `<pre>` body). Exported
 *  for the unit test; the native esbuild patches inline an identical string. */
export function diagramErrorHtml(engine: string, message: unknown): string {
  const msg = escapeHtml(
    message instanceof Error ? message.message : String(message),
  )
  return (
    '<div class="vmarkd-diagram-error" data-render="1">' +
    `<div class="vmarkd-diagram-error__title">${escapeHtml(diagramErrorTitle(engine))}</div>` +
    `<pre class="vmarkd-diagram-error__msg">${msg}</pre></div>`
  )
}

/** Replace `el`'s content with the themed validation-error box. Call from a renderer's catch on a
 *  parse/validation/render failure; `el` must be the engine's preview wrapper. */
export function renderDiagramError(
  el: HTMLElement,
  engine: string,
  message: unknown,
): void {
  el.innerHTML = diagramErrorHtml(engine, message)
}
