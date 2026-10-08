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
import {
  repairIrBlocks,
  repairWysiwygBlocks,
} from '../shared/lute-block-repair'
import { repairWysiwygDom, restoreCellGaps } from '../shared/lute-gap-repair'
import { wrapSoftBreaksInHtml } from '../shared/soft-break-html'
import { escapeTableSpanPipes } from '../markdown/table-pipe-escape'
import { newWikiLinkPattern, parseWikiPayload } from '../shared/wiki-core'

const LUTE_REL = 'media/vditor/dist/js/lute/lute.min.js'

// Hard cap on how much markdown we pre-render. renderIR runs SYNCHRONOUSLY on the
// extension-host thread, and Lute's render time grows super-linearly: fast at a
// few KB but seconds for large docs (a 189 KB table-heavy file measured ~26 s),
// which would freeze the whole host and stall the webview open. So we never feed
// Lute more than this many chars: a small doc renders whole; a LONG doc renders
// only a clean prefix (~the first viewport, see prerenderPrefix) for the overlay,
// while the live editor loads the FULL document underneath and swaps in. Either
// way the host render is bounded to the same small, safe budget.
//
// Chosen from `npm run bench:prerender` (median of 9 warm Md2VditorIRDOM runs).
// The render BLOCKS first paint, so the cap is a first-paint budget sized for the
// worst realistic content ("mixed": tables + code + lists + wiki links):
//
//      cap     prose   tables   mixed
//      4 KB    15 ms   15 ms    19 ms
//     10 KB   ~24 ms  ~38 ms   ~55 ms   ← chosen
//     16 KB    38 ms   61 ms    91 ms
//     32 KB    91 ms  108 ms   222 ms
//    256 KB   596 ms 1263 ms  8760 ms   (super-linear blow-up the cap exists to avoid)
//
// 10 KB renders most small/medium wiki pages WHOLE (so the overlay matches the full
// doc, seamless even if you scroll during the swap) while keeping the worst-case
// first-paint cost ≈55 ms. There's a ~15 ms fixed Lute per-call floor regardless of
// size, so smaller caps save little; past ~16 KB the cost climbs fast for marginal
// benefit (a non-scrolling open only ever shows the first screen anyway). The
// one-time Lute $init (~150–250 ms) is paid once per session regardless of this cap.
const MAX_PRERENDER_CHARS = 10_000

export type EditorMode = 'ir' | 'wysiwyg' | 'sv'

let lute:
  | {
      Md2VditorIRDOM(md: string): string
      Md2VditorDOM(md: string): string
      VditorIRDOM2Md(html: string): string
      Md2HTML(md: string): string
      SetHeadingID(b: boolean): void
    }
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
    // Task 243: match the webview's live Lute (esbuild-shared.mjs patchLuteHook) so the
    // instant-paint overlay carries the same `{#custom-id}` heading ids as the real editor
    // that swaps in over it — otherwise a same-doc anchor click during the swap window would
    // resolve against a DOM that doesn't have the id yet.
    instance.SetHeadingID(true)
    lute = instance
    // Warm the JIT once so the first real render isn't cold (the cold first call
    // is markedly slower). Best-effort.
    try {
      instance.Md2VditorIRDOM('# warmup\n\ntext')
    } catch {
      // Best-effort JIT warmup (see comment above) — a failure here just means
      // the first REAL render pays the cold-call cost; nothing else depends on it.
    }
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

// Test-only readiness probes (task 476). Production callers never need these — they already
// treat "not warm yet" and "failed" the same way (fall back, no regression). Backend unit tests
// that call `prewarmLute` need to tell the two apart so a beforeAll can POLL for real readiness
// instead of racing a fixed sleep against the ~250 ms load (which flaked under machine load —
// the sleep lost the race and every test after it read a false `undefined`), and so a genuine
// boot failure surfaces as a loud test failure rather than silently degrading to "not warm".
export function isLuteWarm(): boolean {
  return lute !== undefined
}
export function didLuteFailToLoad(): boolean {
  return loadFailed
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

// Reserialize markdown the way the webview's getValue() does for IR mode:
// VditorIRDOM2Md(Md2VditorIRDOM(md)). Used by the minimal-diff write-back (task 61)
// to decide whether a source block is semantically unchanged (its reserialization
// equals the editor's output) so its ORIGINAL bytes can be preserved. Returns
// undefined when Lute isn't warm (caller falls back to a plain full write — no
// regression). Best-effort; never throws.
export function reserializeMarkdown(
  extensionFsPath: string,
  md: string,
): string | undefined {
  if (!lute) {
    prewarmLute(extensionFsPath)
    return undefined
  }
  try {
    // Normalize table-cell math/code pipes (#1904) first so this models exactly what
    // the editor (fed the same normalized input) serializes back — keeps the
    // minimal-diff equivalence honest.
    const src = escapeTableSpanPipes(md)
    // Task 370: and repair the table-cell gap for the same reason — the webview's IR round-trip
    // does. Without it this canonical form would drop a space the editor keeps, every table with a
    // `| a `b` |` cell would fail `reserialize(originalBlock) === newBlock`, and an edit ANYWHERE
    // in the document would reflow that table.
    // Tasks 239/240: likewise for the block repairs. If this canonical form still degraded an
    // indented code block to prose or dropped a definition title, every such block would compare
    // unequal to the editor's output and be rewritten on an edit made anywhere else in the file.
    // Task 530: the patched Lute carries a hard break's form through its own serializer, so an
    // untouched hard-broken block reserializes to its own bytes with no extra step.
    const warm = lute as NonNullable<typeof lute>
    return warm.VditorIRDOM2Md(
      repairIrBlocks(
        restoreCellGaps(warm.Md2VditorIRDOM(src), () => warm.Md2HTML(src)),
        () => src,
      ),
    )
  } catch {
    return undefined
  }
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
  wikiEnabled = false,
  reflowLineBreaks = false,
): string | undefined {
  if (mode === 'sv') return undefined
  if (!lute) {
    prewarmLute(extensionFsPath)
    return undefined
  }
  // Long docs render only a clean prefix (bounded host cost); the live editor
  // renders the full document and swaps in. Small docs pass through whole.
  // Normalize table-cell math/code pipes (#1904) so the instant-paint overlay matches
  // the live editor (which is fed the same normalized markdown).
  const md = escapeTableSpanPipes(prerenderPrefix(markdown))
  try {
    // Task 370: both renders rewrite whitespace around inline elements (WYSIWYG invents a space in
    // front of glued inline code, IR drops one inside a table cell) and the live editor repairs
    // both — so the overlay must too, or the text shifts sideways at the swap. Oracle over `md`,
    // the same (possibly truncated) slice we rendered, not the full document: fed anything else the
    // counts wouldn't line up and the repair would bail out.
    const warm = lute as NonNullable<typeof lute>
    const html =
      mode === 'wysiwyg'
        ? repairWysiwygBlocks(
            repairWysiwygDom(warm.Md2VditorDOM(md), () => warm.Md2HTML(md)),
            () => md,
          )
        : repairIrBlocks(
            restoreCellGaps(warm.Md2VditorIRDOM(md), () => warm.Md2HTML(md)),
            () => md,
          )
    // The host Lute has no wiki custom renderer, so [[links]] come back as literal
    // text. For a wiki file, rewrite them to the same chip spans the live editor
    // emits so the instant-paint overlay shows styled chips, not raw [[…]].
    const withChips = wikiEnabled ? renderWikiChipsInHtml(html) : html
    // Task 83: with reflow on the live editor wraps every soft-break newline in a marker span; do the
    // same here so the overlay already has the reflowed layout and nothing moves at the swap.
    return reflowLineBreaks ? wrapSoftBreaksInHtml(withChips) : withChips
  } catch {
    return undefined
  }
}

function escapeWikiHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  )
}

// The rendered DOM the chip transform sees is ALREADY entity-escaped by Lute (`[[A&B]]` arrives as
// `[[A&amp;B]]`), while the webview's renderer works on the raw token text. Undo exactly the escapes
// Lute applies so the chip is escaped ONCE, like the live editor's (a `&` in a page name showed up
// as a literal `&amp;` in the overlay chip; found by wiki-chip-parity.test.ts). `&amp;` goes last so
// `&amp;lt;` decodes to `&lt;`, not `<`.
function unescapeWikiHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

// Own instance (see wiki-core.ts's newWikiLinkPattern doc comment) — isolated from the shared
// WikiLinkPattern that custom-renderer.ts / wiki-serialize.ts / wiki-core.ts's own
// extractWikiTargets also read; only renderWikiChipsInHtml below ever touches this one.
const wikiLinkPattern = newWikiLinkPattern()

// Rewrite [[wiki]] / [[wiki|label]] literals in rendered IR/DOM HTML into the chip
// spans the webview's custom renderer produces, so the prerender overlay matches the
// live editor for a wiki file. Missing/existing colouring is left to the live editor
// (we have no page index at paint time) — every chip renders as a normal link here.
// Pure string transform; exported for unit tests.
export function renderWikiChipsInHtml(html: string): string {
  wikiLinkPattern.lastIndex = 0
  return html.replace(
    wikiLinkPattern,
    (escapedFull: string, escapedInner: string) => {
      const full = unescapeWikiHtml(escapedFull)
      const { target, label } = parseWikiPayload(unescapeWikiHtml(escapedInner))
      const display = label || target
      return (
        `<span class="wiki-link-chip" data-wiki-link="1" ` +
        `data-wiki-target="${escapeWikiHtml(target)}" ` +
        `data-wiki-source="${escapeWikiHtml(full)}" ` +
        `title="Open wiki page ${escapeWikiHtml(target)}">` +
        `${escapeWikiHtml(display)}</span>`
      )
    },
  )
}
