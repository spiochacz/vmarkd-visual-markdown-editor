// Task 532 follow-up — the IR code block's EDITABLE SOURCE panel vs the Preview code block. The parity
// gate parks the caret (it only sees the collapsed render), so the expanded source half — the surface
// code-source.ts tags `.hljs` so edit == render — has its own net, shared by the chromium harness
// (media-src/e2e/code-source-parity.spec.ts) and real VS Code (test/vscode-e2e/code-source-parity.spec.ts).

const CODE_SOURCE_PROPS = [
  'background-color',
  'font-family',
  'font-size',
  'padding-top',
  'padding-left',
] as const

export interface CodeSourceMeasure {
  /** The expanded source `<code>`'s computed style. */
  src: Record<string, string>
  srcHljs: boolean
  srcHeight: number
}

/** Expands the fence's IR node (like the callout/diagram specs do), reads the source, then shows the Preview. */
export const EXPAND_AND_MEASURE = `(() => {
  const props = ${JSON.stringify(CODE_SOURCE_PROPS)}
  const block = Array.from(document.querySelectorAll('#app .vditor-ir div[data-type="code-block"]')).find((b) => b.textContent.includes('PXfence'))
  block.classList.add('vditor-ir__node--expand')
  const src = block.querySelector('pre.vditor-ir__marker--pre > code')
  const s = getComputedStyle(src)
  const out = { srcHeight: src.getBoundingClientRect().height, srcHljs: src.classList.contains('hljs'), src: Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)])) }
  const inst = window.vditor, v = inst.vditor
  v.preview.element.style.display = 'block'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
  v.preview.render(v)
  return out
})()`

export const PREVIEW_CODE_SELECTOR =
  '#app .vditor-preview pre > code.language-ts'

/** The Preview code block's computed style, or null until it has rendered. */
export const MEASURE_PREVIEW = `(() => {
  const code = Array.from(document.querySelectorAll(${JSON.stringify(PREVIEW_CODE_SELECTOR)})).find((c) => c.textContent.includes('PXfence'))
  if (!code) return null
  const s = getComputedStyle(code)
  return Object.fromEntries(${JSON.stringify(CODE_SOURCE_PROPS)}.map((p) => [p, s.getPropertyValue(p)]))
})()`

/** Asserts (plain throw, runner-agnostic) that the expanded source equals the Preview. */
export function assertSourceMatchesPreview(
  source: CodeSourceMeasure,
  preview: Record<string, string> | null,
): void {
  if (!source.srcHljs) throw new Error('the source <code> lost its .hljs tag')
  if (!(source.srcHeight > 0)) throw new Error('the source panel is not shown')
  if (!preview) throw new Error('the Preview code block did not render')
  for (const p of CODE_SOURCE_PROPS)
    if (source.src[p] !== preview[p])
      throw new Error(
        `source vs Preview ${p}: ${JSON.stringify(source.src[p])} vs ${JSON.stringify(preview[p])}`,
      )
  if (!/mono|Consolas|Courier/i.test(source.src['font-family']))
    throw new Error(
      `source font is not monospace: ${source.src['font-family']}`,
    )
}
