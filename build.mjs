#!/usr/bin/env node
// Build orchestration for the extension — plain Node, no extra tooling
// (no `foy`, no `ts-node`, no Bun). Run with Node:
//
//   node build.mjs          one-shot build: sync assets, compile host + webview
//   node build.mjs watch    watch mode: tsc -w + webview watcher, in parallel
//
// The webview half lives in media-src (its own esbuild build, `node build.mjs`);
// here we sync Vditor's prebuilt assets into media/ and drive both compilers.

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

// node_modules/.bin so `tsc` resolves whether this is run via `npm run build`
// or directly as `node build.mjs`.
const BIN = path.resolve('node_modules/.bin')

// Run a command, inheriting stdio; reject on non-zero exit.
function run(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
      },
      ...opts,
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`\`${command}\` exited with ${code}`)),
    )
  })
}

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
      path.join(targetDir, 'index.css'),
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

async function removeMacMetadata(dirPath) {
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
    }),
  )
}

// Overwrite Vditor's bundled lute.min.js with our pinned, vendored Lute build
// (media-src/vendor/lute, pinned to an explicit 88250/lute commit — see tasks/66).
// Verifies the vendored file against source.json (tamper/corruption guard) and
// propagates the Mulan PSL v2 LICENSE + NOTICE into the shipped media/ tree
// (.vscodeignore excludes media-src/, so the notices must live under media/).
async function syncLute() {
  const vendorDir = path.resolve('media-src/vendor/lute')
  const luteTargetDir = path.resolve('media/vditor/dist/js/lute')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    // No vendored Lute pinned — fall back to Vditor's bundled copy.
    console.log(
      '[lute] no vendored pin (media-src/vendor/lute) — using Vditor default',
    )
    return
  }

  const js = await fs.readFile(path.join(vendorDir, 'lute.min.js'))
  const got = createHash('sha256').update(js).digest('hex')
  if (got !== source.sha256) {
    throw new Error(
      `[lute] vendored lute.min.js sha256 mismatch:\n  expected ${source.sha256}\n  got      ${got}\n` +
        `Re-pin with: node media-src/scripts/fetch-lute.mjs <sha>`,
    )
  }

  await fs.mkdir(luteTargetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'lute.min.js'),
    path.join(luteTargetDir, 'lute.min.js'),
  )
  await fs.copyFile(
    path.join(vendorDir, 'lute.min.js.map'),
    path.join(luteTargetDir, 'lute.min.js.map'),
  )
  // Ship the license + attribution alongside the binary (Mulan PSL v2 §4).
  for (const f of ['LICENSE', 'NOTICE']) {
    await fs.copyFile(
      path.join(vendorDir, f),
      path.join(luteTargetDir, `lute.${f}`),
    )
  }
  console.log(
    `[lute] vendored ${source.commit.slice(0, 10)} (${source.goVersion}) verified + installed`,
  )
}

const watch = process.argv.includes('watch')

await syncVditorAssets()
await syncLute()
// Generate the merged icon sprite (media/vditor-icons.js): ant symbols with our
// toolbar glyphs swapped for codicons. See media-src/build-icon-sprite.mjs + task 44.
await run('node media-src/build-icon-sprite.mjs')

if (watch) {
  await Promise.all([
    run('tsc -w -p ./'),
    run('npm run start', { cwd: 'media-src' }),
  ])
} else {
  await Promise.all([
    run('tsc -p ./'),
    run('npm run build', { cwd: 'media-src' }),
  ])
}
