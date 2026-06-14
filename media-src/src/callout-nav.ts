// Arrow navigation INTO collapsed callouts. A collapsed callout's editable source is
// display:none and its visible preview is contenteditable=false, so NATIVE caret movement
// can never place the caret inside one. Real-editor fallout (webview-verified):
//   - ArrowUp/Down either skipped a callout entirely or didn't move at all;
//   - you couldn't reach the position the gap-paragraph splice fires from, so "type
//     between adjacent callouts" was unreachable by keyboard;
//   - at end-of-file the browser DROPPED the selection, and Vditor's keyup
//     (expandMarker(getEditorRange())) then normalised the lost selection to the editor
//     START — the "cursor jumps to the top" bug.
//
// Strategy: pre-empt on KEYDOWN where the geometry is certain, observe on keyup as a
// safety net. The first cut acted only on keyup — but by then the NATIVE move has already
// painted (caret visibly skips past the callout, then gets pulled back on key release;
// worse under key-repeat where many keydowns land before any keyup). So:
//   - keydown (capture): caret on the block's edge line + the directional sibling is a
//     collapsed callout + the current block is NOT one Vditor splices from (blockquote /
//     code-block / table run their own insertAfterBlock gap logic first — wanted) →
//     ENTER the callout immediately: caret at its first/last editable text node +
//     Vditor's own expandMarker, preventDefault — nothing ever moves past it.
//   - keyup (capture, before Vditor's): catches whatever keydown couldn't predict
//     (selection dropped, landed in the preview, skipped through odd structures) and
//     stops Vditor's keyup from re-normalising a lost selection to the editor start
//     (the "cursor jumps to the top" bug).
import { expandMarker } from 'vditor/src/ts/ir/expandMarker'

const PREVIEW = '.vmarkd-callout__preview'

const isCollapsedCallout = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement &&
  el.matches('blockquote[data-callout]') &&
  !el.classList.contains('vditor-ir__node--expand')

// First (entering from above) / last (entering from below) editable text node — the
// injected preview subtree doesn't count.
function edgeEditableText(bq: HTMLElement, last: boolean): Text | null {
  const walker = document.createTreeWalker(bq, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement as HTMLElement).closest(PREVIEW)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let first: Text | null = null
  let lastT: Text | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (t.data.trim() === '') continue
    if (!first) first = t
    lastT = t
  }
  return last ? lastT : first
}

// The caret's line box. A collapsed range can report a zero rect at element boundaries —
// expand it by one character (forward, else backward) for a measurable line rect; last
// resort: the container element's box.
function caretLineRect(range: Range): DOMRect | null {
  const own = range.getBoundingClientRect()
  if (own.height > 0) return own
  const t = range.startContainer
  if (t.nodeType === Node.TEXT_NODE) {
    try {
      const c = range.cloneRange()
      const data = (t as Text).data
      if (range.startOffset < data.length) {
        c.setEnd(t, range.startOffset + 1)
      } else if (range.startOffset > 0) {
        c.setStart(t, range.startOffset - 1)
      }
      const rects = c.getClientRects()
      if (rects.length) return rects[rects.length - 1]
    } catch {
      // fall through to the element box
    }
  }
  const el = (
    t.nodeType === Node.ELEMENT_NODE ? t : t.parentElement
  ) as HTMLElement | null
  return el ? el.getBoundingClientRect() : null
}

// Blocks whose ArrowDown/Up Vditor handles itself (fixBlockquote/fixCodeBlock/fixTable
// splice the in-between gap paragraph) — keydown must not pre-empt those.
const vditorHandlesArrows = (block: HTMLElement): boolean =>
  block.tagName === 'BLOCKQUOTE' ||
  block.tagName === 'TABLE' ||
  block.getAttribute('data-type') === 'code-block'

function topLevelBlock(editor: HTMLElement, node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
  while (el && el.parentElement && el.parentElement !== editor) {
    el = el.parentElement
  }
  return el && el.parentElement === editor ? el : null
}

export function setupCalloutArrowNav(
  getEditor: () => HTMLElement | null | undefined,
  // the inner Vditor instance (window.vditor.vditor) — typed loosely, the harness and
  // main.ts both hand it over untyped
  // biome-ignore lint/suspicious/noExplicitAny: Vditor's IVditor is not exported to us
  getVditor: () => any,
): () => void {
  let snap: {
    block: HTMLElement
    container: Node
    offset: number
    down: boolean
  } | null = null

  const onKeydown = (e: KeyboardEvent) => {
    snap = null
    if (
      (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return
    }
    const editor = getEditor()
    const sel = window.getSelection()
    if (!editor || !sel?.rangeCount || !sel.isCollapsed) return
    const r = sel.getRangeAt(0)
    if (!editor.contains(r.startContainer)) return
    const block = topLevelBlock(editor, r.startContainer)
    if (!block) return
    const down = e.key === 'ArrowDown'
    snap = { block, container: r.startContainer, offset: r.startOffset, down }

    // (End-of-file needs no key handling: gap-paragraph.ts maintains the trailing-
    // paragraph invariant, so a document ending with a block always has a paragraph
    // below it for the native move to land in.)

    // Pre-empt: nothing else will move the caret INTO a collapsed callout, so when the
    // caret sits on the block's edge line and the directional sibling is one, enter it
    // NOW — before the native move paints a skip. Blocks Vditor splices from are left to
    // Vditor (the gap paragraph lands first; the next press enters via this same path).
    if (vditorHandlesArrows(block)) return
    const sibling = down
      ? block.nextElementSibling
      : block.previousElementSibling
    if (!isCollapsedCallout(sibling)) return
    const cr = caretLineRect(r)
    if (!cr) return
    const br = block.getBoundingClientRect()
    const tol = Math.max(cr.height * 0.8, 8)
    const onEdge = down ? br.bottom - cr.bottom < tol : cr.top - br.top < tol
    if (!onEdge) return
    if (enter(e, sibling, down)) snap = null
  }

  const enter = (e: KeyboardEvent, target: HTMLElement, down: boolean) => {
    const text = edgeEditableText(target, !down)
    if (!text) return false
    const place = () => {
      const r = document.createRange()
      r.setStart(text, down ? 0 : text.data.length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      return r
    }
    const r = place() // the range object survives even while the text is display:none
    expandMarker(r, getVditor()) // what a real in-callout caret move triggers → --expand
    place() // re-assert now that the source is visible
    // Block Vditor's own keyup (expandMarker(getEditorRange())) — with the selection we
    // just set it's redundant, and on a DROPPED selection it was the jump-to-top.
    e.preventDefault()
    e.stopImmediatePropagation()
    return true
  }

  const onKeyup = (e: KeyboardEvent) => {
    const s = snap
    snap = null
    if (!s) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const editor = getEditor()
    if (!editor || !editor.isConnected) return
    const { block, down } = s
    const sibling = down
      ? block.nextElementSibling
      : block.previousElementSibling
    const sel = window.getSelection()
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null

    // 1. The caret landed inside a callout PREVIEW (non-editable) — enter that callout.
    const previewHost =
      r &&
      (
        (r.startContainer.nodeType === Node.ELEMENT_NODE
          ? (r.startContainer as HTMLElement)
          : r.startContainer.parentElement) as HTMLElement | null
      )?.closest(PREVIEW)
    if (previewHost) {
      const bq = previewHost.closest<HTMLElement>('blockquote[data-callout]')
      if (bq) enter(e, bq, down)
      return
    }

    if (!isCollapsedCallout(sibling)) return

    // 2. Selection dropped or thrown outside the editor → enter the intended callout.
    if (!r || !editor.contains(r.startContainer)) {
      enter(e, sibling, down)
      return
    }
    // 3. Caret didn't move at all (no editable position inside the collapsed callout).
    if (r.startContainer === s.container && r.startOffset === s.offset) {
      enter(e, sibling, down)
      return
    }
    const landedBlock = topLevelBlock(editor, r.startContainer)
    if (!landedBlock || landedBlock === sibling) return
    // 4. The caret SKIPPED the callout (landed beyond it) — bring it inside instead. A
    //    Vditor keydown splice moves the caret BEFORE the callout (the gap paragraph),
    //    which is wanted — only a move PAST the callout counts as a skip.
    const skipped = down
      ? !!(
          sibling.compareDocumentPosition(landedBlock) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      : !!(
          sibling.compareDocumentPosition(landedBlock) &
          Node.DOCUMENT_POSITION_PRECEDING
        )
    // 5. The selection was re-normalised far away (e.g. to the editor start) — also a
    //    failed move. Covered by `skipped` for downward EOF jumps (landing block precedes
    //    the snapshot block is PRECEDING of sibling when arrowing down? no) — handle
    //    explicitly: landing on the OPPOSITE side of the snapshot block.
    const reset = down
      ? !!(
          s.block.compareDocumentPosition(landedBlock) &
          Node.DOCUMENT_POSITION_PRECEDING
        )
      : !!(
          s.block.compareDocumentPosition(landedBlock) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
    if (skipped || reset) enter(e, sibling, down)
  }

  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('keyup', onKeyup, true)
  return () => {
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('keyup', onKeyup, true)
  }
}
