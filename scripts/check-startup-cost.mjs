// Startup parse+eval cost gate (task 165). COMPLEMENTS the size gate (check-bundle-size.mjs): two
// bundles of equal SIZE can cost very different amounts to top-level-EVALUATE at webview startup
// (200 small modules ≠ 50 heavy ones), and the 525 KB size ceiling has ~150 KB of slack, so a heavy
// engine cluster can leak back into the eager main.js WITHOUT tripping it. That is exactly the
// regression task 165 removed (the ~109 KB D2 dagre/d2-render/elk-layout pipeline — parsed + eval'd
// on every open, yet only ever runs for `.language-d2`). This gate catches it re-entering.
//
// WHY NOT time the parse directly: V8 LAZY-parses (function bodies are compiled on first call, not at
// load), so a `vm.Script` compile of main.js measures ~0 ms and is not a faithful startup cost. The
// real boot cost is the TOP-LEVEL EVAL of each bundled module, which the module GRAPH captures
// deterministically. So the gate is two metrics off media/dist/main.meta.json:
//   1. EAGER MODULE COUNT — how many modules are top-level-eval'd on boot. A cluster leaking back in
//      (dagre alone is a dozen+ modules) spikes this.
//   2. LARGEST EAGER MODULE — catches a single heavy engine bundled as one big module (e.g. a 40 KB
//      dagre) that wouldn't move the count much but would balloon the eval cost.
// Both are fully deterministic (no CPU-dependent timing → no CI flake). Budgets are CEILINGS with
// headroom over the current values — bump DELIBERATELY with a reason. Run AFTER `node build.mjs`.
import { readFileSync } from 'node:fs'

const META = new URL('../media/dist/main.meta.json', import.meta.url)

// Current after the task-165 D2 split: 200 modules, largest eager module 27.1 KB (Vditor core).
//
// Raised 230→270 on 2026-08-01 (PR #88), the same call and for the same measured reason as the size
// gate's 430→460 next door. The count was 254, of which 150 are our own source and 104 Vditor+deps
// — no cluster, i.e. not the leak this gate exists to catch (dagre alone is a dozen+ modules and
// task 165's D2 pipeline was ~109 KB across many). It is not new work either: 254 measured at
// b9e2818 as well, byte-identical to HEAD's count, because ci.yml only runs on pull_request and on
// main, and this branch had neither since 2026-06-16 — 408 commits of ordinary feature growth with
// the gate never firing. 270 keeps 16 modules of headroom: ordinary work does not trip it, an
// engine cluster re-entering still does. MAX_LARGEST_MODULE_KB is untouched — it never moved.
// Raised 270→285 on 2026-10-07 together with the size budget (check-bundle-size.mjs): 272 eager
// modules, no engine among them (largest eager module 29.4 KB, Vditor's fixBrowserBehavior) —
// new feature glue (tasks 522/525/528/530). 285 keeps ~13 modules of headroom.
const MAX_EAGER_MODULES = 285
const MAX_LARGEST_MODULE_KB = 34

let meta
try {
  meta = JSON.parse(readFileSync(META))
} catch {
  console.error(
    'check-startup-cost: media/dist/main.meta.json missing — run `node build.mjs` first',
  )
  process.exit(1)
}
const outKey = Object.keys(meta.outputs).find((k) => k.endsWith('main.js'))
const inputs = meta.outputs[outKey].inputs
const moduleCount = Object.keys(inputs).length
const [largestPath, largestBytes] = Object.entries(inputs)
  .map(([p, v]) => [p, v.bytesInOutput])
  .sort((a, b) => b[1] - a[1])[0]
const largestKB = Math.round((largestBytes / 1024) * 10) / 10

console.log('Startup parse+eval cost (task 165):')
const countOk = moduleCount <= MAX_EAGER_MODULES
console.log(
  `  ${countOk ? '✓' : '✖'} eager modules   ${moduleCount} / ${MAX_EAGER_MODULES}  — top-level-eval'd on every webview boot`,
)
const largestOk = largestKB <= MAX_LARGEST_MODULE_KB
console.log(
  `  ${largestOk ? '✓' : '✖'} largest module  ${largestKB} KB / ${MAX_LARGEST_MODULE_KB} KB  — ${largestPath.replace(/.*node_modules\//, 'node_modules/').replace('media-src/', '')}`,
)

if (!countOk || !largestOk) {
  console.error(
    '\nStartup-cost budget EXCEEDED. A heavy engine likely leaked into the eager main.js (engines\n' +
      'must lazy-load — addScript/fetch, like d2-main.js / elk-main.js — not be statically imported).\n' +
      'Inspect the eager module graph:\n' +
      '  node -e "const m=require(\'./media/dist/main.meta.json\');const k=Object.keys(m.outputs).find(x=>x.endsWith(\'main.js\'));console.log(Object.entries(m.outputs[k].inputs).map(([p,v])=>[Math.round(v.bytesInOutput/1024)+\'KB\',p]).sort().reverse().slice(0,20))"\n' +
      'Then fix the leak — or bump the budget deliberately with a reason.',
  )
  process.exit(1)
}
console.log('Startup cost within budget.')
