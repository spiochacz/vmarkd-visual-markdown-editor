import * as esbuild from 'esbuild'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vditorSourceConfig } from '../esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mediaVditor = path.resolve(__dirname, '../../media/vditor')
const PORT = 9123

// Two harness bundles: `harness` (table-IR feature) and `behaviors`
// (message-contract + DOM-util coverage). Built in-memory with inline source
// maps so monocart can map V8 coverage back to the original TypeScript.
const built = await esbuild.build({
  entryPoints: {
    harness: path.join(__dirname, 'harness.ts'),
    behaviors: path.join(__dirname, 'behaviors-harness.ts'),
    bench: path.join(__dirname, 'bench-harness.ts'),
    outline: path.join(__dirname, 'outline-harness.ts'),
    prerender: path.join(__dirname, 'prerender-harness.ts'),
    link: path.join(__dirname, 'link-harness.ts'),
    list: path.join(__dirname, 'list-harness.ts'),
    math: path.join(__dirname, 'math-harness.ts'),
    'save-flush': path.join(__dirname, 'save-flush-harness.ts'),
    'incremental-md': path.join(__dirname, 'incremental-md-harness.ts'),
    'wysiwyg-input': path.join(__dirname, 'wysiwyg-input-harness.ts'),
    tab: path.join(__dirname, 'tab-harness.ts'),
    stream: path.join(__dirname, 'stream-harness.ts'),
    keybugs: path.join(__dirname, 'keybugs-harness.ts'),
    scrolljump: path.join(__dirname, 'scrolljump-harness.ts'),
    mermaid: path.join(__dirname, 'mermaid-harness.ts'),
    echarts: path.join(__dirname, 'echarts-harness.ts'),
    blockbg: path.join(__dirname, 'blockbg-harness.ts'),
    gap: path.join(__dirname, 'gap-harness.ts'),
    'callout-ir': path.join(__dirname, 'callout-ir-harness.ts'),
    callouts: path.join(__dirname, 'callouts-harness.ts'),
    'image-convert': path.join(__dirname, 'image-convert-harness.ts'),
    width: path.join(__dirname, 'width-harness.ts'),
    wiki: path.join(__dirname, 'wiki-harness.ts'),
    'split-scroll': path.join(__dirname, 'split-scroll-harness.ts'),
    'code-linenumber': path.join(__dirname, 'code-linenumber-harness.ts'),
    'config-apply': path.join(__dirname, 'config-apply-harness.ts'),
    marp: path.join(__dirname, 'marp-harness.ts'),
  },
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
  outdir: __dirname,
  // Harnesses import main.ts's modules → Vditor from source needs the same
  // define / class-fields / LESS / button-stub treatment as the prod build (task 20).
  ...vditorSourceConfig,
})
const bundles = Object.fromEntries(
  built.outputFiles.map((f) => ['/' + path.basename(f.path), f.text])
)

// The lazy Marp chunk (task 107). A SEPARATE plain-iife bundle (like prod's media/dist/marp.js),
// served at /marp-chunk.js and loaded on demand by marp-preview.ts via an injected <script>.
const marpChunk = await esbuild.build({
  entryPoints: { 'marp-chunk': path.join(__dirname, '../src/marp-entry.ts') },
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
  outdir: __dirname,
})
const marpChunkJs = marpChunk.outputFiles[0].text
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'))
const behaviorsHtml = fs.readFileSync(path.join(__dirname, 'behaviors.html'))
const benchHtml = fs.readFileSync(path.join(__dirname, 'bench.html'))
const outlineHtml = fs.readFileSync(path.join(__dirname, 'outline.html'))
const prerenderHtml = fs.readFileSync(path.join(__dirname, 'prerender.html'))
const linkHtml = fs.readFileSync(path.join(__dirname, 'link.html'))
const listHtml = fs.readFileSync(path.join(__dirname, 'list.html'))
const mathHtml = fs.readFileSync(path.join(__dirname, 'math.html'))
const saveFlushHtml = fs.readFileSync(path.join(__dirname, 'save-flush.html'))
const incrementalMdHtml = fs.readFileSync(
  path.join(__dirname, 'incremental-md.html'),
)
const wysiwygInputHtml = fs.readFileSync(
  path.join(__dirname, 'wysiwyg-input.html'),
)
const tabHtml = fs.readFileSync(path.join(__dirname, 'tab.html'))
const streamHtml = fs.readFileSync(path.join(__dirname, 'stream.html'))
const keybugsHtml = fs.readFileSync(path.join(__dirname, 'keybugs.html'))
const scrolljumpHtml = fs.readFileSync(path.join(__dirname, 'scrolljump.html'))
const mermaidHarnessHtml = fs.readFileSync(path.join(__dirname, 'mermaid.html'))
const echartsHarnessHtml = fs.readFileSync(path.join(__dirname, 'echarts.html'))
const blockbgHtml = fs.readFileSync(path.join(__dirname, 'blockbg.html'))
const gapHtml = fs.readFileSync(path.join(__dirname, 'gap.html'))
const calloutIrHtml = fs.readFileSync(path.join(__dirname, 'callout-ir.html'))
const calloutsHtml = fs.readFileSync(path.join(__dirname, 'callouts.html'))
const imageConvertHtml = fs.readFileSync(
  path.join(__dirname, 'image-convert.html'),
)
const widthHtml = fs.readFileSync(path.join(__dirname, 'width.html'))
const wikiHtml = fs.readFileSync(path.join(__dirname, 'wiki.html'))
const splitScrollHtml = fs.readFileSync(
  path.join(__dirname, 'split-scroll.html'),
)
const codeLineNumberHtml = fs.readFileSync(
  path.join(__dirname, 'code-linenumber.html'),
)
const configApplyHtml = fs.readFileSync(
  path.join(__dirname, 'config-apply.html'),
)
const marpHtml = fs.readFileSync(path.join(__dirname, 'marp.html'))

const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (url === '/' || url === '/index.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(indexHtml)
  }
  if (url === '/behaviors.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(behaviorsHtml)
  }
  if (url === '/bench.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(benchHtml)
  }
  if (url === '/outline.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(outlineHtml)
  }
  if (url === '/prerender.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(prerenderHtml)
  }
  if (url === '/link.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(linkHtml)
  }
  if (url === '/list.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(listHtml)
  }
  if (url === '/math.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(mathHtml)
  }
  if (url === '/save-flush.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(saveFlushHtml)
  }
  if (url === '/incremental-md.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(incrementalMdHtml)
  }
  if (url === '/wysiwyg-input.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(wysiwygInputHtml)
  }
  if (url === '/tab.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(tabHtml)
  }
  if (url === '/stream.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(streamHtml)
  }
  if (url === '/keybugs.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(keybugsHtml)
  }
  if (url === '/scrolljump.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(scrolljumpHtml)
  }
  if (url === '/mermaid.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(mermaidHarnessHtml)
  }
  if (url === '/echarts.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(echartsHarnessHtml)
  }
  if (url === '/blockbg.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(blockbgHtml)
  }
  if (url === '/gap.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(gapHtml)
  }
  if (url === '/callout-ir.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(calloutIrHtml)
  }
  if (url === '/callouts.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(calloutsHtml)
  }
  if (url === '/image-convert.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(imageConvertHtml)
  }
  if (url === '/width.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(widthHtml)
  }
  if (url === '/wiki.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(wikiHtml)
  }
  if (url === '/split-scroll.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(splitScrollHtml)
  }
  if (url === '/code-linenumber.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(codeLineNumberHtml)
  }
  if (url === '/config-apply.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(configApplyHtml)
  }
  if (url === '/marp.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(marpHtml)
  }
  if (url === '/marp-chunk.js') {
    res.setHeader('content-type', 'text/javascript')
    return res.end(marpChunkJs)
  }
  if (bundles[url]) {
    res.setHeader('content-type', 'text/javascript')
    return res.end(bundles[url])
  }
  if (url === '/main.css') {
    res.setHeader('content-type', 'text/css')
    return res.end(fs.readFileSync(path.join(__dirname, '../src/main.css')))
  }
  if (url.startsWith('/vditor/')) {
    const file = path.join(mediaVditor, url.slice('/vditor/'.length))
    if (file.startsWith(mediaVditor) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream')
      return res.end(fs.readFileSync(file))
    }
  }
  // The vendored content-theme stylesheets (task 82) — so e2e can exercise the real
  // <link disabled> toggle the extension uses, not just addStyleTag.
  if (url.startsWith('/markdown-themes/')) {
    const dir = path.join(__dirname, '../../media/markdown-themes')
    const file = path.join(dir, url.slice('/markdown-themes/'.length))
    if (
      file.startsWith(dir) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile()
    ) {
      res.setHeader('content-type', 'text/css')
      return res.end(fs.readFileSync(file))
    }
  }
  res.statusCode = 404
  res.end('not found')
})
server.listen(PORT, () => console.log(`harness on http://localhost:${PORT}`))
