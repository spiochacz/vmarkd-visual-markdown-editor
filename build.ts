#!/usr/bin/env bun
// Build orchestration for the extension — run with Bun (replaces the former
// Foyfile.ts). Bun executes this TypeScript directly, so there is no `foy` task
// runner and no `ts-node` in the toolchain.
//
//   bun ./build.ts          one-shot build: sync assets, compile host + webview
//   bun ./build.ts watch    watch mode: tsc -w + webview watcher, in parallel
//
// The webview half lives in media-src (its own esbuild build, `node build.mjs`);
// here we sync Vditor's prebuilt assets into media/ and drive both compilers.

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { $ } from 'bun'

async function syncVditorAssets() {
  const sourceDir = path.resolve('media-src/node_modules/vditor/dist')
  const targetDir = path.resolve('media/vditor/dist')

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })
  await Promise.all([
    fs.cp(path.join(sourceDir, 'js'), path.join(targetDir, 'js'), {
      recursive: true,
    }),
    fs.cp(path.join(sourceDir, 'css'), path.join(targetDir, 'css'), {
      recursive: true,
    }),
    fs.cp(path.join(sourceDir, 'images'), path.join(targetDir, 'images'), {
      recursive: true,
    }),
    fs.copyFile(
      path.join(sourceDir, 'index.css'),
      path.join(targetDir, 'index.css')
    ),
  ])
  // Drop unused MathJax (~6.5 MB, the largest renderer asset). Vditor defaults
  // to KaTeX (`preview.math.engine`) and never fetches MathJax at runtime — the
  // webview sets no engine. If a `MathJax` engine option is ever introduced,
  // REMOVE this exclusion. See tasks/40-drop-unused-mathjax.md.
  await fs.rm(path.join(targetDir, 'js', 'mathjax'), {
    recursive: true,
    force: true,
  })
  await removeMacMetadata(targetDir)
}

async function removeMacMetadata(dirPath: string) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await removeMacMetadata(entryPath)
        return
      }
      if (entry.name === '.DS_Store') {
        await fs.rm(entryPath, { force: true })
      }
    })
  )
}

const watch = process.argv.includes('watch')

await syncVditorAssets()

if (watch) {
  await Promise.all([
    $`tsc -w -p ./`,
    $`bun run start`.cwd('media-src'),
  ])
} else {
  await Promise.all([$`tsc -p ./`, $`bun run build`.cwd('media-src')])
  await $`git add -A`
}
