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
    'image-convert': path.join(__dirname, 'image-convert-harness.ts'),
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
const imageConvertHtml = fs.readFileSync(
  path.join(__dirname, 'image-convert.html'),
)

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
  if (url === '/image-convert.html') {
    res.setHeader('content-type', 'text/html')
    return res.end(imageConvertHtml)
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
  res.statusCode = 404
  res.end('not found')
})
server.listen(PORT, () => console.log(`harness on http://localhost:${PORT}`))
