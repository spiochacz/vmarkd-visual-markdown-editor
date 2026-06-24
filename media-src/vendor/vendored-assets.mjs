// ── Vendored-asset sync ─────────────────────────────────────────────────────────────────────────
// Every diagram/render engine we pin lives under media-src/vendor/<dir>/ with a source.json recording
// its provenance + sha256(s). `.vscodeignore` excludes media-src/, so the bytes AND their license text
// must be copied into the shipped media/vditor/dist/js/<dir>/ tree. This single declarative
// VENDORED_ASSETS table + syncVendored() engine replaces the ~15 near-identical per-lib sync functions
// (the same consolidation the esbuild VDITOR_TS_PATCHES registry did for TS patches): one row per
// asset, uniform sha-verify → mkdir → copy bytes → copy LICENSE/NOTICE → consistent log.
//
// Copying the license is NOT optional: d2 (MPL-2.0) and elk (EPL-2.0) are copyleft and legally require
// their license to accompany the shipped binary, and even the permissive ones need attribution. The
// old per-function code copied a license for only 3 of 15 libs — a marketplace-distribution defect
// (tasks/149). The shipped-license invariant is guarded by test/backend/vendored-licenses.test.ts.
//
// Re-pinning (version/CVE bump): lute/mermaid/echarts have media-src/scripts/fetch-*.mjs; d2 is
// rebuilt via media-src/vendor/d2/build/build-d2-wasm.sh; the rest are a manual download → sha256 →
// edit source.json (each vendor dir's source.json `origin`/`source` records where from). The sha gate
// below fails the build loudly on any mismatch, so a wrong manual re-pin can never ship silently.
//
// Entry shape:
//   dir            media-src/vendor/<dir> ⇄ media/vditor/dist/js/<dir>
//   copy           [[srcFile, destFile], …] bytes to ship (sha-verified when source.json lists them).
//                  Empty for elk: its bytes are esbuild-bundled into elk-main.js by the webview build;
//                  syncVendored still sha-GATES the sources + ships the license next to elk-main.js.
//   license        license/notice filenames in the vendor dir → shipped as `<dir>.<file>`
//   label          (source) => version string for the log (default `v${source.version}`)
//   installedNote  optional suffix on the success log
//   missingNote    optional suffix on the "no vendored pin" log
export const VENDORED_ASSETS = [
  // Lute (Mulan PSL v2 §4): overwrites Vditor's bundled lute.min.js with our pinned 88250/lute build
  // (tasks/66). sha lives at source.sha256 (top-level), not in a files map; the .map is copied unguarded.
  {
    dir: 'lute',
    copy: [
      ['lute.min.js', 'lute.min.js'],
      ['lute.min.js.map', 'lute.min.js.map'],
    ],
    license: ['LICENSE', 'NOTICE'],
    label: (s) => `${s.commit.slice(0, 10)} (${s.goVersion})`,
    missingNote: 'using Vditor default',
  },
  // Mermaid (MIT) — pinned newer build, same major, API-compatible (tasks/86). Top-level sha.
  {
    dir: 'mermaid',
    copy: [['mermaid.min.js', 'mermaid.min.js']],
    license: ['LICENSE', 'NOTICE'],
    missingNote: 'using Vditor default',
  },
  // ECharts (Apache-2.0) — major bump 5→6, fidelity verified at pin time (tasks/89). Top-level sha.
  {
    dir: 'echarts',
    copy: [['echarts.min.js', 'echarts.min.js']],
    license: ['LICENSE', 'NOTICE'],
    missingNote: 'using Vditor default',
  },
  // PlantUML offline TeaVM — plantuml.js (MIT, plantuml/plantuml-mit) + viz-global.js (MIT, @viz-js/viz);
  // graphviz reuses this same viz-global.js (tasks/87). Both license texts vendored.
  {
    dir: 'plantuml',
    copy: [
      ['plantuml.js', 'plantuml.js'],
      ['viz-global.js', 'viz-global.js'],
    ],
    license: ['LICENSE', 'viz-global.LICENSE'],
    missingNote: 'PlantUML offline disabled',
  },
  { dir: 'abcjs', copy: [['abcjs_basic.min.js', 'abcjs_basic.min.js']], license: ['LICENSE'] },
  {
    dir: 'smiles-drawer',
    copy: [['smiles-drawer.min.js', 'smiles-drawer.min.js']],
    license: ['LICENSE'],
  },
  { dir: 'wavedrom', copy: [['wavedrom.min.js', 'wavedrom.min.js']], license: ['LICENSE'] },
  { dir: 'nomnoml', copy: [['nomnoml.min.js', 'nomnoml.min.js']], license: ['LICENSE'] },
  {
    dir: 'leaflet',
    copy: [
      ['leaflet.js', 'leaflet.js'],
      ['leaflet.css', 'leaflet.css'],
    ],
    license: ['LICENSE'],
  },
  {
    dir: 'topojson',
    copy: [['topojson-client.min.js', 'topojson-client.min.js']],
    license: ['LICENSE'],
  },
  { dir: 'vega', copy: [['vega-embed.min.js', 'vega-embed.min.js']], license: ['LICENSE'] },
  { dir: 'threejs', copy: [['three-stl.min.js', 'three-stl.min.js']], license: ['LICENSE'] },
  {
    dir: 'markmap',
    copy: [['markmap.min.js', 'markmap.min.js']],
    license: ['LICENSE'],
    missingNote: 'using Vditor default',
  },
  // D2 (MPL-2.0, copyleft — license MUST ship) — compile-only Go→WASM, rebuilt via
  // media-src/vendor/d2/build/build-d2-wasm.sh.
  {
    dir: 'd2',
    copy: [
      ['d2-compile.wasm', 'd2-compile.wasm'],
      ['wasm_exec.js', 'wasm_exec.js'],
    ],
    license: ['LICENSE'],
  },
  // elkjs (EPL-2.0, copyleft — license MUST ship). Its bytes are esbuild-bundled into elk-main.js by
  // the webview build, so copy NOTHING; syncVendored still sha-GATES elk-api.js + elk-worker.min.js and
  // ships the license into the same dir as the generated elk-main.js. See media-src/src/elk-entry.ts.
  {
    dir: 'elk',
    copy: [],
    license: ['LICENSE'],
    installedNote: 'bundled to elk-main.js by the webview build',
  },
]
