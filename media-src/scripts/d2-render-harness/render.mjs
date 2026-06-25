// D2 render harness — render .d2 sources through dagre / raw ELK / vmarkd (or all three side by side)
// to a PNG grid or a self-contained HTML page. This is the by-eye verification tool for D2 layout +
// feature work (the user steers D2 layout/routing visually). It needs the WASM compiler + the vendored
// ELK, so it drives a headless browser rather than running in pure node.
//
//   node build.mjs                                              # once, so media/vditor assets + WASM exist
//   node media-src/scripts/d2-render-harness/render.mjs         # all fixture sources, vmarkd → tmp/d2-render.png
//   node .../render.mjs --engine all                            # every fixture source × all 3 engines (compare)
//   node .../render.mjs --engine all path/to/foo.d2             # one source, all engines, side by side
//   node .../render.mjs --out out.html path/to/*.d2             # self-contained zoomable HTML (no server)
//
// With no .d2 paths it renders the tracked d2-fixtures sources. Engines: dagre (bundled hierarchical),
// elk (raw Eclipse Layout Kernel), vmarkd (ELK + refinement, the shipped default). Promoted from
// tmp/d2-batch + tmp/d2-compare so the next D2 task doesn't rebuild it from scratch.
import { createServer } from 'node:http'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..') // media-src/scripts/d2-render-harness → repo root
const MED = join(REPO, 'media-src')
const require = createRequire(join(MED, 'package.json'))
const esbuild = require('esbuild')
const { chromium } = require('playwright')
const VDITOR = join(REPO, 'media', 'vditor')
const FIXTURE_SOURCES = join(MED, 'scripts', 'd2-fixtures', 'sources')

// --- args ---
const argv = process.argv.slice(2)
let engine = 'vmarkd'
let out = join(REPO, 'tmp', 'd2-render.png')
let scale = 460
const files = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--engine') engine = argv[++i]
  else if (a === '--out') out = argv[++i]
  else if (a === '--scale') scale = Number(argv[++i])
  else files.push(a)
}
const ENGINES = engine === 'all' ? ['dagre', 'elk', 'vmarkd'] : [engine]
// default to every tracked fixture source when none are passed
const paths = files.length
  ? files
  : readdirSync(FIXTURE_SOURCES)
      .filter((f) => f.endsWith('.d2'))
      .map((f) => join(FIXTURE_SOURCES, f))
const sources = paths.map((p) => ({
  name: basename(p).replace(/\.d2$/, ''),
  src: readFileSync(p, 'utf8'),
}))

// --- bundle the browser entry + serve it with the real /vditor assets ---
const built = await esbuild.build({
  entryPoints: [join(HERE, 'render.entry.ts')],
  bundle: true,
  format: 'iife',
  sourcemap: 'inline',
  write: false,
})
const pageHtml = `<!doctype html><meta charset=utf8><body><div id=app></div><script>${built.outputFiles[0].text}</script>`
const MIME = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
}
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0])
  if (p === '/' || p === '/index.html') {
    rs.writeHead(200, { 'Content-Type': 'text/html' })
    return rs.end(pageHtml)
  }
  if (p.startsWith('/vditor/')) {
    try {
      const fp = join(VDITOR, p.slice('/vditor/'.length))
      rs.writeHead(200, {
        'Content-Type': MIME[extname(fp)] || 'application/octet-stream',
      })
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

// --- render each source × engine into a grid (rows = sources, cols = engines) ---
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const rows = []
for (const { name, src } of sources) {
  const cells = []
  for (const eng of ENGINES) {
    const r = await page.evaluate(
      async ([s, e]) => await window.__render(s, e),
      [src, eng],
    )
    const label = `${name} — ${eng}`
    if (r.error) {
      console.log(`${name}/${eng}: ERR ${r.error}`)
      cells.push(
        `<td class=c><div class=lbl>${esc(label)}</div><div class=err>${esc(r.error)}</div></td>`,
      )
    } else {
      console.log(
        `${name}/${eng}: ${r.svg ? `ok (${r.svg.length}b)` : 'null'}${r.unsupported ? ` [unsupported:${r.unsupported}]` : ''}`,
      )
      cells.push(
        `<td class=c><div class=lbl>${esc(label)}</div><div class=svg>${r.svg || '<i>null</i>'}</div></td>`,
      )
    }
  }
  rows.push(`<tr>${cells.join('')}</tr>`)
}

const doc = `<!doctype html><html><meta charset=utf8><title>vMarkd D2 render harness</title><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif;padding:12px}
table{border-collapse:collapse} td.c{border:1px solid #ddd;padding:8px;vertical-align:top}
.lbl{font-size:12px;font-weight:600;color:#333;margin-bottom:6px}
.svg svg{max-width:${scale}px;height:auto;display:block}
.err{color:#b00;font-size:12px;max-width:${scale}px}
</style><table>${rows.join('\n')}</table></html>`

if (out.endsWith('.html')) {
  writeFileSync(out, doc)
  console.log('wrote', out)
} else {
  await page.setContent(doc)
  await page.waitForTimeout(300)
  await page.locator('table').screenshot({ path: out })
  console.log('wrote', out)
}
await browser.close()
server.close()
