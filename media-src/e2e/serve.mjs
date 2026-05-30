import * as esbuild from 'esbuild'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mediaVditor = path.resolve(__dirname, '../../media/vditor')
const PORT = 9123

const built = await esbuild.build({
  entryPoints: [path.join(__dirname, 'harness.ts')],
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
})
const harnessJs = built.outputFiles[0].text
const html = fs.readFileSync(path.join(__dirname, 'index.html'))

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
    return res.end(html)
  }
  if (url === '/harness.js') {
    res.setHeader('content-type', 'text/javascript')
    return res.end(harnessJs)
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
