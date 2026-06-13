// Scroll-position preservation when toggling between an edit mode (IR / WYSIWYG)
// and the full Preview overlay.
//
// Vditor's preview toolbar button (toolbar/Preview.ts) shows `.vditor-preview`
// (a FRESH render → scrollTop 0) and hides the edit pane. The edit pane keeps its
// scrollTop (only display:none'd), so preview→edit already lands where you left it —
// but edit→preview jumps to the top. The user wants to stay in place BOTH ways.
//
// We reuse the anchored interpolation (heading-align.ts, task 48) but anchor on
// ALL top-level blocks, not just headings: IR and Preview are BOTH Lute renders of
// the same doc → identical block structure → blocks pair 1:1 by index. Dense anchors
// keep the mapping tight even mid-block — a diagram whose rendered height differs
// between the panes still lands the same RELATIVE point, because the interpolation
// is fractional WITHIN that one block (heading-only anchoring interpolated linearly
// across the whole section, so a tall diagram between headings landed wrong — the
// reported bug). Falls back to headings only if the block counts ever drift, then
// to a proportional map.
//
// Two timing facts shape the implementation:
//  1. The pane we read FROM is display:none by the time a style MutationObserver
//     fires (the toolbar hides it in the same handler) → we can't measure it then.
//     So we SNAPSHOT each pane's anchor (block + heading tops + geometry) on its
//     scroll events WHILE IT IS VISIBLE, and use the last snapshot at toggle time.
//  2. The preview render is debounced (options.preview.delay) and diagrams grow
//     async afterwards → a single write under-scrolls. So edit→preview PINS the
//     target for a short window, recomputing each frame as the preview settles,
//     and bails the moment the user scrolls (never fight the user).
//
// SV mode is excluded — it has its own live split sync (split-scroll-sync.ts).

import {
  type ScrollGeom,
  alignByHeadings,
  proportionalScroll,
} from './heading-align'
import { findScroller } from './toolbar-scroll-guard'

const EDIT_PIN_MS = 400
// Long enough to outlast async diagram rendering (mermaid/echarts/graphviz grow
// the preview well after the debounced first paint); we recompute every frame so
// the position self-corrects as it settles, and bail the instant the user scrolls.
const PREVIEW_PIN_MS = 2000

interface Anchor {
  // Tops of ALL top-level blocks, and of headings only — relative to the scroller
  // content (0 = top). Blocks are the primary anchors (IR and Preview are both Lute
  // renders → identical block structure → 1:1 by index); headings are the fallback.
  blockTops: number[]
  headTops: number[]
  geom: ScrollGeom
}

let installed = false
let editAnchor: Anchor | null = null
let previewAnchor: Anchor | null = null
let pinning = false

// Vditor exposes no public typings for its internals here.
type AnyV = any
function vd(): AnyV {
  return (window as { vditor?: AnyV }).vditor
}

// The active edit pane's editable root (`pre.vditor-reset`), or null in sv/preview.
function editReset(): HTMLElement | null {
  const v = vd()
  const mode = v?.getCurrentMode?.()
  if (!mode || mode === 'sv') return null
  return (v?.vditor?.[mode]?.element as HTMLElement | undefined) ?? null
}

function previewEl(): HTMLElement | null {
  return (vd()?.vditor?.preview?.element as HTMLElement | undefined) ?? null
}

function previewReset(): HTMLElement | null {
  return (
    (vd()?.vditor?.preview?.previewElement as HTMLElement | undefined) ?? null
  )
}

// The element that actually SCROLLS the preview. NOT `vditor.preview.element`
// (`.vditor-preview`): in the real VS Code webview that wrapper is `overflow:hidden` and the inner
// `.vditor-reset` is the scroll container (`overflow:auto`); in the test harness it's the wrapper.
// `findScroller` resolves whichever it is (walk up from the reset to the first scrollable ancestor,
// returning the reset itself when IT scrolls). Using the wrong element silently no-ops scrollTop.
function previewScroller(): HTMLElement | null {
  const reset = previewReset()
  return reset ? findScroller(reset) : null
}

function blockChildren(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.children) as HTMLElement[]
}

function headingChildren(root: HTMLElement | null): HTMLElement[] {
  return blockChildren(root).filter((el) => /^H[1-6]$/.test(el.tagName))
}

// Top of `el` relative to `container`'s content (0 = top of content).
function topWithin(container: HTMLElement, el: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  )
}

function geomOf(el: HTMLElement): ScrollGeom {
  return {
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }
}

function topsOf(scroller: HTMLElement, els: HTMLElement[]): number[] {
  return els.map((el) => topWithin(scroller, el))
}

function snapshot(scroller: HTMLElement, root: HTMLElement): Anchor {
  return {
    blockTops: topsOf(scroller, blockChildren(root)),
    headTops: topsOf(scroller, headingChildren(root)),
    geom: geomOf(scroller),
  }
}

// Map a stored FROM anchor onto the live TO pane. Try ALL blocks first (dense,
// 1:1 → tight even mid-block: a diagram whose rendered height differs between the
// panes still lands the same relative point, because the fractional interpolation
// is WITHIN that one block); fall back to headings only (sparser, survives a block-
// count drift), then to a proportional map. Returns null if the TO pane is unusable.
function targetFor(
  from: Anchor | null,
  toScroller: HTMLElement | null,
  toRoot: HTMLElement | null,
): number | null {
  if (!from || !toScroller || !toRoot) return null
  const toGeom = geomOf(toScroller)
  const byBlock = alignByHeadings(
    from.geom,
    from.blockTops,
    toGeom,
    topsOf(toScroller, blockChildren(toRoot)),
  )
  if (byBlock !== null) return byBlock
  const byHead = alignByHeadings(
    from.geom,
    from.headTops,
    toGeom,
    topsOf(toScroller, headingChildren(toRoot)),
  )
  if (byHead !== null) return byHead
  return proportionalScroll(from.geom, toGeom)
}

// Hold `scroller` at the computed target for `ms`, recomputing each frame as the
// content settles (debounced preview render + async diagrams). Bails on the first
// genuine user scroll (wheel / touch / key) so we never fight the user.
// `getScroller` is resolved LAZILY each frame: when entering Preview the scroll container may not
// exist/be scrollable yet (the render is debounced + diagrams grow async, and findScroller can't
// pick the real overflow:auto element until it overflows) — so we re-resolve until it's ready.
function pin(
  getScroller: () => HTMLElement | null,
  compute: () => number | null,
  ms: number,
) {
  pinning = true
  let bailed = false
  let lastWritten = Number.NaN
  const bail = () => {
    bailed = true
  }
  // User input → release (never fight the user). A 'scroll' whose position isn't the value WE just
  // wrote means the user moved it (incl. a scrollbar drag, which fires no wheel/key). Listen on
  // document (capture) since the scroller element isn't known up front / can change.
  const onScroll = () => {
    const sc = getScroller()
    if (
      sc &&
      !Number.isNaN(lastWritten) &&
      Math.abs(sc.scrollTop - lastWritten) > 2
    )
      bailed = true
  }
  document.addEventListener('wheel', bail, { passive: true, capture: true })
  document.addEventListener('touchmove', bail, { passive: true, capture: true })
  document.addEventListener('keydown', bail, true)
  document.addEventListener('scroll', onScroll, {
    passive: true,
    capture: true,
  })
  const cleanup = () => {
    pinning = false
    document.removeEventListener('wheel', bail, { capture: true } as never)
    document.removeEventListener('touchmove', bail, { capture: true } as never)
    document.removeEventListener('keydown', bail, true)
    document.removeEventListener('scroll', onScroll, { capture: true } as never)
  }
  // Frame budget instead of wall-clock (no Date.now needed; ~60fps → ms/16 frames).
  // We recompute every frame so the target tracks the preview growing as its async
  // diagrams render; holding the same value once settled is a harmless no-op.
  let frames = Math.max(1, Math.round(ms / 16))
  const tick = () => {
    if (bailed) {
      cleanup()
      return
    }
    const scroller = getScroller()
    const t = scroller ? compute() : null
    if (scroller && t !== null) {
      scroller.scrollTop = t
      lastWritten = scroller.scrollTop
    }
    if (--frames > 0) requestAnimationFrame(tick)
    else cleanup()
  }
  requestAnimationFrame(tick)
}

// Snapshot whichever pane is currently visible+scrolling, so the value is fresh
// at the next toggle. Skipped while we're pinning (our own writes aren't input).
function captureVisibleAnchor() {
  if (pinning) return
  const pv = previewEl()
  if (pv && pv.style.display === 'block') {
    const reset = previewReset()
    const scroller = previewScroller()
    if (reset && scroller) previewAnchor = snapshot(scroller, reset)
    return
  }
  const edit = editReset()
  if (edit) editAnchor = snapshot(findScroller(edit), edit)
}

function onEnterPreview() {
  // Pin the preview to the edit position while its (debounced + diagram-async) render settles;
  // re-resolve the scroller + recompute the target live each frame from the stored edit anchor.
  pin(
    previewScroller,
    () => targetFor(editAnchor, previewScroller(), previewReset()),
    PREVIEW_PIN_MS,
  )
}

function onLeavePreview() {
  const edit = editReset()
  if (!edit) return
  // The edit pane is already laid out (just un-hidden); a short pin absorbs any
  // re-layout settle. Map from the last preview anchor.
  pin(
    () => findScroller(edit),
    () => targetFor(previewAnchor, findScroller(edit), edit),
    EDIT_PIN_MS,
  )
}

export function setupPreviewScrollPreserve() {
  if (installed) return
  installed = true

  // Snapshot the visible pane on scroll (capture: scroll doesn't bubble), rAF-
  // debounced so it costs ~one measure per frame regardless of scroll rate.
  let queued = false
  document.addEventListener(
    'scroll',
    () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        captureVisibleAnchor()
      })
    },
    true,
  )

  // React to the preview overlay being shown/hidden, however it was triggered.
  const wire = (pv: HTMLElement) => {
    let prev = pv.style.display
    new MutationObserver(() => {
      const now = pv.style.display
      if (now === prev) return
      const wasBlock = prev === 'block'
      prev = now
      if (now === 'block' && !wasBlock) onEnterPreview()
      else if (now !== 'block' && wasBlock) onLeavePreview()
    }).observe(pv, { attributes: true, attributeFilter: ['style'] })
  }

  const pv = previewEl()
  if (pv) {
    wire(pv)
  } else {
    // Preview element not built yet — wait for it (defensive; it normally exists
    // by the time runFinishInit runs).
    const poll = () => {
      const el = previewEl()
      if (el) wire(el)
      else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  }
}
