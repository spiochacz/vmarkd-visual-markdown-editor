import * as esbuild from 'esbuild'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vditorSourceConfig } from '../esbuild-shared.mjs'
import { HARNESS_ENTRIES } from './harness-entries.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mediaVditor = path.resolve(__dirname, '../../media/vditor')
// Default 9123 = the e2e webServer (playwright.config: reuseExistingServer false, so a
// stray server on 9123 fails `playwright test`). Interactive/visual-debug sessions run a
// SECOND instance on another port via `npm run harness:serve` (PORT=9124) so tests and a
// live playwright-cli session never fight over the socket.
const PORT = Number(process.env.PORT) || 9123

// All harness bundles come from the shared registry (harness-entries.mjs) so the
// esbuild entryPoints, the HTML routes below, and the coverage allowlist can no
// longer drift (task 150 item 2). Built in-memory with inline source maps so
// monocart can map V8 coverage back to the original TypeScript.
const built = await esbuild.build({
  entryPoints: Object.fromEntries(
    HARNESS_ENTRIES.map((e) => [e.key, path.join(__dirname, e.ts)]),
  ),
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
// HTML page bodies served per route, derived from the registry (task 150 item 2)
// so the route table can't drift from the esbuild entryPoints / coverage allowlist.
const htmlByRoute = {}
for (const e of HARNESS_ENTRIES) {
  const body = fs.readFileSync(path.join(__dirname, e.html))
  for (const route of e.routes) htmlByRoute[route] = body
}

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
  // Serve any registered harness page (task 150 item 2 — one lookup, was ~31 ifs).
  const html = htmlByRoute[url]
  if (html) {
    res.setHeader('content-type', 'text/html')
    return res.end(html)
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
