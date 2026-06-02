// Host-side Lute pre-render (perf: warm-open masking).
//
// The webview's first content paint is gated on loading + running the 3.8 MB
// GopherJS Lute runtime ($init ≈150 ms) IN EVERY new webview realm — measured as
// the dominant cost of opening a fresh file. We can't shrink that per-realm cost
// (it's the Go runtime bootstrap, not the markdown work — rendering itself is
// ~1 ms warm), but the extension host is a SINGLE long-lived Node process, so we
// can pay the Lute $init there exactly ONCE and reuse it.
//
// On open, the host renders the document to Vditor's IR DOM (the same
// `Md2VditorIRDOM` the webview's Lute would call — byte-identical output) and
// inlines it as a static, read-only overlay in the initial HTML. That paints
// during HTML parse, before main.js even runs; the live Vditor builds underneath
// and the overlay is removed once it's ready (see media-src/src/main.ts). Because
// both renders come from the same Lute, the swap is visually seamless.
//
// Loaded in an isolated `vm` context so the GopherJS blob never pollutes the
// shared extension-host global (`global.Lute` stays undefined elsewhere).

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'

const LUTE_REL = 'media/vditor/dist/js/lute/lute.min.js'

// Hard cap on how much markdown we pre-render. renderIR runs SYNCHRONOUSLY on the
// extension-host thread, and Lute's render time grows super-linearly: ~150 ms at
// 12 KB but seconds for large docs (a 189 KB table-heavy file measured ~26 s),
// which would freeze the whole host and stall the webview open. So we never feed
// Lute more than this many chars: a small doc renders whole; a LONG doc renders
// only a clean prefix (~the first viewport, see prerenderPrefix) for the overlay,
// while the live editor loads the FULL document underneath and swaps in. Either
// way the host render is bounded to the same small, safe budget.
const MAX_PRERENDER_CHARS = 12_000

export type EditorMode = 'ir' | 'wysiwyg' | 'sv'

let lute:
  | { Md2VditorIRDOM(md: string): string; Md2VditorDOM(md: string): string }
  | undefined
let loadFailed = false

// Synchronously load + $init Lute in a sandboxed context. ~250 ms of host CPU,
// once per session. Only the few globals the GopherJS scheduler needs are
// exposed; no filesystem, no host global leakage.
function loadLute(extensionFsPath: string): typeof lute {
  if (lute || loadFailed) return lute
  try {
    const src = fs.readFileSync(path.join(extensionFsPath, LUTE_REL), 'utf8')
    const sandbox: Record<string, unknown> = {
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
    const Lute = (sandbox as { Lute?: { New(): typeof lute } }).Lute
    if (!Lute || typeof Lute.New !== 'function') {
      loadFailed = true
      return undefined
    }
    const instance = Lute.New()
    if (!instance) {
      loadFailed = true
      return undefined
    }
    lute = instance
    // Warm the JIT once so the first real render isn't cold (the cold first call
    // is markedly slower). Best-effort.
    try {
      instance.Md2VditorIRDOM('# warmup\n\ntext')
    } catch {}
    return lute
  } catch {
    loadFailed = true
    return undefined
  }
}

// Kick off the (blocking) load off the activation critical path. Safe to call
// repeatedly — it no-ops once loaded or once it has permanently failed.
export function prewarmLute(extensionFsPath: string): void {
  if (lute || loadFailed) return
  setTimeout(() => loadLute(extensionFsPath), 0)
}

// For a document over the cap, pre-render only a clean leading slice so even long
// files get an instant top-of-document paint (toolbar + first screen) without
// feeding Lute the whole doc. The live editor still renders the FULL document and
// swaps the overlay out, so the truncation is invisible — it only needs to look
// right for the first screen. Cut on a block boundary (blank line, else newline)
// so we emit whole blocks, and drop a dangling unterminated ``` fence so the tail
// of the slice doesn't get swallowed as code. Docs within the cap pass through
// unchanged. Exported for unit tests.
export function prerenderPrefix(markdown: string): string {
  if (markdown.length <= MAX_PRERENDER_CHARS) return markdown
  let slice = markdown.slice(0, MAX_PRERENDER_CHARS)
  const blank = slice.lastIndexOf('\n\n')
  if (blank >= MAX_PRERENDER_CHARS / 2) {
    slice = slice.slice(0, blank)
  } else {
    const nl = slice.lastIndexOf('\n')
    if (nl > 0) slice = slice.slice(0, nl)
  }
  // Odd number of fence lines → the last code block is unterminated; cut from the
  // start of that last ``` line so it can't turn the rest of the overlay into one
  // code block. Count and cut use the SAME matcher (a ``` at line start, offset 0
  // included) so a doc that opens with an unterminated fence is handled too.
  const fences = [...slice.matchAll(/^```/gm)]
  if (fences.length % 2 === 1) {
    slice = slice.slice(0, fences[fences.length - 1].index)
  }
  return slice
}

// Render markdown → IR DOM for the instant paint. Returns undefined (caller
// falls back to the normal webview render, no regression) when Lute isn't warm
// yet — we never block HTML generation on the 250 ms load; we only kick a
// prewarm so the NEXT open is covered.
// Render the document to the same DOM the live editor will build for `mode`, so
// the instant-paint overlay matches exactly. 'ir' and 'wysiwyg' use the parallel
// `.vditor-{mode} > pre.vditor-reset` structure (the host's Md2VditorIRDOM /
// Md2VditorDOM); 'sv' (split) is structurally different — skip it (returns
// undefined → no overlay). Mode mismatch was visible as the heading-level (H1/H2)
// gutter markers landing in the wrong place when the editor opened in WYSIWYG.
export function renderForMode(
  extensionFsPath: string,
  markdown: string,
  mode: EditorMode,
): string | undefined {
  if (mode === 'sv') return undefined
  if (!lute) {
    prewarmLute(extensionFsPath)
    return undefined
  }
  // Long docs render only a clean prefix (bounded host cost); the live editor
  // renders the full document and swaps in. Small docs pass through whole.
  const md = prerenderPrefix(markdown)
  try {
    return mode === 'wysiwyg' ? lute.Md2VditorDOM(md) : lute.Md2VditorIRDOM(md)
  } catch {
    return undefined
  }
}
