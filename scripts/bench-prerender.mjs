// Host-side prerender benchmark (perf metrics for the instant-paint overlay).
//
// The prerender runs SYNCHRONOUSLY on the extension-host thread via Lute's
// Md2VditorIRDOM (see src/lute-host.ts). It currently renders only a ~4 KB prefix
// (MAX_PRERENDER_CHARS) to keep that blocking cost small. This script measures the
// render cost vs document size for representative content so we can decide whether
// to raise the cap (render the whole doc up to size X).
//
// Run: node scripts/bench-prerender.mjs
//
// It loads the SAME Lute build the extension ships, in an isolated vm (mirrors
// loadLute in src/lute-host.ts), and reports median render time + output HTML size.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LUTE_REL = 'media/vditor/dist/js/lute/lute.min.js'

function loadLute() {
  const src = fs.readFileSync(path.join(ROOT, LUTE_REL), 'utf8')
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
  const lute = sandbox.Lute.New()
  lute.Md2VditorIRDOM('# warmup\n\ntext') // warm the JIT
  return lute
}

// ---- representative document generators (target ≈ `chars` source bytes) ----

const PARA =
  'Paragraph filler text long enough to occupy a line or two so the document grows tall and there is realistic inline content to parse and render. '

function makeProse(chars) {
  let s = '# Document Title\n\n'
  let i = 0
  while (s.length < chars) {
    s += `## Section ${i}\n\n${PARA}${PARA}\n\nSome **bold**, _italic_, \`code\` and a [link](https://example.com).\n\n`
    i++
  }
  return s.slice(0, chars)
}

function makeTables(chars) {
  let s = '# Tables\n\n'
  let i = 0
  while (s.length < chars) {
    s += `## Table ${i}\n\n| Col A | Col B | Col C | Col D |\n| --- | --- | --- | --- |\n`
    for (let r = 0; r < 12; r++)
      s += `| cell ${r}a | cell ${r}b | cell ${r}c | cell ${r}d |\n`
    s += '\n'
    i++
  }
  return s.slice(0, chars)
}

function makeMixed(chars) {
  let s = '# Mixed Document\n\n'
  let i = 0
  while (s.length < chars) {
    s += `## Section ${i}\n\n${PARA}\n\n`
    s += `- list item one\n- list item two\n- list item three\n\n`
    s += '```js\nconst x = 1\nfunction f(a) { return a + x }\n```\n\n'
    s += `| K | V |\n| - | - |\n| a | 1 |\n| b | 2 |\n\n`
    s += `> a blockquote with [[Wiki Link]] and [[Other|label]].\n\n`
    i++
  }
  return s.slice(0, chars)
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function bench(lute, md, runs = 9) {
  // discard a cold run, then time `runs` warm renders
  lute.Md2VditorIRDOM(md)
  const times = []
  let outLen = 0
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const html = lute.Md2VditorIRDOM(md)
    times.push(performance.now() - t0)
    outLen = html.length
  }
  return { ms: median(times), outLen }
}

const lute = loadLute()

const SIZES = [4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000]
const KINDS = [
  ['prose', makeProse],
  ['tables', makeTables],
  ['mixed', makeMixed],
]

console.log(
  `\nHost prerender render cost — median of 9 warm runs (Node ${process.version})\n`,
)
console.log(
  'kind    | src KB | render ms | overlay KB | ms/KB',
)
console.log('--------|--------|-----------|------------|------')
for (const [name, gen] of KINDS) {
  for (const size of SIZES) {
    const md = gen(size)
    const { ms, outLen } = bench(lute, md)
    const srcKB = (md.length / 1024).toFixed(0)
    const outKB = (outLen / 1024).toFixed(0)
    const msPerKB = (ms / (md.length / 1024)).toFixed(2)
    console.log(
      `${name.padEnd(7)} | ${srcKB.padStart(6)} | ${ms.toFixed(1).padStart(9)} | ${outKB.padStart(10)} | ${msPerKB.padStart(5)}`,
    )
  }
  console.log('--------|--------|-----------|------------|------')
}
