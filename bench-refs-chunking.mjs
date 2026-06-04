// Correctness + perf validator for the SHIPPED chunked render (task 49, approach B,
// media-src/src/stream-chunk.ts + stream-render.ts). Mirrors the shipped algorithm:
// chunk on block boundaries; per chunk inject only the EXTERNAL defs it cites; after
// render remove exactly those injected def blocks BY LABEL (Lute gives each link def
// its own link-ref-defs-block and never coalesces, so the chunk's own in-place defs
// survive). Target: assembled IR DOM === monolithic Md2VditorIRDOM(fullDoc), byte for
// byte — same getValue(), no save corruption — at a small cap (many boundaries) and
// at the production 4 KB cap on a large ref-heavy doc.
//
// Loads Lute via `vm` exactly like src/lute-host.ts.  Run:  node bench-refs-chunking.mjs

import * as fs from 'node:fs'
import * as vm from 'node:vm'
import { performance } from 'node:perf_hooks'

const src = fs.readFileSync('media/vditor/dist/js/lute/lute.min.js', 'utf8')
const sb = {
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console,
}
vm.createContext(sb)
vm.runInContext(src, sb, { filename: 'lute.min.js' })
const lute = sb.Lute.New()

// --- pure logic, kept in lockstep with media-src/src/stream-chunk.ts ---
function chunkize(md, CAP) {
  const chunks = []
  let rest = md
  while (rest.length > CAP) {
    let s = rest.slice(0, CAP)
    const blank = s.lastIndexOf('\n\n')
    if (blank >= CAP / 2) s = s.slice(0, blank)
    else {
      const nl = s.lastIndexOf('\n')
      if (nl > 0) s = s.slice(0, nl)
    }
    const f = [...s.matchAll(/^```/gm)]
    if (f.length % 2 === 1) s = s.slice(0, f[f.length - 1].index)
    if (!s.length) s = rest.slice(0, CAP)
    chunks.push(s)
    rest = rest.slice(s.length)
  }
  if (rest.length) chunks.push(rest)
  return chunks
}
const RE_FN_DEF = /^\s{0,3}\[\^([^\]]+)\]:/
const RE_LINK_DEF = /^\s{0,3}\[([^\]^][^\]]*)\]:\s*\S/
const norm = (l) => l.trim().toLowerCase().replace(/\s+/g, ' ')
function buildDefMap(md) {
  const lines = md.split('\n')
  const map = new Map()
  for (let i = 0; i < lines.length; i++) {
    let m = lines[i].match(RE_FN_DEF)
    if (m) {
      let def = lines[i]
      let j = i + 1
      while (j < lines.length && /^(\s{4,}|\t)/.test(lines[j])) {
        def += '\n' + lines[j]
        j++
      }
      map.set('^' + norm(m[1]), def)
      i = j - 1
      continue
    }
    m = lines[i].match(RE_LINK_DEF)
    if (m) map.set(norm(m[1]), lines[i])
  }
  return map
}
function definedIn(chunk) {
  const s = new Set()
  for (const line of chunk.split('\n')) {
    let m = line.match(RE_FN_DEF)
    if (m) {
      s.add('^' + norm(m[1]))
      continue
    }
    m = line.match(RE_LINK_DEF)
    if (m) s.add(norm(m[1]))
  }
  return s
}
function usedIn(chunk) {
  const s = new Set()
  for (const m of chunk.matchAll(/\]\[([^\]]+)\]/g)) s.add(norm(m[1]))
  for (const m of chunk.matchAll(/\[([^\]^][^\]]*)\]\[\]/g)) s.add(norm(m[1]))
  for (const m of chunk.matchAll(/\[\^([^\]]+)\]/g)) s.add('^' + norm(m[1]))
  return s
}

// by-label string strip equivalent to the DOM surgery in stream-render.ts
const RE_LINKDEF_BLOCK =
  /<div data-block="0" data-type="link-ref-defs-block">([\s\S]*?)<\/div>/g
function stripInjected(html, injLink, injFn) {
  html = html.replace(RE_LINKDEF_BLOCK, (full, inner) => {
    const m = inner.match(/^\s*\[([^\]^][^\]]*)\]:/)
    return m && injLink.has(norm(m[1])) ? '' : full
  })
  if (injFn.size) {
    html = html.replace(
      /<div data-block="0" data-type="footnotes-block">([\s\S]*?)<\/div><\/div>/g,
      (_full, inner) => {
        let kept = ''
        for (const p of inner.split(/(?=<div data-type="footnotes-def">)/)) {
          const lm = p.match(/\[\^([^\]]+)\]:/)
          if (lm && injFn.has('^' + norm(lm[1]))) continue
          kept += p
        }
        return kept.trim()
          ? `<div data-block="0" data-type="footnotes-block">${kept}</div></div>`
          : ''
      },
    )
  }
  return html
}
function renderChunk(chunk, defMap) {
  const used = usedIn(chunk),
    have = definedIn(chunk)
  const injLink = new Set(),
    injFn = new Set()
  let inject = ''
  for (const lbl of used) {
    if (have.has(lbl) || !defMap.has(lbl)) continue
    inject += defMap.get(lbl) + '\n'
    if (lbl.startsWith('^')) injFn.add(lbl)
    else injLink.add(lbl)
  }
  if (!inject) return lute.Md2VditorIRDOM(chunk)
  return stripInjected(
    lute.Md2VditorIRDOM(chunk + '\n\n' + inject),
    injLink,
    injFn,
  )
}
function assemble(md, CAP) {
  const defMap = buildDefMap(md)
  let out = ''
  for (const c of chunkize(md, CAP)) out += renderChunk(c, defMap)
  return out
}

const resolved = (h) =>
  (h.match(/data-type="link-ref"/g) || []).length +
  (h.match(/data-type="footnotes-ref"/g) || []).length
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// --- 1) exact-match torture: refs/footnotes split across many boundaries (small cap) ---
const torture = `Intro references [forward link][fwd] defined much later in the document body.

Some prose to push across a chunk boundary and exercise inline parsing nicely here.

[inline]: https://example.com/inline-def-midway

Paragraph right after a mid-doc definition that also uses [the inline one][inline].

A footnote here[^note1] and another[^note2] within the same block of prose text.

More filler prose to force several boundaries between refs and their definitions.

A [collapsed][] style ref near the end of the content area before the defs.

[collapsed]: https://example.com/collapsed
[fwd]: https://example.com/forward-def-at-the-end
[^note1]: First footnote body.
[^note2]: Second footnote body.
`
{
  const mono = lute.Md2VditorIRDOM(torture)
  const asm = assemble(torture, 200)
  console.log('\n[torture, cap=200]')
  console.log('  resolved mono/asm   :', resolved(mono), '/', resolved(asm))
  console.log('  EXACT DOM match     :', mono === asm)
  console.log(
    '  round-trip MD match :',
    lute.VditorIRDOM2Md(mono) === lute.VditorIRDOM2Md(asm),
  )
  if (mono !== asm) {
    let i = 0
    while (i < mono.length && mono[i] === asm[i]) i++
    console.log(
      '  first divergence @',
      i,
      '\n  MONO',
      JSON.stringify(mono.slice(i - 40, i + 90)),
      '\n  ASM ',
      JSON.stringify(asm.slice(i - 40, i + 90)),
    )
  }
}

// --- 2) production cap on a large ref-heavy doc: exact match + perf ---
{
  const N = 250
  let body = ''
  for (let i = 0; i < N; i++)
    body += `Paragraph ${i} cites [external ${i}][ref${i}] and notes something[^fn${i}] inline with filler prose to add size.\n\n`
  let defs = ''
  for (let i = 0; i < N; i++)
    defs += `[ref${i}]: https://example.com/page/${i}\n`
  for (let i = 0; i < N; i++) defs += `[^fn${i}]: Footnote body ${i}.\n`
  const doc = body + '\n' + defs
  for (let i = 0; i < 3; i++) lute.Md2VditorIRDOM('# warm\n\ntext')

  const monoRuns = [],
    asmRuns = []
  let mono, asm
  for (let r = 0; r < 5; r++) {
    const t = performance.now()
    mono = lute.Md2VditorIRDOM(doc)
    monoRuns.push(performance.now() - t)
  }
  for (let r = 0; r < 5; r++) {
    const t = performance.now()
    asm = assemble(doc, 4000)
    asmRuns.push(performance.now() - t)
  }
  const mMono = median(monoRuns),
    mAsm = median(asmRuns)
  console.log(
    `\n[large ${(doc.length / 1024).toFixed(0)}KB, ${N * 2} refs, cap=4000]`,
  )
  console.log(
    '  resolved mono/asm   :',
    resolved(mono),
    '/',
    resolved(asm),
    `(expected ${N * 2})`,
  )
  console.log('  EXACT DOM match     :', mono === asm)
  console.log(
    '  round-trip MD match :',
    lute.VditorIRDOM2Md(mono) === lute.VditorIRDOM2Md(asm),
  )
  console.log(
    `  time mono / asm     : ${mMono.toFixed(1)}ms / ${mAsm.toFixed(1)}ms (${(mMono / mAsm).toFixed(2)}x)`,
  )
  console.log(
    '  (asm is total CPU summed over chunks; the editor never blocks on it — it yields per frame)',
  )
}
console.log('')
