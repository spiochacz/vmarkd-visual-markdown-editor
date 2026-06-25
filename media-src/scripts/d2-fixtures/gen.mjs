// Regenerates the d2-quality CI fixture (media-src/src/__fixtures__/d2-raw-layouts.json) from the .d2
// sources in ./sources, by running the REAL layoutElk through a headless browser (it needs the WASM + the
// vendored ELK, hence a browser, not pure node). Run this ONLY when layoutElk / the ELK config changes —
// the fixture is a frozen raw-ELK snapshot so the CI test stays deterministic and browser-free.
//
//   node build.mjs            # once, so media/vditor/ assets + WASM exist
//   node media-src/scripts/d2-fixtures/gen.mjs
//
// Then re-run `npm test` and update EXPECT in d2-quality.test.ts if any crossing count legitimately moved.
// (Promoted from tmp/d2-compare/dump-layouts.mjs into the repo so the fixture is reproducible on a clean
// checkout — task 123.)
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..') // media-src/scripts/d2-fixtures → repo root
const MED = join(REPO, 'media-src')
const require = createRequire(join(MED, 'package.json'))
const esbuild = require('esbuild')
const { chromium } = require('playwright')

const VDITOR = join(REPO, 'media', 'vditor')
const SOURCES = join(HERE, 'sources')
const OUT = join(MED, 'src', '__fixtures__', 'd2-raw-layouts.json')
const IDS = ['microservices', 'dataplatform', 'oauth', 'netmesh']

const built = await esbuild.build({
  entryPoints: [join(HERE, 'gen.entry.ts')],
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
})
const html = `<!doctype html><meta charset=utf8><body><div id=app></div><script>${built.outputFiles[0].text}</script>`
const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' }
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0])
  if (p === '/' || p === '/index.html') {
    rs.writeHead(200, { 'Content-Type': 'text/html' })
    return rs.end(html)
  }
  if (p.startsWith('/vditor/')) {
    try {
      const fp = join(VDITOR, p.slice('/vditor/'.length))
      rs.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' })
      return rs.end(readFileSync(fp))
    } catch {
      rs.writeHead(404)
      return rs.end('nf')
    }
  }
  rs.writeHead(404)
  rs.end('nf')
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForFunction('window.__ready===true', { timeout: 20000 })

const out = {}
for (const id of IDS) {
  const src = readFileSync(join(SOURCES, `${id}.d2`), 'utf8')
  const r = await page.evaluate(async (s) => await window.__dumpLayout(s), src)
  if (r.error) {
    console.log(id, 'ERR', r.error)
    continue
  }
  out[id] = r
  console.log(`${id}: nodes=${r.nodes.length} edges=${r.edges.length} W=${r.W} H=${r.H}`)
}
writeFileSync(OUT, JSON.stringify(out))
console.log('wrote', OUT, `(${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
await browser.close()
server.close()
