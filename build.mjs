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
import { VENDORED_ASSETS } from './media-src/vendor/vendored-assets.mjs'
import { varifyGeometryCss } from './scripts/vditor-geometry-patch.mjs'
import {
  LUTE_HARD_BREAK_PATCHES,
  LUTE_LOOSE_LIST_PATCHES,
  patchLuteBlob,
} from './scripts/lute-blob-patch.mjs'

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
    // Vditor's own MIT license. It sits in the package ROOT, not in dist/, so the three copies above
    // miss it — and this function rm -rf's the target first, so a committed copy would not survive
    // either. Vditor is the one shipped library with no vendor/ dir of its own (we ship its whole
    // dist rather than a pinned file), so the copy belongs here, next to the bytes it covers.
    fs.copyFile(
      path.resolve('media-src/node_modules/vditor/LICENSE'),
      path.join(targetDir, 'vditor.LICENSE'),
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

// VENDORED_ASSETS table (the declarative vendor registry) lives in its own module so a
// unit test can import it without running this build script. syncVendored() (below) is the engine.

// Sync one vendored asset: sha-gate every file source.json pins, then mkdir + copy the bytes and the
// license text. Throws (fails the build) on a sha mismatch or a declared-but-missing license file.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sha-gates + copies every file/license an entry declares, branching per failure mode; pre-existing (task 469 baseline)
async function syncVendored(entry) {
  const tag = `[${entry.dir}]`
  const vendorDir = path.resolve('media-src/vendor', entry.dir)
  const targetDir = path.resolve('media/vditor/dist/js', entry.dir)

  let source
  try {
    source = JSON.parse(
      await fs.readFile(path.join(vendorDir, 'source.json'), 'utf8'),
    )
  } catch {
    console.log(
      `${tag} no vendored pin (media-src/vendor/${entry.dir}) — ${entry.missingNote || 'skipped'}`,
    )
    return
  }

  // source.json pins shas either as a files map ({name:{sha256}}) or, for lute/mermaid/echarts, a
  // single top-level sha256 covering the primary copied file — plus, for lute, a top-level
  // `mapSha256` covering the second copy (the sourcemap), previously declared-but-unchecked
  // (audit 185/3d). Verify every file we know a sha for.
  const shaMap =
    source.files ||
    (source.sha256 && entry.copy[0]
      ? {
          [entry.copy[0][0]]: { sha256: source.sha256 },
          ...(source.mapSha256 && entry.copy[1]
            ? { [entry.copy[1][0]]: { sha256: source.mapSha256 } }
            : {}),
        }
      : {})
  for (const [name, meta] of Object.entries(shaMap)) {
    const buf = await fs.readFile(path.join(vendorDir, name))
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== meta.sha256) {
      throw new Error(
        `${tag} vendored ${name} sha256 mismatch:\n  expected ${meta.sha256}\n  got      ${got}`,
      )
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  for (const [src, dst] of entry.copy) {
    await fs.copyFile(path.join(vendorDir, src), path.join(targetDir, dst))
  }
  // Ship the license/notice next to the binary — required for copyleft d2/elk, attribution for all.
  for (const f of entry.license || []) {
    await fs.copyFile(
      path.join(vendorDir, f),
      path.join(targetDir, `${entry.dir}.${f}`),
    )
  }

  const ver = (entry.label || ((s) => `v${s.version}`))(source)
  console.log(
    `${tag} vendored ${ver} verified + installed${entry.installedNote ? ` (${entry.installedNote})` : ''}`,
  )
}

// Task 464 follow-up (measured 2026-07-31): patching `.vditor-ir__link` in index.css is NOT enough,
// because Vditor sets that colour in TWO stylesheets. `content-theme/dark.css` carries
// `.vditor-reset a, .vditor-ir__link { color: #4285f4 }` — the `.vditor-ir__link` branch matches at
// (0,1,0), the SAME specificity as the patched index.css rule, and html-builder.ts links the
// content theme AFTER index.css/main.css. Tie + later load = dark.css wins, so the IR link silently
// reverted to Vditor's hardcoded #4285f4 in every dark session while light mode (no such rule in
// light.css) looked correct.
//
// This is also why the old `main.css` override was `.vditor-reset .vditor-ir__link` (0,2,0), not the
// bare class: that prefix was NOT gratuitous over-specificity to trim, it was out-ranking THIS rule
// regardless of load order. Dropping `.vditor-ir__link` from dark.css's selector list keeps
// patch-at-source (ADR-0003's routing rule) honest — one owner for the declaration — instead of
// re-introducing a specificity fight. `.vditor-reset a` is left alone: that is the PREVIEW link,
// owned by the content theme, and nothing has asked to change it.
async function patchContentThemeIrLink() {
  const file = path.resolve('media/vditor/dist/css/content-theme/dark.css')
  const css = await fs.readFile(file, 'utf8')
  const anchor = '.vditor-reset a, .vditor-ir__link {\n    color: #4285f4;\n}'
  if (!css.includes(anchor)) {
    throw new Error(
      '[content-theme] .vditor-ir__link anchor not found in dark.css — Vditor changed; update build.mjs',
    )
  }
  await fs.writeFile(
    file,
    css.replace(anchor, '.vditor-reset a {\n    color: #4285f4;\n}'),
  )
  console.log(
    '[content-theme] dark.css .vditor-ir__link dropped → patched index.css rule owns the IR link colour',
  )
}

// Anchor-assert-and-replace one exact literal string in `css`. Throws (Vditor-bump failure mode)
// if `anchor` isn't found verbatim; otherwise returns the rewritten string.
function replaceAnchored(css, anchor, replacement, label) {
  if (!css.includes(anchor)) {
    throw new Error(
      `[index-css] ${label} anchor not found in vditor index.css — Vditor changed; update build.mjs`,
    )
  }
  return css.replace(anchor, replacement)
}

// Task 532 step 2 — rewrite Vditor's content-geometry declarations (leading, block gap, list indent,
// heading margins, code-box padding) to `var(--vmarkd-geo-*, <Vditor value>)` in the COPIED index.css.
// The rewrite table + count-asserted apply live in scripts/vditor-geometry-patch.mjs (shared with its
// unit test). No token set => byte-for-byte the same rendering; themes set the tokens.
async function varifyVditorGeometry() {
  const file = path.resolve('media/vditor/dist/index.css')
  const css = await fs.readFile(file, 'utf8')
  await fs.writeFile(file, varifyGeometryCss(css))
  console.log(
    '[geometry] index.css content geometry → var(--vmarkd-geo-*) applied',
  )
}

// Patch Vditor's OWN CSS at the source (we already patch its TS via esbuild; a Vditor fork is on
// the table) rather than fighting it with a higher-specificity/later-load main.css override — ADR-0003's
// routing rule and ADR-0004's mechanism. Operates on the COPIED file (post-sync), so every surface that
// links it (real editor, Playwright harness, and any future export path — html-builder.ts always pairs
// this file with main.css, same order, so there is no surface where only one of the two loads) gets the
// same fix. Each rewrite is anchor-asserted so a Vditor version bump fails the build loudly instead of
// silently reverting it.
async function patchVditorIndexCss() {
  const file = path.resolve('media/vditor/dist/index.css')
  let css = await fs.readFile(file, 'utf8')

  // 1. WYSIWYG inline-code horizontal padding zeroed with `!important`
  // (`.vditor-wysiwyg code[data-marker="`"] { padding-left:0 !important; padding-right:0 !important }`)
  // — so inline-code pills lose their h-padding in WYSIWYG only (IR/Preview keep it) and the text
  // touches the pill edge. A content-theme rule can't beat it (same specificity, Vditor wins on source
  // order). Rewrite the values to `var(--vmarkd-code-px, .4em)` so WYSIWYG matches IR/Preview AND
  // follows the theme: default `.4em` (github/material), but a theme can set `--vmarkd-code-px`
  // (vscode-2026 → 3px, VS Code's value) and WYSIWYG tracks it.
  css = replaceAnchored(
    css,
    '.vditor-wysiwyg code[data-marker="`"] {\n  padding-left: 0 !important;\n  padding-right: 0 !important;\n}',
    '.vditor-wysiwyg code[data-marker="`"] {\n  padding-left: var(--vmarkd-code-px, .4em) !important;\n  padding-right: var(--vmarkd-code-px, .4em) !important;\n}',
    'WYSIWYG inline-code padding rule',
  )

  // 2. `.vditor-ir__link` (task 464). Vditor hardcodes the IR link span's colour to its bright
  // `--ir-bracket-color` (#0000ff light / #287bde dark) with an underline, following no theme. main.css
  // used to out-rank this with `.vditor-reset .vditor-ir__link` (0,2,0) beating Vditor's own (0,1,0).
  // NOTE that override was NOT simply over-specific: the extra `.vditor-reset` also beat
  // `content-theme/dark.css`'s `.vditor-reset a, .vditor-ir__link` rule, which loads AFTER this file —
  // see patchContentThemeIrLink above, which removes that second declaration so patching at source
  // here is sufficient. Fix the rule at the source instead:
  // point colour at --vmarkd-link (auto → VS Code's textLink, named themes set their own) and drop the
  // underline, so the editor link matches the preview/VS Code. Do NOT touch --ir-bracket-color itself —
  // it also drives `.vditor-ir__marker--bracket` (the `[ ]` markers) and `.vditor-sv__marker--bracket`;
  // redefining the variable would recolour those too, which nothing has asked for.
  css = replaceAnchored(
    css,
    '.vditor-ir__link {\n  color: var(--ir-bracket-color);\n  text-decoration: underline;\n}',
    '.vditor-ir__link {\n  color: var(--vmarkd-link, var(--vscode-textLink-foreground, #4493f8));\n  text-decoration: none;\n}',
    '.vditor-ir__link rule',
  )

  // 3. `.vditor-reset pre > code` diagonal-hatch `background-image` (task 464). On the content themes'
  // code panel it reads as a fragmented grey texture while editing the raw source. main.css used to
  // null it out with an identical-selector override that only won because it loads after this file —
  // drop the hatch at the source instead. Pure cosmetic (background-image only; no layout).
  css = replaceAnchored(
    css,
    '  background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8AgMAAABHkjHhAAAACVBMVEWAgIBaWlo+Pj7rTFvWAAAAA3RSTlMHCAw+VhR4AAAA+klEQVQoz4WSMW7EQAhFPxKWNh2FCx+HkaZI6RRb5DYbyVfIJXLKDCFoMbaTKSw/8ZnPAPjaH2xgZcUNUDADD7D9LtDBCLZ45fbkvo/30K8yeI64pPwl6znd/3n/Oe93P3ho9qeh72btTFzqkz0rsJle8Zr81OLEwZ1dv/713uWqvu2pl+k0fy7MWtj9r/tN5q/02z89qa/L4Dc2LvM93kezPfXlME/O86EbY/V9GB9ePX8G1/6W+/9h1dq/HGfTfzT3j/xNo7522Bfnqe5jO/fvhVthlfk434v3iO9zG/UOphyPeinPl1J8Gtaa7xPTa/Dk+RIs4deMvwGvcGsmsCvJ0AAAAABJRU5ErkJggg==);\n',
    '  background-image: none;\n',
    'pre > code hatch background-image',
  )

  // 4. `.vditor-tip__close` position (task 478 item 1). Vditor floats the About-dialog close "X"
  // 15px OUTSIDE the top-right corner (top:-7px; right:-15px), which reads as detached on our
  // larger About dialog. main.css used to null it out with an identical-selector override that only
  // won because it loads after this file. Pull it inside the corner at the source instead.
  css = replaceAnchored(
    css,
    '.vditor-tip__close {\n  position: absolute;\n  color: var(--toolbar-icon-color);\n  top: -7px;\n  right: -15px;\n  font-weight: bold;\n  cursor: pointer;\n}',
    '.vditor-tip__close {\n  position: absolute;\n  color: var(--toolbar-icon-color);\n  top: 4px;\n  right: 8px;\n  font-weight: bold;\n  cursor: pointer;\n}',
    '.vditor-tip__close position',
  )

  // 4b. The expanded IR code SOURCE's base text colour (task 532 follow-up). Vditor sets
  // `.vditor-ir__node--expand .vditor-ir__marker--pre code { color: var(--textarea-text-color) }`
  // (0,2,1), which out-ranks the active highlight.js style's `.hljs { color }` (0,1,0) that code-source.ts
  // tags onto the same `<code>`, so the editable source drew the textarea colour (rgb(209,213,218) on
  // dark) while the rendered half drew the hljs theme's own base colour (rgb(201,209,217) under
  // github-dark, ...). Scope Vditor's rule to the code that is NOT hljs-tagged, so a tagged source takes
  // its colour from the hljs theme exactly like the render, and an untagged one keeps Vditor's.
  css = replaceAnchored(
    css,
    '.vditor-ir__node--expand .vditor-ir__marker--pre code {\n  color: var(--textarea-text-color);',
    '.vditor-ir__node--expand .vditor-ir__marker--pre code:not(.hljs) {\n  color: var(--textarea-text-color);',
    'IR expanded source code colour',
  )

  // 5. `.vditor-outline` width (task 478 item 2). Vditor hardcodes 250px; main.css used to out-rank
  // it with an identical-selector override that only won on load order. Token-drive it instead of a
  // literal, so `main.ts`'s `--me-outline-width` (from the `outlineWidth` setting) still applies —
  // default 200px preserves the pre-conversion behaviour. No `!important`, same as before, so a
  // future drag-resize (inline width) still wins.
  css = replaceAnchored(
    css,
    '.vditor-outline {\n  width: 250px;\n  border-right: 1px solid var(--border-color);\n  background-color: var(--panel-background-color);\n  display: none;\n  overflow: auto;\n}',
    '.vditor-outline {\n  width: var(--me-outline-width, 200px);\n  border-right: 1px solid var(--border-color);\n  background-color: var(--panel-background-color);\n  display: none;\n  overflow: auto;\n}',
    '.vditor-outline width',
  )

  // 6. IR link-ref-defs-block gutter marker `content` (task 478 item 3). Vditor labels it '"A"';
  // main.css used to relabel it to a return arrow via an extra `.vditor-reset` ancestor
  // ((0,3,2) vs Vditor's (0,2,2) — a genuine specificity win, not a load-order coincidence). Relabel
  // at the source instead.
  css = replaceAnchored(
    css,
    '.vditor-ir div[data-type="link-ref-defs-block"]:before {\n  content: \'"A"\';\n}',
    '.vditor-ir div[data-type="link-ref-defs-block"]:before {\n  content: \'↩\';\n}',
    'link-ref-defs-block marker content',
  )

  // 7+8. IR/WYSIWYG `hr` margin (task 478 item 4, Edit↔Preview vertical-rhythm parity). NOTE: the
  // rule that actually governs the EDITING surface is `.vditor-ir hr`/`.vditor-wysiwyg hr`
  // (inline-block, 12px), not `.vditor-reset hr` (24px, line 906ish) — that one only wins on the
  // PREVIEW pane (no `.vditor-ir`/`.vditor-wysiwyg` ancestor there). On the editing surface both
  // rules match at equal specificity (0,1,1) and `.vditor-ir hr`/`.vditor-wysiwyg hr` load LATER in
  // this same file, so they win the tie — main.css's own `!important`-free override
  // (`:is(.vditor-ir,.vditor-wysiwyg) .vditor-reset hr`, 0,2,1) had to out-rank THESE, not
  // `.vditor-reset hr`, despite what task 464/478's own summary said. `.vditor-reset hr` (and its
  // background-color rule in content-theme/{light,dark}.css) is untouched — Preview keeps 24px
  // exactly as before, `display:block` is the default anyway. 1.5rem === 24px here (default root
  // font-size), the same literal main.css used, so this is pixel-identical on both surfaces.
  css = replaceAnchored(
    css,
    '.vditor-ir hr {\n  display: inline-block;\n  margin: 12px 0;\n  width: 100%;\n}',
    '.vditor-ir hr {\n  display: block;\n  margin: var(--vmarkd-geo-hr-gap, 1.5rem) 0;\n  width: 100%;\n}',
    '.vditor-ir hr margin/display',
  )
  css = replaceAnchored(
    css,
    '.vditor-wysiwyg hr {\n  display: inline-block;\n  margin: 12px 0;\n  width: 100%;\n}',
    '.vditor-wysiwyg hr {\n  display: block;\n  margin: var(--vmarkd-geo-hr-gap, 1.5rem) 0;\n  width: 100%;\n}',
    '.vditor-wysiwyg hr margin/display',
  )

  // 9. `.vditor-reset` base font-family/font-size (task 43, task 478 item 5). Vditor hardcodes its
  // own sans stack + 16px; main.css used to out-rank it unconditionally with `.vditor .vditor-reset`
  // (0,2,0) beating Vditor's own `.vditor-reset` (0,1,0) — a genuine ADR-0003 violation, since it won
  // regardless of load order. Patch the base rule directly instead: follow VS Code's editor font by
  // default, base size driven by --me-font-size (headings are em-relative so they scale with it).
  // `!important` preserved exactly (incl. the missing fallback on font-family, which resolves to
  // nothing outside a VS Code webview by design — same as before) — another main.css rule
  // (`.vditor-reset pre.vditor-ir__marker--pre > code:not(.hljs)…`, the code-source font-size-100%
  // fix) relies on out-ranking this at the !important tier. The named-theme bridge
  // (`body.markdown-body .vditor .vditor-reset` in main.css, (0,3,1)) is NOT touched: it never
  // collided with a Vditor declaration, only with this one, and (0,3,1) beats (0,1,0) exactly as it
  // beat (0,2,0) before — no source patch needed there.
  css = replaceAnchored(
    css,
    '.vditor-reset {\n  color: #24292e;\n  font-variant-ligatures: no-common-ligatures;\n  font-family: "Helvetica Neue", "Luxi Sans", "DejaVu Sans", "Hiragino Sans GB", "Microsoft Yahei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", "EmojiSymbols";\n  word-wrap: break-word;\n  overflow: auto;\n  line-height: 1.5;\n  font-size: 16px;\n  word-break: break-word;\n}',
    '.vditor-reset {\n  color: #24292e;\n  font-variant-ligatures: no-common-ligatures;\n  font-family: var(--vscode-editor-font-family) !important;\n  word-wrap: break-word;\n  overflow: auto;\n  line-height: 1.5;\n  font-size: var(--me-font-size, var(--vscode-editor-font-size, 14px)) !important;\n  word-break: break-word;\n}',
    '.vditor-reset base font-family/font-size',
  )

  // 10. `.vditor-reset table` display (task 478 item 6). Vditor renders tables as
  // `display: block` (a scrollable block that ignores its cell widths); main.css used to
  // out-rank it with an identical-selector `display: table !important` that only won on
  // load order. Fix the rule at the source instead. `width: 100%` is already Vditor's own
  // (main.css's `!important` restatement was redundant) — only `display` changes here.
  css = replaceAnchored(
    css,
    '.vditor-reset table {\n  border-collapse: collapse;\n  empty-cells: show;\n  margin-bottom: 16px;\n  overflow: auto;\n  border-spacing: 0;\n  display: block;\n  word-break: keep-all;\n  width: 100%;\n}',
    '.vditor-reset table {\n  border-collapse: collapse;\n  empty-cells: show;\n  margin-bottom: 16px;\n  overflow: auto;\n  border-spacing: 0;\n  display: table;\n  word-break: keep-all;\n  width: 100%;\n}',
    '.vditor-reset table display',
  )

  // 11. `.vditor-reset table td/th` wrapping (task 478 item 6). Vditor renders cells
  // `white-space: nowrap` / `word-break: normal`, so long unbroken words blow the table
  // out; main.css used to out-rank both with an identical-selector override that only won
  // on load order. Fix the two values at the source. The rest of the old override
  // (`width/min-width/max-width: auto/0/none`, `overflow-wrap: anywhere`) never collided
  // with a Vditor declaration — it stays in main.css (ADR-0003: our own geometry).
  css = replaceAnchored(
    css,
    '.vditor-reset table td,\n.vditor-reset table th {\n  padding: 6px 13px;\n  border: 1px solid #dfe2e5;\n  word-break: normal;\n  white-space: nowrap;\n}',
    '.vditor-reset table td,\n.vditor-reset table th {\n  padding: 6px 13px;\n  border: 1px solid #dfe2e5;\n  word-break: break-word;\n  white-space: normal;\n}',
    '.vditor-reset table td/th word-break/white-space',
  )

  await fs.writeFile(file, css)
  console.log(
    '[index-css] WYSIWYG inline-code h-padding, .vditor-ir__link colour, pre>code hatch, ' +
      'tip-close position, outline width, link-ref-defs marker, ir/wysiwyg hr margin, ' +
      'base font-family/size, table display, td/th word-break/white-space → patched',
  )
}

// The vendored TeaVM PlantUML engine ships debug tracing: TeaVM compiled two `System.out.println` debug
// statements (in PlantUML's preprocessor token loop) to `console.log(...)`, and they fire ~2400× per C4
// render (once per processed stdlib line). In the real VS Code webview each call costs ~evaluate-arg +
// native-console → measured ~150 ms per C4 render (5-diagram cache spec: coldMs 8480 → 7735). We neutralise
// them by rewriting `console.log(EXPR)` → `void(EXPR)`: the argument is still evaluated (so the
// preprocessor's own side effects are untouched — verified: the surrounding Dj7 work is load-bearing, only
// the log is inert), just never printed. Applied to the MEDIA copy after the vendored sync so the pinned
// vendor bytes stay pristine (sha-gated); asserts the exact site count so an engine bump that changes the
// tracing fails the build loudly instead of silently shipping the slow (or wrongly-patched) engine (task 351).
async function patchPlantumlEngine() {
  const file = path.resolve('media/vditor/dist/js/plantuml/plantuml.js')
  let js = await fs.readFile(file, 'utf8')
  const sites = (js.match(/console\.log\(/g) || []).length
  if (sites !== 2) {
    throw new Error(
      `[plantuml] expected exactly 2 debug console.log( sites to neutralise, found ${sites} — engine changed; re-verify build.mjs patchPlantumlEngine`,
    )
  }
  js = js.split('console.log(').join('void(')
  await fs.writeFile(file, js)
  console.log(
    `[plantuml] neutralised ${sites} debug console.log( → void( (TeaVM System.out trace, ~150 ms/C4 render)`,
  )
}

// Task 530: keep a hard line break's source form (`␣␣` / `\`) in Lute's own output — see
// scripts/lute-blob-patch.mjs. MEDIA copy only; the vendored file and its pinned sha stay pristine.
async function patchLuteHardBreaks() {
  const file = path.resolve('media/vditor/dist/js/lute/lute.min.js')
  const src = await fs.readFile(file, 'utf8')
  const out = patchLuteBlob(src)
  if (out !== src) await fs.writeFile(file, out)
  console.log(
    `[lute] hard-break + loose-list patch ${out === src ? 'already applied' : `applied (${LUTE_HARD_BREAK_PATCHES.length + LUTE_LOOSE_LIST_PATCHES.length} anchors)`}`,
  )
}

const watch = process.argv.includes('watch')

await syncVditorAssets()
await varifyVditorPalette()
await patchContentThemeIrLink()
await patchVditorIndexCss()
await varifyVditorGeometry()
for (const entry of VENDORED_ASSETS) {
  await syncVendored(entry)
}
await patchPlantumlEngine()
await patchLuteHardBreaks()
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
