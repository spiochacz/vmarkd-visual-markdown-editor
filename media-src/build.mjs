// esbuild driver for the webview bundle (task 20). Replaces the bare CLI so we
// can import Vditor from *source* (`vditor/src/index`) and tree-shake it, which
// the pre-bundled `vditor/dist/index.js` can't do. The Vditor-source specifics
// live in esbuild-shared.mjs (reused by the e2e harness server).
import * as esbuild from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'
import { vditorSourceConfig } from './esbuild-shared.mjs'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: '../media/dist/main.js',
  sourcemap: true,
  minify: !watch,
  // Emit a metafile so the bundle-size budget check (scripts/check-bundle-size.mjs, task 145 item 3)
  // — and ad-hoc `esbuild --analyze` inspection — can see WHAT landed in main.js (catches an engine
  // accidentally bundled in instead of lazy-loaded). Written to media/dist/main.meta.json (gitignored).
  metafile: true,
  logLevel: 'info',
  // (woff2 external lives in vditorSourceConfig — shared with the e2e harness server.)
  ...vditorSourceConfig,
}

// Optional ELK D2 layout engine (vmarkd.diagram.d2Layout=elk) — a SEPARATE bundle so the ~1.5 MB
// of vendored elkjs stays out of main.js and is fetched only when that engine is active (loaded on
// demand by elk-layout.ts → window.__vmarkdElk). Bundles elk-api.js + the main-thread "fake worker"
// (elk-worker.min.js) via elk-entry.ts — NO Web Worker (see elk-entry.ts for why). Output lands in
// media/vditor/dist/js/elk/, which already exists (syncVditorAssets ran before this build) and is
// NOT wiped by the rmSync below (that only clears media/dist). Source-min already, so no re-minify
// / sourcemap. The elk SHAs are gated separately by build.mjs `syncElk`.
/** @type {import('esbuild').BuildOptions} */
const elkOptions = {
  entryPoints: ['./src/elk-entry.ts'],
  bundle: true,
  outfile: '../media/vditor/dist/js/elk/elk-main.js',
  format: 'iife',
  sourcemap: false,
  minify: !watch,
  logLevel: 'info',
  // Benign warning inside the vendored GWT-compiled worker (`x == -0`); we don't own that source.
  logOverride: { 'equals-negative-zero': 'silent' },
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
}

rmSync(new URL('../media/dist', import.meta.url), {
  recursive: true,
  force: true,
})

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build.mjs] watching…')
  await esbuild.build(elkOptions)
} else {
  const [mainResult] = await Promise.all([
    esbuild.build(options),
    esbuild.build(elkOptions),
  ])
  // Persist the metafile next to the bundle for the size-budget check + analysis.
  writeFileSync(
    new URL('../media/dist/main.meta.json', import.meta.url),
    JSON.stringify(mainResult.metafile),
  )
}
