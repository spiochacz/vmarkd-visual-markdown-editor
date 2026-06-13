// esbuild driver for the webview bundle (task 20). Replaces the bare CLI so we
// can import Vditor from *source* (`vditor/src/index`) and tree-shake it, which
// the pre-bundled `vditor/dist/index.js` can't do. The Vditor-source specifics
// live in esbuild-shared.mjs (reused by the e2e harness server).
import * as esbuild from 'esbuild'
import { rmSync } from 'node:fs'
import { vditorSourceConfig } from './esbuild-shared.mjs'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const mainOptions = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: '../media/dist/main.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  ...vditorSourceConfig,
}

// The lazy Marp chunk (task 107). A SEPARATE bundle (not a code-split of main.js) so main.js
// stays a plain iife and the chunk is loaded on demand via an injected <script> (marp-preview.ts).
// marp-core is bundled in here; it does NOT need the Vditor-source treatment.
/** @type {import('esbuild').BuildOptions} */
const marpOptions = {
  entryPoints: ['./src/marp-entry.ts'],
  bundle: true,
  outfile: '../media/dist/marp.js',
  format: 'iife',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
}

rmSync(new URL('../media/dist', import.meta.url), {
  recursive: true,
  force: true,
})

if (watch) {
  const mainCtx = await esbuild.context(mainOptions)
  const marpCtx = await esbuild.context(marpOptions)
  await Promise.all([mainCtx.watch(), marpCtx.watch()])
  console.log('[build.mjs] watching…')
} else {
  await Promise.all([esbuild.build(mainOptions), esbuild.build(marpOptions)])
}
