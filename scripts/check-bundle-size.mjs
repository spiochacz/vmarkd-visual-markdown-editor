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
    525,
    'eager webview bundle — glue ONLY, every engine must lazy-load (addScript/fetch)',
  ],
  [
    'media/vditor/dist/js/elk/elk-main.js',
    1600,
    'separate ELK layout bundle — lazy, only when vmarkd.diagram.d2Layout=elk',
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
