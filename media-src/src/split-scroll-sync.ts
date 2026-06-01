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

const PREVIEW_SEL = '.vditor-preview'
const RESET_SEL = '.vditor-reset'
const HEADING_RE = /^#{1,6}\s/

let installed = false

// Top of `el` relative to the scroll container's content (0 = top of content).
function topWithin(container: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function syncSourceToPreview(source: HTMLElement) {
  const content = source.closest('.vditor-content') ?? source.parentElement
  const preview = content?.querySelector<HTMLElement>(PREVIEW_SEL)
  if (!preview || preview.style.display !== 'block') return
  const reset = preview.querySelector<HTMLElement>(RESET_SEL)
  if (!reset) return

  // Heading anchors, paired by DOM order. Source heading blocks start with
  // `#…␠`; preview headings are <h1>..<h6>.
  const srcHeads = (Array.from(source.children) as HTMLElement[]).filter((el) =>
    HEADING_RE.test((el.textContent ?? '').trimStart())
  )
  const pvHeads = (Array.from(reset.children) as HTMLElement[]).filter((el) =>
    /^H[1-6]$/.test(el.tagName)
  )
  // Mismatch → leave Vditor's proportional value untouched (never worse).
  if (!srcHeads.length || srcHeads.length !== pvHeads.length) return

  const srcTops = srcHeads.map((el) => topWithin(source, el))
  const pvTops = pvHeads.map((el) => topWithin(preview, el))
  const centre = source.scrollTop + source.clientHeight / 2

  // Locate the segment [i, i+1) of source headings bracketing the centre, with
  // virtual anchors at the very top (0↔0) and bottom (full height↔full height).
  let target: number
  if (centre <= srcTops[0]) {
    const frac = srcTops[0] > 0 ? centre / srcTops[0] : 0
    target = frac * pvTops[0]
  } else {
    let i = srcTops.length - 1
    for (let k = 0; k < srcTops.length - 1; k++) {
      if (centre < srcTops[k + 1]) {
        i = k
        break
      }
    }
    if (i === srcTops.length - 1) {
      // Past the last heading: interpolate to the end of content.
      const srcSpan = source.scrollHeight - srcTops[i]
      const pvSpan = preview.scrollHeight - pvTops[i]
      const frac = srcSpan > 0 ? (centre - srcTops[i]) / srcSpan : 0
      target = pvTops[i] + frac * pvSpan
    } else {
      const frac = (centre - srcTops[i]) / (srcTops[i + 1] - srcTops[i])
      target = pvTops[i] + frac * (pvTops[i + 1] - pvTops[i])
    }
  }

  preview.scrollTop = clamp(
    target - preview.clientHeight / 2,
    0,
    preview.scrollHeight - preview.clientHeight
  )
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
      if (!t || !t.classList || !t.classList.contains('vditor-sv')) return
      lastSource = t
      if (pending) return
      pending = true
      // After Vditor's synchronous proportional write, so ours wins.
      requestAnimationFrame(() => {
        pending = false
        if (lastSource) syncSourceToPreview(lastSource)
      })
    },
    true // capture: scroll doesn't bubble, but capture sees inner-pane scrolls
  )
}
