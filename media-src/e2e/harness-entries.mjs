// e2e harness registry — SINGLE SOURCE OF TRUTH (task 150 item 2).
//
// serve.mjs used to hand-maintain FOUR parallel ~31-item lists (esbuild
// entryPoints, the readFileSync HTML consts, the route `if (url === …)` chain) and
// coverage-options.ts kept a FIFTH (the coverage allowlist regex). They drifted:
// 9 harness bundles were dropped from the coverage allowlist, so their src/ modules
// (incl. the active branch's hot `custom-diagrams.ts`) read as 0% even though their
// harness ran. Everything now derives from this one list, and a meta-test
// (harness-registry.test.ts) asserts every coverage-counted entry is matched.
//
// Each entry:
//   key       esbuild entry name → bundle served at `/<key>.js`
//   ts        harness source       (default `<key>-harness.ts`)
//   html      page file served     (default `<key>.html`)
//   routes    URL path(s)          (default `['/<html>']`)
//   coverage  count this bundle's V8 coverage (default true; bench is perf-only)
const RAW = [
  { key: 'harness', ts: 'harness.ts', html: 'index.html', routes: ['/', '/index.html'] },
  { key: 'behaviors' },
  { key: 'bench', coverage: false },
  { key: 'outline' },
  { key: 'prerender' },
  { key: 'link' },
  { key: 'list' },
  { key: 'math' },
  { key: 'save-flush' },
  { key: 'incremental-md' },
  { key: 'wysiwyg-input' },
  { key: 'wysiwyg-highlight' },
  { key: 'tab' },
  { key: 'stream' },
  { key: 'keybugs' },
  { key: 'scrolljump' },
  { key: 'mermaid' },
  { key: 'echarts' },
  { key: 'blockbg' },
  { key: 'gap' },
  { key: 'codenav' },
  { key: 'callout-ir' },
  { key: 'callouts' },
  { key: 'image-convert' },
  { key: 'width' },
  { key: 'wiki' },
  { key: 'split-scroll' },
  { key: 'preview-scroll' },
  { key: 'code-linenumber' },
  { key: 'config-apply' },
  {
    key: 'custom-diagrams-harness',
    ts: 'custom-diagrams-harness.ts', // key already ends in -harness; don't double it
    html: 'custom-diagrams.html',
  },
]

export const HARNESS_ENTRIES = RAW.map((e) => {
  const html = e.html ?? `${e.key}.html`
  return {
    key: e.key,
    ts: e.ts ?? `${e.key}-harness.ts`,
    html,
    routes: e.routes ?? [`/${html}`],
    coverage: e.coverage !== false,
  }
})

// The bundle keys whose coverage we count (everything except perf-only bench) —
// consumed by coverage-options.ts to build the entryFilter.
export const COVERAGE_KEYS = HARNESS_ENTRIES.filter((e) => e.coverage).map(
  (e) => e.key,
)
