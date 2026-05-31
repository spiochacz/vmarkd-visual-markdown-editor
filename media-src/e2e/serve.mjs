import * as esbuild from 'esbuild'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  },
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
  outdir: __dirname,
})
const bundles = Object.fromEntries(
  built.outputFiles.map((f) => ['/' + path.basename(f.path), f.text])
)
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'))
const behaviorsHtml = fs.readFileSync(path.join(__dirname, 'behaviors.html'))
const benchHtml = fs.readFileSync(path.join(__dirname, 'bench.html'))
const outlineHtml = fs.readFileSync(path.join(__dirname, 'outline.html'))

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
