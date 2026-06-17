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
  // graphviz now uses the shared viz-global.js from plantuml/ (task 87); drop the old
  // mdaines viz.js + full.render.js (1.9 MB) that syncVditorAssets just copied.
  await fs.rm(path.join(targetDir, 'js', 'graphviz'), {
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

// Make Vditor's content-theme palette CUSTOM-PROPERTY driven (task 84/85). Vditor
// hard-codes the `.vditor-reset` palette (hr/blockquote/table/code colours) in its
// content-theme stylesheets — which sit on top of every vMarkd content theme and force
// each theme to out-rank them with `!important`/specificity tricks. Here we rewrite
// those few declarations to `var(--vmarkd-*, <Vditor default>)` so a theme just sets
// the variables (no cascade fight); `auto` leaves them unset → the Vditor default.
// Operates on the COPIED files (post-sync). Each replacement is asserted, so a Vditor
// bump that changes a declaration fails the build loudly instead of silently drifting.
async function varifyVditorPalette() {
  const dir = path.resolve('media/vditor/dist/css/content-theme')
  // [selector marker, [ [exact decl, var-wrapped decl], … ] ] — per file (defaults
  // differ light/dark, so `auto` keeps Vditor's per-mode look).
  const edits = {
    'light.css': [
      [
        '.vditor-reset h1, .vditor-reset h2 {',
        [
          [
            '1px solid #eaecef',
            '1px solid var(--vmarkd-heading-border, #eaecef)',
          ],
        ],
      ],
      [
        '.vditor-reset hr {',
        [
          [
            'background-color: #eaecef',
            'background-color: var(--vmarkd-hr-bg, #eaecef)',
          ],
        ],
      ],
      [
        '.vditor-reset blockquote {',
        [
          ['color: #6a737d', 'color: var(--vmarkd-blockquote-fg, #6a737d)'],
          [
            '.25em solid #eaecef',
            '.25em solid var(--vmarkd-blockquote-border, #eaecef)',
          ],
        ],
      ],
      [
        '.vditor-reset table tr {',
        [
          [
            '1px solid #c6cbd1',
            '1px solid var(--vmarkd-table-border, #c6cbd1)',
          ],
          [
            'background-color: #fafbfc',
            'background-color: var(--vmarkd-table-row-bg, #fafbfc)',
          ],
        ],
      ],
      [
        '.vditor-reset table td, .vditor-reset table th {',
        [
          [
            '1px solid #dfe2e5',
            '1px solid var(--vmarkd-table-border, #dfe2e5)',
          ],
        ],
      ],
      [
        '.vditor-reset table tbody tr:nth-child(2n) {',
        [
          [
            'background-color: #fff',
            'background-color: var(--vmarkd-table-stripe, #fff)',
          ],
        ],
      ],
      [
        '.vditor-reset code:not(.hljs):not(.highlight-chroma) {',
        [
          [
            'rgba(27, 31, 35, .05)',
            'var(--vmarkd-code-bg, rgba(27, 31, 35, .05))',
          ],
        ],
      ],
    ],
    'dark.css': [
      [
        '.vditor-reset h1, .vditor-reset h2 {',
        [
          [
            '1px solid #d1d5da',
            '1px solid var(--vmarkd-heading-border, #d1d5da)',
          ],
        ],
      ],
      [
        '.vditor-reset hr {',
        [
          [
            'background-color: #d1d5da',
            'background-color: var(--vmarkd-hr-bg, #d1d5da)',
          ],
        ],
      ],
      [
        '.vditor-reset blockquote {',
        [
          ['color: #b9b9b9', 'color: var(--vmarkd-blockquote-fg, #b9b9b9)'],
          [
            '.25em solid #d1d5da',
            '.25em solid var(--vmarkd-blockquote-border, #d1d5da)',
          ],
        ],
      ],
      [
        '.vditor-reset table tr {',
        [
          [
            'background-color: #2f363d',
            'background-color: var(--vmarkd-table-row-bg, #2f363d)',
          ],
        ],
      ],
      [
        '.vditor-reset table td, .vditor-reset table th {',
        [
          [
            '1px solid #dfe2e5',
            '1px solid var(--vmarkd-table-border, #dfe2e5)',
          ],
        ],
      ],
      [
        '.vditor-reset table tbody tr:nth-child(2n) {',
        [
          [
            'background-color: #24292e',
            'background-color: var(--vmarkd-table-stripe, #24292e)',
          ],
        ],
      ],
      [
        '.vditor-reset code:not(.hljs):not(.highlight-chroma) {',
        [
          [
            'rgba(66, 133, 244, .36)',
            'var(--vmarkd-code-bg, rgba(66, 133, 244, .36))',
          ],
        ],
      ],
    ],
  }
  for (const [file, rules] of Object.entries(edits)) {
    const filePath = path.join(dir, file)
    let css = await fs.readFile(filePath, 'utf8')
    for (const [marker, decls] of rules) {
      const start = css.indexOf(marker)
      if (start < 0)
        throw new Error(`[theme-vars] selector not found in ${file}: ${marker}`)
      const end = css.indexOf('}', start)
      let block = css.slice(start, end)
      for (const [oldDecl, newDecl] of decls) {
        if (!block.includes(oldDecl))
          throw new Error(
            `[theme-vars] decl "${oldDecl}" not found in ${file} rule "${marker}" — Vditor changed; update build.mjs`,
          )
        block = block.replace(oldDecl, newDecl)
      }
      css = css.slice(0, start) + block + css.slice(end)
    }
    await fs.writeFile(filePath, css)
  }
  console.log(
    '[theme-vars] content-theme palette → --vmarkd-* custom properties',
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

// Overwrite Vditor's bundled mermaid.min.js (11.6.0) with our pinned, vendored
// newer build (media-src/vendor/mermaid — see tasks/86). Same major, API-compatible
// (globalThis.mermaid + initialize/render). Verifies sha256 + ships the MIT LICENSE/
// NOTICE next to the binary (.vscodeignore excludes media-src/, so notices live in media/).
async function syncMermaid() {
  const vendorDir = path.resolve('media-src/vendor/mermaid')
  const targetDir = path.resolve('media/vditor/dist/js/mermaid')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[mermaid] no vendored pin (media-src/vendor/mermaid) — using Vditor default',
    )
    return
  }

  const js = await fs.readFile(path.join(vendorDir, 'mermaid.min.js'))
  const got = createHash('sha256').update(js).digest('hex')
  if (got !== source.sha256) {
    throw new Error(
      `[mermaid] vendored mermaid.min.js sha256 mismatch:\n  expected ${source.sha256}\n  got      ${got}\n` +
        `Re-pin with: node media-src/scripts/fetch-mermaid.mjs <version>`,
    )
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'mermaid.min.js'),
    path.join(targetDir, 'mermaid.min.js'),
  )
  for (const f of ['LICENSE', 'NOTICE']) {
    await fs.copyFile(
      path.join(vendorDir, f),
      path.join(targetDir, `mermaid.${f}`),
    )
  }
  console.log(`[mermaid] vendored v${source.version} verified + installed`)
}

// Overwrite Vditor's bundled echarts.min.js (5.5.1) with our pinned, vendored newer build
// (media-src/vendor/echarts — see tasks/89). ECharts 6 is a MAJOR bump (fidelity verified at
// pin time). Same load contract: the global UMD build exposing window.echarts. Verifies sha256
// + ships the Apache-2.0 LICENSE/NOTICE next to the binary (.vscodeignore excludes media-src/).
async function syncEcharts() {
  const vendorDir = path.resolve('media-src/vendor/echarts')
  const targetDir = path.resolve('media/vditor/dist/js/echarts')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[echarts] no vendored pin (media-src/vendor/echarts) — using Vditor default',
    )
    return
  }

  const js = await fs.readFile(path.join(vendorDir, 'echarts.min.js'))
  const got = createHash('sha256').update(js).digest('hex')
  if (got !== source.sha256) {
    throw new Error(
      `[echarts] vendored echarts.min.js sha256 mismatch:\n  expected ${source.sha256}\n  got      ${got}\n` +
        `Re-pin with: node media-src/scripts/fetch-echarts.mjs <version>`,
    )
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'echarts.min.js'),
    path.join(targetDir, 'echarts.min.js'),
  )
  for (const f of ['LICENSE', 'NOTICE']) {
    await fs.copyFile(
      path.join(vendorDir, f),
      path.join(targetDir, `echarts.${f}`),
    )
  }
  console.log(`[echarts] vendored v${source.version} verified + installed`)
}

async function syncPlantuml() {
  const vendorDir = path.resolve('media-src/vendor/plantuml')
  const targetDir = path.resolve('media/vditor/dist/js/plantuml')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[plantuml] no vendored pin (media-src/vendor/plantuml) — PlantUML offline disabled',
    )
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[plantuml] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'plantuml.js'),
    path.join(targetDir, 'plantuml.js'),
  )
  await fs.copyFile(
    path.join(vendorDir, 'viz-global.js'),
    path.join(targetDir, 'viz-global.js'),
  )
  console.log(`[plantuml] vendored v${source.version} verified + installed`)
}

async function syncAbcjs() {
  const vendorDir = path.resolve('media-src/vendor/abcjs')
  const targetDir = path.resolve('media/vditor/dist/js/abcjs')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[abcjs] no vendored pin (media-src/vendor/abcjs) — using Vditor default',
    )
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[abcjs] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.copyFile(
    path.join(vendorDir, 'abcjs_basic.min.js'),
    path.join(targetDir, 'abcjs_basic.min.js'),
  )
  console.log(`[abcjs] vendored v${source.version} verified + installed`)
}

async function syncSmilesDrawer() {
  const vendorDir = path.resolve('media-src/vendor/smiles-drawer')
  const targetDir = path.resolve('media/vditor/dist/js/smiles-drawer')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[smiles-drawer] no vendored pin (media-src/vendor/smiles-drawer) — using Vditor default',
    )
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[smiles-drawer] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.copyFile(
    path.join(vendorDir, 'smiles-drawer.min.js'),
    path.join(targetDir, 'smiles-drawer.min.js'),
  )
  console.log(`[smiles-drawer] vendored v${source.version} verified + installed`)
}

async function syncWavedrom() {
  const vendorDir = path.resolve('media-src/vendor/wavedrom')
  const targetDir = path.resolve('media/vditor/dist/js/wavedrom')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[wavedrom] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'wavedrom.min.js'),
    path.join(targetDir, 'wavedrom.min.js'),
  )
  console.log(`[wavedrom] vendored v${source.version} verified + installed`)
}

async function syncNomnoml() {
  const vendorDir = path.resolve('media-src/vendor/nomnoml')
  const targetDir = path.resolve('media/vditor/dist/js/nomnoml')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[nomnoml] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'nomnoml.min.js'),
    path.join(targetDir, 'nomnoml.min.js'),
  )
  console.log(`[nomnoml] vendored v${source.version} verified + installed`)
}

async function syncLeaflet() {
  const vendorDir = path.resolve('media-src/vendor/leaflet')
  const targetDir = path.resolve('media/vditor/dist/js/leaflet')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const buf = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[leaflet] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'leaflet.js'),
    path.join(targetDir, 'leaflet.js'),
  )
  await fs.copyFile(
    path.join(vendorDir, 'leaflet.css'),
    path.join(targetDir, 'leaflet.css'),
  )
  console.log(`[leaflet] vendored v${source.version} verified + installed`)
}

async function syncTopojson() {
  const vendorDir = path.resolve('media-src/vendor/topojson')
  const targetDir = path.resolve('media/vditor/dist/js/topojson')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const buf = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[topojson] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'topojson-client.min.js'),
    path.join(targetDir, 'topojson-client.min.js'),
  )
  console.log(`[topojson] vendored v${source.version} verified + installed`)
}

async function syncThreejs() {
  const vendorDir = path.resolve('media-src/vendor/threejs')
  const targetDir = path.resolve('media/vditor/dist/js/threejs')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const buf = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[threejs] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(
    path.join(vendorDir, 'three-stl.min.js'),
    path.join(targetDir, 'three-stl.min.js'),
  )
  console.log(`[threejs] vendored v${source.version} verified + installed`)
}

async function syncMarkmap() {
  const vendorDir = path.resolve('media-src/vendor/markmap')
  const targetDir = path.resolve('media/vditor/dist/js/markmap')

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      '[markmap] no vendored pin (media-src/vendor/markmap) — using Vditor default',
    )
    return
  }

  for (const [name, meta] of Object.entries(source.files)) {
    const js = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(js).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `[markmap] vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.copyFile(
    path.join(vendorDir, 'markmap.min.js'),
    path.join(targetDir, 'markmap.min.js'),
  )
  console.log(`[markmap] vendored v${source.version} verified + installed`)
}

// Patch Vditor's OWN CSS at the source (we already patch its TS via esbuild; a Vditor fork is on
// the table). Vditor's index.css zeroes WYSIWYG inline-code horizontal padding with `!important`
// (`.vditor-wysiwyg code[data-marker="`"] { padding-left:0 !important; padding-right:0 !important }`)
// — so inline-code pills lose their h-padding in WYSIWYG only (IR/Preview keep it) and the
// text touches the pill edge. A content-theme rule can't beat it (same specificity, Vditor wins on
// source order). Rewrite the values to `var(--vmarkd-code-px, .4em)` so WYSIWYG matches IR/Preview
// AND follows the theme: default `.4em` (github/material), but a theme can set `--vmarkd-code-px`
// (vscode-2026 → 3px, VS Code's value) and WYSIWYG tracks it. Operates on the COPIED file
// (post-sync); asserted so a Vditor bump that changes this rule fails loudly.
async function patchVditorIndexCss() {
  const file = path.resolve('media/vditor/dist/index.css')
  const anchor =
    '.vditor-wysiwyg code[data-marker="`"] {\n  padding-left: 0 !important;\n  padding-right: 0 !important;\n}'
  let css = await fs.readFile(file, 'utf8')
  if (!css.includes(anchor)) {
    throw new Error(
      '[index-css] WYSIWYG inline-code padding rule not found in vditor index.css — Vditor changed; update build.mjs',
    )
  }
  css = css.replace(
    anchor,
    '.vditor-wysiwyg code[data-marker="`"] {\n  padding-left: var(--vmarkd-code-px, .4em) !important;\n  padding-right: var(--vmarkd-code-px, .4em) !important;\n}',
  )
  await fs.writeFile(file, css)
  console.log(
    '[index-css] WYSIWYG inline-code h-padding 0 → var(--vmarkd-code-px, .4em) (matches IR/Preview, theme-driven)',
  )
}

const watch = process.argv.includes('watch')

await syncVditorAssets()
await varifyVditorPalette()
await patchVditorIndexCss()
await syncLute()
await syncMermaid()
await syncEcharts()
await syncPlantuml()
await syncAbcjs()
await syncSmilesDrawer()
await syncWavedrom()
await syncNomnoml()
await syncLeaflet()
await syncTopojson()
await syncThreejs()
await syncMarkmap()
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
