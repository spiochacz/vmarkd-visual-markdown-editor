// Heading-anchored scroll sync for Vditor's split (sv) view. Task 48.
//
// Vditor's built-in sv sync is purely proportional
// (`preview.scrollTop = textScrollTop * preview.scrollHeight / textScrollHeight`),
// so a tall rendered <h1> vs its one-line `# Heading` source drift out of
// alignment. This overrides it.
//
// Anchoring is on HEADINGS, not all blocks: blocks don't pair 1:1 (e.g. link
// reference definitions are whole source blocks that render to *nothing*), but
// every markdown heading renders to exactly one <h1>..<h6> in the same order, so
// headings are reliable sync points. We align the headings bracketing the source
// viewport's centre and interpolate between them — the centre stays aligned, with
// slight drift between headings (accepted).
//
// One-directional (source -> preview), matching Vditor's own sync direction, so
// there's no scroll-feedback loop. We run inside requestAnimationFrame so our
// write lands AFTER Vditor's synchronous proportional write and wins. A single
// capture-phase listener on document survives mode switches without rebinding.

import { alignByHeadings } from './heading-align'

const PREVIEW_SEL = '.vditor-preview'
const RESET_SEL = '.vditor-reset'
const HEADING_RE = /^#{1,6}\s/

let installed = false

// Top of `el` relative to the scroll container's content (0 = top of content).
function topWithin(container: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  )
}

function syncSourceToPreview(source: HTMLElement) {
  const content = source.closest('.vditor-content') ?? source.parentElement
  const preview = content?.querySelector<HTMLElement>(PREVIEW_SEL)
  if (preview?.style.display !== 'block') return
  const reset = preview.querySelector<HTMLElement>(RESET_SEL)
  if (!reset) return

  // Heading anchors, paired by DOM order. Source heading blocks start with
  // `#…␠`; preview headings are <h1>..<h6>.
  const srcHeads = (Array.from(source.children) as HTMLElement[]).filter((el) =>
    HEADING_RE.test((el.textContent ?? '').trimStart()),
  )
  const pvHeads = (Array.from(reset.children) as HTMLElement[]).filter((el) =>
    /^H[1-6]$/.test(el.tagName),
  )

  const srcTops = srcHeads.map((el) => topWithin(source, el))
  const pvTops = pvHeads.map((el) => topWithin(preview, el))
  // Mismatch → alignByHeadings returns null → leave Vditor's proportional value
  // untouched (never worse).
  const target = alignByHeadings(source, srcTops, preview, pvTops)
  if (target !== null) preview.scrollTop = target
}

export function setupSplitScrollSync() {
  if (installed) return
  installed = true

  let pending = false
  let lastSource: HTMLElement | null = null

  document.addEventListener(
    'scroll',
    (e) => {
      const t = e.target as HTMLElement | null
      if (!t?.classList?.contains('vditor-sv')) return
      lastSource = t
      if (pending) return
      pending = true
      // After Vditor's synchronous proportional write, so ours wins.
      requestAnimationFrame(() => {
        pending = false
        if (lastSource) syncSourceToPreview(lastSource)
      })
    },
    true, // capture: scroll doesn't bubble, but capture sees inner-pane scrolls
  )
}
