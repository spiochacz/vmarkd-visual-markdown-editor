// Streaming / incremental IR render for large documents (task 49, approach B).
//
// The full markdown is already in the webview; Vditor's normal path renders it with
// ONE monolithic `Md2VditorIRDOM(fullDoc)` call that blocks the editor for seconds
// on big files (super-linear on table/ref-heavy content). Instead we split the doc
// into ~4 KB block-boundary chunks and append each rendered chunk to the live IR
// editor, yielding to the event loop so no single Lute call blocks more than tens
// of ms — the editor paints progressively instead of freezing.
//
// Correctness (proven byte-identical to the monolithic render in the bench spikes):
// a chunk rendered in isolation loses cross-chunk link-reference / footnote defs, so
// `[text][ref]` / `[^x]` degrade to literal text. Fix: collect every definition up
// front; for each chunk inject ONLY the defs it cites but doesn't itself define;
// after rendering, remove exactly those injected def blocks BY LABEL. Lute emits each
// link def as its own `link-ref-defs-block`, and footnote defs as `footnotes-def`
// children of one `footnotes-block`, and it does NOT coalesce adjacent defs — so the
// chunk's own in-place defs survive and the assembled DOM equals what
// `Md2VditorIRDOM(fullDoc)` would produce. Same `getValue()`, no save corruption.
//
// Wiki links: `setupCustomRenderer` registers JS renderers on the same `lute`
// instance, so if it runs BEFORE streaming, streamed chunks get wiki chips for free
// (no re-render needed).
//
// Known benign limitation: footnote DISPLAY numbers are assigned per chunk, so a doc
// with footnotes spread across chunks shows local numbering (each chunk restarts at
// 1) rather than global 1..N. That number lives in a `vditor-ir__marker--hide` span
// — hidden in IR view unless the caret enters the footnote — and is NOT part of the
// source, so `getValue()`/save round-trips byte-identically to the monolithic render.
// Footnote-heavy 100 KB+ docs are rare; left as-is for v1.
//
// The pure chunking + def-extraction logic lives in stream-chunk.ts (unit-tested);
// this module is the DOM/Vditor-coupled driver.

import { processAfterRender } from 'vditor/src/ts/ir/process'
import { processCodeRender } from 'vditor/src/ts/util/processCode'
import {
  chunkize,
  buildDefMap,
  externalDefsFor,
  normLabel,
} from './stream-chunk'

export { STREAM_CHUNK_CHARS, chunkize } from './stream-chunk'

// Only stream documents above this size. Smaller docs render monolithically in
// <~100 ms — not worth the brief read-only window or the per-frame yields (which
// can add wall-clock on medium docs). Tunable; char count is a rough proxy (tables
// are super-linear, so a smaller table-heavy doc may still be slow — acceptable for
// v1). The multi-second freezes this targets start around 100 KB+.
export const STREAM_MIN_CHARS = 100_000

// Remove the def blocks we injected (by label), leaving the chunk's own in-place
// defs untouched — DOM surgery, so no regex on nested footnote markup.
function stripInjectedDefs(
  root: HTMLElement,
  injLink: Set<string>,
  injFn: Set<string>,
): void {
  root
    .querySelectorAll('div[data-type="link-ref-defs-block"]')
    .forEach((el) => {
      const m = (el.textContent || '').match(/^\s*\[([^\]^][^\]]*)\]:/)
      if (m && injLink.has(normLabel(m[1]))) el.remove()
    })
  if (injFn.size) {
    root
      .querySelectorAll('div[data-type="footnotes-block"]')
      .forEach((block) => {
        block
          .querySelectorAll('div[data-type="footnotes-def"]')
          .forEach((def) => {
            const m = (def.textContent || '').match(/\[\^([^\]]+)\]:/)
            if (m && injFn.has(`^${normLabel(m[1])}`)) def.remove()
          })
        if (!block.querySelector('div[data-type="footnotes-def"]')) {
          block.remove()
        }
      })
  }
}

// Render one chunk to a detached holder, with cross-chunk refs resolved by injecting
// (then stripping) only the external defs it cites.
function renderChunk(
  lute: { Md2VditorIRDOM(md: string): string },
  chunk: string,
  defMap: Map<string, string>,
): HTMLElement {
  const { text, linkLabels, fnLabels } = externalDefsFor(chunk, defMap)
  const html = text
    ? lute.Md2VditorIRDOM(`${chunk}\n\n${text}`)
    : lute.Md2VditorIRDOM(chunk)
  const holder = document.createElement('div')
  holder.innerHTML = html
  if (text) stripInjectedDefs(holder, linkLabels, fnLabels)
  return holder
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export interface StreamHooks {
  onFirstChunk?: () => void
  onDone?: () => void
}

// Stream-render `markdown` into the live IR editor of `pub` (the public Vditor
// instance). Appends chunk by chunk, yielding when a frame's worth of work has
// accumulated. Resolves once the whole document is in the DOM and the post-render
// pass has run. Falls back to a single setValue if the internals aren't available.
export async function streamRenderIR(
  pub: any,
  markdown: string,
  hooks: StreamHooks = {},
): Promise<void> {
  const vditor = pub?.vditor
  const lute = vditor?.lute
  const irEl: HTMLElement | undefined = vditor?.ir?.element
  if (!vditor || !lute || !irEl) {
    if (pub && typeof pub.setValue === 'function') pub.setValue(markdown)
    hooks.onFirstChunk?.()
    hooks.onDone?.()
    return
  }

  const defMap = buildDefMap(markdown)
  const chunks = chunkize(markdown)
  irEl.innerHTML = '' // constructor was handed '' — start from clean

  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  let lastYield = now()

  for (let i = 0; i < chunks.length; i++) {
    const holder = renderChunk(lute, chunks[i], defMap)
    while (holder.firstChild) irEl.appendChild(holder.firstChild)
    // Highlight/render code/math/diagram previews in what's been appended so far.
    // processCodeRender flips data-render off the pending '2' state, so re-querying
    // only ever processes the new ones.
    irEl
      .querySelectorAll(".vditor-ir__preview[data-render='2']")
      .forEach((item) => {
        processCodeRender(item as HTMLElement, vditor)
      })
    if (i === 0) hooks.onFirstChunk?.()
    // Yield only once a frame's worth of work has piled up — keeps the thread
    // responsive without paying a frame wait per (fast) chunk.
    if (i < chunks.length - 1 && now() - lastYield > 12) {
      await nextFrame()
      lastYield = now()
    }
  }

  // One post-render pass to settle editor state (undo baseline, counter, outline).
  // enableInput:false so we don't post the (now-complete) doc back as an edit.
  processAfterRender(vditor, {
    enableAddUndoStack: true,
    enableHint: false,
    enableInput: false,
  })
  vditor.outline?.render?.(vditor)
  hooks.onDone?.()
}
