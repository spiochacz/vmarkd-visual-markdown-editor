// Faithful-by-construction render guard (task 151 item 7), lifting D2's "never show
// a wrong/blank picture" discipline into a shared helper. The wavedrom/vega paths
// used to clear the wrapper's source BEFORE the (possibly throwing) render, so a
// render-time failure left an empty block instead of the raw source. Here the
// engine renders into an offscreen-but-ATTACHED stage (wavedrom resolves its target
// via document.getElementById; vega-embed measures layout) and we swap the result
// into `wrapper` ONLY on success. On any failure the wrapper gets an inspectable
// `data-<lang>-error`, the cause is logged, and EITHER (default) keeps its source
// (loud) OR, when `onError` is given, renders a themed validation box (task 178).
import { logToHost } from './webview-log'

export async function faithfulRender(
  wrapper: HTMLElement,
  lang: string,
  produce: (stage: HTMLElement) => void | Promise<void>,
  // Task 178: when provided, a render failure shows a themed error box instead of leaving the raw
  // source. The box IS the terminal result, so we then mark `data-processed` — otherwise the custom-
  // diagram observer re-finds the (now box-bearing) wrapper and re-renders it into a loop (findBlocks
  // skips `[data-processed="true"]`). On a source edit the preview is rebuilt fresh (no data-processed)
  // and the reRender* helpers clear it on theme flips, so a fixed diagram still re-renders.
  onError?: (wrapper: HTMLElement, error: unknown) => void,
): Promise<boolean> {
  const stage = document.createElement('div')
  // Offscreen but in the document so id-based / layout-dependent engines work.
  stage.style.cssText = 'position:absolute;left:-99999px;top:0'
  document.body.appendChild(stage)
  try {
    await produce(stage)
    wrapper.innerHTML = ''
    while (stage.firstChild) wrapper.appendChild(stage.firstChild)
    wrapper.setAttribute('data-processed', 'true')
    wrapper.removeAttribute(`data-${lang}-error`)
    return true
  } catch (error) {
    wrapper.setAttribute(`data-${lang}-error`, 'render')
    logToHost(
      `[${lang}] render failed${onError ? '' : '; showing source'} — ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    if (onError) {
      onError(wrapper, error)
      wrapper.setAttribute('data-processed', 'true')
    }
    return false
  } finally {
    stage.remove()
  }
}
