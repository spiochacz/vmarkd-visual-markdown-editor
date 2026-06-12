// Keep the caret on screen during PROGRAMMATIC arrow-key moves. Native caret movement
// auto-scrolls the nearest scroller for free, but Vditor's up/down navigation between
// table cells sets the selection directly (selectNodeContents + setSelectionFocus in
// fixBrowserBehavior.ts) and never scrolls — so arrowing through a tall table walks the
// caret off-screen while the view stands still. After every arrow keyup, measure the
// caret against its scroller and nudge the scroller just enough to keep it visible
// (block: nearest semantics). A caret that's already visible is a no-op, so the native
// paths are untouched.
import { findScroller } from './toolbar-scroll-guard'

const MARGIN = 12 // breathing room so the caret line isn't glued to the edge

function caretRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect()
  if (rect.width !== 0 || rect.height !== 0) return rect
  // A collapsed caret at an element boundary can report a zero rect — fall back to the
  // container element's box (the cell), which is the row we want visible anyway.
  const el = (
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement
  ) as HTMLElement | null
  return el ? el.getBoundingClientRect() : null
}

export function setupCaretScroll(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  const onKeyup = (e: KeyboardEvent) => {
    if (!e.key.startsWith('Arrow')) return
    const editor = getEditor()
    if (!editor) return
    const sel = window.getSelection()
    if (!sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!editor.contains(range.startContainer)) return
    const rect = caretRect(range)
    if (!rect) return
    const scroller = findScroller(editor)
    const s = scroller.getBoundingClientRect()
    if (rect.top < s.top + MARGIN) {
      scroller.scrollTop -= s.top + MARGIN - rect.top
    } else if (rect.bottom > s.bottom - MARGIN) {
      scroller.scrollTop += rect.bottom - (s.bottom - MARGIN)
    }
  }
  document.addEventListener('keyup', onKeyup)
  return () => document.removeEventListener('keyup', onKeyup)
}
