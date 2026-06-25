// Browser entry for the D2 render harness: compile a .d2 source then render it through any of the
// three engines (dagre / raw ELK / vmarkd). Lives outside src/ so it's not part of the app's
// typecheck/lint/test surface — a manual visual-verification tool driven by a headless browser
// (see render.mjs). Mirrors the engine routing in custom-diagrams.ts.
import {
  canvasMeasure,
  d2Theme,
  renderD2Graph,
  unsupportedReason,
} from '../../src/d2-render'
import { compileD2 } from '../../src/d2-wasm'
import { bootElk, renderD2GraphElk } from '../../src/elk-layout'

const cdn = `${location.origin}/vditor`
;(window as any).__render = async (src: string, engine: string) => {
  await bootElk(cdn)
  const g: any = await compileD2(cdn, src)
  if (g.error) return { error: g.error }
  const style = d2Theme() // mono / currentColor (matches the editor's default D2 theming)
  const un = unsupportedReason(g)
  if (engine === 'dagre') {
    if (un) return { error: `unsupported: ${un}` }
    return { svg: renderD2Graph(g, canvasMeasure, style) }
  }
  // 'elk' = raw ELK (no refinement); 'vmarkd' = ELK + the refinement pipeline (the shipped default).
  const svg = await renderD2GraphElk(
    g,
    canvasMeasure,
    cdn,
    style,
    engine === 'vmarkd',
  )
  return { svg, unsupported: un }
}
;(window as any).__ready = true
