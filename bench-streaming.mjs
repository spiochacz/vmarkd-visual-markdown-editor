// Streaming/incremental render feasibility benchmark.
//
// Question: is chunked rendering (split markdown into ~4KB block-boundary chunks,
// render each via Md2VditorIRDOM, append) faster / more responsive than ONE
// monolithic Md2VditorIRDOM(fullDoc) call (the current ~10s blocking path)?
//
// Measures, per document:
//   • monolithic: time of a single Md2VditorIRDOM(fullDoc)        (current path)
//   • chunked:    sum of Md2VditorIRDOM(chunk) over all chunks    (CPU total)
//                 + worst single chunk (the worst frame block)    (responsiveness)
//                 + chunk count
//   • HTML bytes: monolithic output size vs sum of chunk outputs  (A's IPC payload)
//   • cold vs warm first call
//
// Loads Lute exactly like src/lute-host.ts (vm sandbox), so numbers map to the host
// render path. The webview path (B) uses the same GopherJS in a different V8 — same
// algorithm, so relative chunk-vs-monolith behaviour transfers.
//
// Run:  node bench-streaming.mjs

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { performance } from 'node:perf_hooks'

const LUTE_REL = 'media/vditor/dist/js/lute/lute.min.js'
const MAX_PRERENDER_CHARS = 4_000 // same cap the host uses
const MEDIAN_RUNS = 5

function loadLute() {
  const src = fs.readFileSync(path.join(process.cwd(), LUTE_REL), 'utf8')
  const sandbox = {
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'lute.min.js' })
  const Lute = sandbox.Lute
  if (!Lute || typeof Lute.New !== 'function')
    throw new Error('Lute load failed')
  return Lute.New()
}

// Split markdown into successive ~MAX_PRERENDER_CHARS chunks, each cut on a block
// boundary (blank line preferred, newline fallback), dropping a dangling unterminated
// ``` fence — the same boundary logic as src/lute-host.ts prerenderPrefix, applied
// repeatedly to walk the whole document.
function chunkize(markdown) {
  const chunks = []
  let rest = markdown
  while (rest.length > MAX_PRERENDER_CHARS) {
    let slice = rest.slice(0, MAX_PRERENDER_CHARS)
    const blank = slice.lastIndexOf('\n\n')
    if (blank >= MAX_PRERENDER_CHARS / 2) {
      slice = slice.slice(0, blank)
    } else {
      const nl = slice.lastIndexOf('\n')
      if (nl > 0) slice = slice.slice(0, nl)
    }
    const fences = [...slice.matchAll(/^```/gm)]
    if (fences.length % 2 === 1) {
      slice = slice.slice(0, fences[fences.length - 1].index)
    }
    if (slice.length === 0) slice = rest.slice(0, MAX_PRERENDER_CHARS) // safety
    chunks.push(slice)
    rest = rest.slice(slice.length)
  }
  if (rest.length) chunks.push(rest)
  return chunks
}

// ---- synthetic documents (mirrors media-src/e2e/bench-harness.ts makeDoc) ----
function repeat(s, n) {
  let o = ''
  for (let i = 0; i < n; i++) o += s
  return o
}

function prose(targetKB) {
  const para =
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua\n\n'
  return repeat(para, Math.ceil((targetKB * 1024) / para.length))
}
function tables(targetKB) {
  const t =
    '| col a | col b | col c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n'
  return repeat(t, Math.ceil((targetKB * 1024) / t.length))
}
function mixed(targetKB) {
  let block = ''
  block +=
    '## Section heading with some words\n\nParagraph of prose text that goes on for a little while to fill space and exercise inline parsing.\n\n'
  block += '```js\nfunction f(x) { return x * 2 }\nconst y = f(21)\n```\n\n'
  block +=
    '| a | b |\n| - | - |\n| 1 | 2 |\n\n- bullet one\n- bullet two\n- bullet three\n\n'
  return repeat(block, Math.ceil((targetKB * 1024) / block.length))
}
// Document with link-reference definitions used across far-apart blocks — the
// cross-block-context correctness hazard for chunked rendering.
function refsDoc(targetKB) {
  let head = ''
  for (let i = 0; i < 200; i++)
    head += `Paragraph ${i} references [link ${i}][ref${i}] inline.\n\n`
  let defs = ''
  for (let i = 0; i < 200; i++) defs += `[ref${i}]: https://example.com/${i}\n`
  let body = head + '\n' + defs + '\n'
  while (body.length < targetKB * 1024) body = head + body
  return body
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const lute = loadLute()

// ---- cold first call (JIT not warm) ----
const coldDoc = prose(50)
const t0 = performance.now()
lute.Md2VditorIRDOM(coldDoc)
const coldMs = performance.now() - t0

// warm the JIT
for (let i = 0; i < 3; i++) lute.Md2VditorIRDOM('# warm\n\ntext\n\nmore')

console.log('')
console.log(`cold first Md2VditorIRDOM (50KB prose): ${coldMs.toFixed(1)} ms`)
console.log(
  `(warm runs below; median of ${MEDIAN_RUNS}, chunk cap ${MAX_PRERENDER_CHARS} chars)`,
)
console.log('')

const docs = [
  ['prose 50KB', prose(50)],
  ['prose 100KB', prose(100)],
  ['prose 195KB', prose(195)],
  ['prose 400KB', prose(400)],
  ['tables 50KB', tables(50)],
  ['tables 100KB', tables(100)],
  ['tables 195KB', tables(195)],
  ['mixed 100KB', mixed(100)],
  ['mixed 195KB', mixed(195)],
  ['refs 100KB', refsDoc(100)],
]

const hdr = [
  'document',
  'size',
  'mono(ms)',
  'chunked Σ(ms)',
  'speedup',
  'worst chunk(ms)',
  '#chunks',
  'mono HTML',
  'chunk HTML Σ',
]
console.log(
  hdr.map((h, i) => h.padEnd([14, 7, 9, 13, 8, 15, 8, 10, 12][i])).join(''),
)
console.log('-'.repeat(110))

for (const [name, md] of docs) {
  // monolithic — median
  const monoRuns = []
  let monoHtml = ''
  for (let i = 0; i < MEDIAN_RUNS; i++) {
    const t = performance.now()
    monoHtml = lute.Md2VditorIRDOM(md)
    monoRuns.push(performance.now() - t)
  }
  const mono = median(monoRuns)

  // chunked — median of (sum over chunks); track worst single chunk + total HTML
  const chunks = chunkize(md)
  const sumRuns = []
  let worst = 0
  let chunkHtmlBytes = 0
  for (let r = 0; r < MEDIAN_RUNS; r++) {
    let sum = 0
    let localWorst = 0
    let bytes = 0
    for (const c of chunks) {
      const t = performance.now()
      const out = lute.Md2VditorIRDOM(c)
      const dt = performance.now() - t
      sum += dt
      if (dt > localWorst) localWorst = dt
      if (r === 0) bytes += Buffer.byteLength(out, 'utf8')
    }
    sumRuns.push(sum)
    if (localWorst > worst) worst = localWorst
    if (r === 0) chunkHtmlBytes = bytes
  }
  const chunkedSum = median(sumRuns)
  const monoBytes = Buffer.byteLength(monoHtml, 'utf8')

  const row = [
    name.padEnd(14),
    `${(md.length / 1024).toFixed(0)}KB`.padEnd(7),
    mono.toFixed(1).padEnd(9),
    chunkedSum.toFixed(1).padEnd(13),
    `${(mono / chunkedSum).toFixed(2)}x`.padEnd(8),
    worst.toFixed(1).padEnd(15),
    String(chunks.length).padEnd(8),
    `${(monoBytes / 1024).toFixed(0)}KB`.padEnd(10),
    `${(chunkHtmlBytes / 1024).toFixed(0)}KB`.padEnd(12),
  ]
  console.log(row.join(''))
}
console.log('')
console.log(
  'Legend: mono = current single Md2VditorIRDOM(fullDoc). chunked Σ = total CPU summed',
)
console.log(
  'over all chunks. worst chunk = the biggest single-chunk render (the worst frame the',
)
console.log(
  'webview would block for). mono HTML / chunk HTML Σ = bytes (A streams chunk HTML over IPC).',
)
