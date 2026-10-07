// Bundle-size budget gate (task 145 item 3). Fails if the eager webview bundle (or the separate ELK
// bundle) exceeds its budget — catches an engine accidentally BUNDLED into main.js instead of
// lazy-loaded (would balloon it by MBs), plus gradual dependency bloat (main.js + the VSIX doubled
// 5.1→10.3 MB across releases with no gate). Run AFTER `node build.mjs`; wired into CI.
//
// Budgets are a CEILING with headroom over the current size — bump them DELIBERATELY (with a reason)
// when a real addition lands, so an accidental jump fails loudly first.
import { statSync } from 'node:fs'

const BUDGETS = [
  // [ file (relative to repo root), maxKB, what ]
  [
    'media/dist/main.js',
    // Lowered 525→430 when the D2 pipeline was code-split out (task 165: 484→379 KB); keeps the
    // ceiling meaningful so the next eager engine leak fails loudly instead of hiding in old slack.
    //
    // Raised 430→460 on 2026-08-01 (PR #88), deliberately and with the measurement, not to make a
    // red gate go away. The bundle was 445.6 KB; `main.meta.json` says NO engine leaked, which is
    // the failure this gate exists to catch — the top contributors are Vditor's own source
    // (fixBrowserBehavior 27.7 KB, highlightToolbarWYSIWYG 20.2 KB, wysiwyg/index 10.9 KB) plus
    // diff-match-patch 18.7 KB and plantuml-render.ts 12.3 KB, i.e. diffuse growth over the 6.5
    // weeks this branch ran without a PR (CI only runs on PRs and on main, so the gate had not
    // fired since 2026-06-16 — it was already 444.8 KB before the last three commits, which added
    // 0.8 KB between them). 460 leaves ~14 KB of headroom: enough that ordinary feature work does
    // not trip it, far too little to hide a bundled engine, which is what the 18-line jump from a
    // leaked renderer looks like.
    //
    // Raised 460→500 on 2026-10-07, same reasoning and the same measurement discipline. main.js
    // was 481 KB (already 465 KB on origin/main at 2026-08-12, CI red since). `main.meta.json`
    // again shows NO engine leak: Vditor's own source is 233 KB of it (the 3.11.3 bump, task 528),
    // the largest engine glue is plantuml-render.ts at 11.8 KB, and the rest is diffuse feature glue
    // (list editing 525, find-focus 522, hard breaks + Shift+Enter 530). 500 leaves ~19 KB of
    // headroom — still far below the hundreds of KB a bundled engine adds.
    500,
    'eager webview bundle — glue ONLY, every engine must lazy-load (addScript/fetch)',
  ],
  [
    'media/vditor/dist/js/elk/elk-main.js',
    1600,
    'separate ELK layout bundle — lazy, only when vmarkd.diagram.d2.layout=elk',
  ],
  [
    'media/vditor/dist/js/d2/d2-main.js',
    // Bumped 150→185 when rough.js (~24 KB) landed for the opt-in hand-drawn sketch mode (task 120):
    // it rides THIS lazy chunk (imported by d2-render/d2-entry), NOT main.js, so a non-D2 doc never
    // fetches it. main.js stayed at 380 KB — proof the code-split boundary held.
    185,
    'separate D2 render+layout bundle (dagre + d2-render + elk-layout + rough.js sketch) — lazy, only when a d2 block renders (task 165/120)',
  ],
  [
    'media/vditor/dist/js/mermaid-layout-elk/mermaid-elk-main.js',
    // ~74 KB thin adapter: the @mermaid-js/layout-elk render chunk + d3's curveLinear. elkjs is ALIASED
    // to the shared window.__vmarkdElk (elk-bundled-shim.ts) so it must NOT ship here — this ceiling is
    // FAR below elkjs's ~1.4 MB, so a broken alias (elkjs leaking in) fails loudly (task 112).
    110,
    'separate mermaid-ELK layout adapter — lazy, only when vmarkd.diagram.mermaid.layout=elk',
  ],
  [
    'media/vditor/dist/js/plantuml-stdlib/awslib.js',
    // The AWS icon file-map (task 136) — 827 self-contained sprite .puml files inlined as a window-global
    // map, lazy-loaded ONLY when a diagram does `!include <awslib/…>`. The `all.puml` category aggregators
    // (~3.4 MB, half the tree) are NOT shipped — the expander synthesizes `<lib/Cat/all>` from the
    // individual icons (plantuml-stdlib.ts); this ceiling catches their accidental re-inclusion.
    4300,
    'separate AWS PlantUML stdlib icon map — lazy, only for !include <awslib/…> (task 136)',
  ],
]

let failed = false
console.log('Bundle-size budget (task 145 item 3):')
for (const [file, maxKB, what] of BUDGETS) {
  let kb
  try {
    kb = Math.round(statSync(new URL(`../${file}`, import.meta.url)).size / 1024)
  } catch {
    console.error(`  ✖ ${file} — MISSING (run \`node build.mjs\` first)`)
    failed = true
    continue
  }
  const ok = kb <= maxKB
  console.log(`  ${ok ? '✓' : '✖'} ${file}  ${kb} KB / ${maxKB} KB  — ${what}`)
  if (!ok) failed = true
}

if (failed) {
  console.error(
    '\nBundle-size budget EXCEEDED. An engine may have leaked into main.js (engines must lazy-load,\n' +
      'not be bundled), or a dependency bloated the glue. Inspect WHAT grew with esbuild analyze on\n' +
      'media/dist/main.meta.json, then fix the leak — or bump the budget deliberately with a reason.',
  )
  process.exit(1)
}
console.log('All bundles within budget.')
