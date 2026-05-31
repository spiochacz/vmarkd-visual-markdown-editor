// esbuild driver for the webview bundle (task 20). Replaces the bare CLI so we
// can import Vditor from *source* (`vditor/src/index`) and tree-shake it, which
// the pre-bundled `vditor/dist/index.js` can't do. The Vditor-source specifics
// live in esbuild-shared.mjs (reused by the e2e harness server).
import * as esbuild from 'esbuild'
import { rmSync } from 'node:fs'
import { vditorSourceConfig } from './esbuild-shared.mjs'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: '../media/dist/main.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  ...vditorSourceConfig,
}

rmSync(new URL('../media/dist', import.meta.url), { recursive: true, force: true })

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build.mjs] watching…')
} else {
  await esbuild.build(options)
}
