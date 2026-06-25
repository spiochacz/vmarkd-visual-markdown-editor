// Browser entry for the d2-quality fixture generator. Dumps the RAW ELK layout (BEFORE refineLayout) as
// plain JSON — that's the frozen input the CI quality test (media-src/src/d2-quality.test.ts) replays
// refineLayout/toSVG over. Run via gen.mjs; see that file for usage. Lives outside src/ so it's not part of
// the app's typecheck/lint/test surface (it's a manual maintenance tool that drives a headless browser).
import { canvasMeasure } from '../../src/d2-render'
import { compileD2 } from '../../src/d2-wasm'
import { bootElk, layoutElk } from '../../src/elk-layout'

const cdn = `${location.origin}/vditor`
;(window as any).__dumpLayout = async (src: string) => {
  const elk = await bootElk(cdn)
  const g: any = await compileD2(cdn, src)
  if (g.error) return { error: g.error }
  const layout = await layoutElk(g, canvasMeasure, elk)
  return JSON.parse(JSON.stringify(layout)) // strip prototype/function residue; assert JSON-safe
}
;(window as any).__ready = true
