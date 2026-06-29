// Arrow navigation ACROSS void `<hr>` thematic breaks (task 100). An `<hr>` has no text node, so the
// native caret move drops the selection ON it (the caret falls OUTSIDE the block chain) then snaps
// back — you get stuck on the line above a rule and can't reach the content below it (probed in the
// real webview: ArrowDown traced `P → OUTSIDE → P …`). On ArrowDown/Up, when the caret sits on the
// block's edge line and the directional sibling is an `<hr>`, step the caret PAST the run of rules to
// the adjacent editable block (or the EOF trailing paragraph), and preventDefault so the native move
// never paints the dropped selection. Same keydown-pre-empt shape as callout-nav.ts / setupTrailingNav.
import { placeCaretInTrailing } from './gap-paragraph'

// Non-content helpers that live inside the IR editor but aren't document blocks (chiefly the
// floating table-edit panel `#fix-table-ir-wrapper`, contenteditable=false + absolutely positioned).
// They must never be a caret landing target — Vditor's own splice into it is the jump-to-top bug.
const isHelper = (el: Element): boolean =>
  el.id === 'fix-table-ir-wrapper' ||
  (el.getAttribute('contenteditable') === 'false' &&
    (el as HTMLElement).style?.position === 'absolute')

const isHr = (el: Element | null): el is HTMLHRElement =>
  !!el && el.tagName === 'HR'

// The top-level block (direct child of the editor) that contains `node`.
function topLevelBlock(editor: HTMLElement, node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
  while (el?.parentElement && el.parentElement !== editor) {
    el = el.parentElement
  }
  return el && el.parentElement === editor ? el : null
}

// The caret's line box. A collapsed range can report a zero rect at element boundaries — expand it
// by one character for a measurable line rect; last resort: the container element's box.
function caretLineRect(range: Range): DOMRect | null {
  const own = range.getBoundingClientRect()
  if (own.height > 0) return own
  const t = range.startContainer
  if (t.nodeType === Node.TEXT_NODE) {
    try {
      const c = range.cloneRange()
      const data = (t as Text).data
      if (range.startOffset < data.length) c.setEnd(t, range.startOffset + 1)
      else if (range.startOffset > 0) c.setStart(t, range.startOffset - 1)
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

// Walk past a run of consecutive `<hr>` siblings (starting at `from`, which is the first rule) in the
// arrow direction; return the first element that is NOT a rule, or null at the end of the chain.
function blockAfterRuleRun(
  from: HTMLElement,
  down: boolean,
): HTMLElement | null {
  let el: Element | null = from
  while (isHr(el)) el = down ? el.nextElementSibling : el.previousElementSibling
  return (el as HTMLElement) ?? null
}

// Drop the caret at the start (down) / end (up) of a target block's contents.
function placeCaretAtEdge(target: HTMLElement, down: boolean): void {
  const r = document.createRange()
  r.selectNodeContents(target)
  r.collapse(down) // collapse(true)=start → down lands at the top of the block below; up at the end
  const s = window.getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
}

export function setupHrArrowNav(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  const onKeydown = (e: KeyboardEvent) => {
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
    if (!block || isHr(block)) return
    const down = e.key === 'ArrowDown'
    const sibling = down
      ? block.nextElementSibling
      : block.previousElementSibling
    if (!isHr(sibling)) return // only act when a rule is the next thing in the arrow direction

    // only pre-empt when the caret is on the block's edge line toward the rule (otherwise let the
    // native move travel inside the block first).
    const cr = caretLineRect(r)
    if (!cr) return
    const br = block.getBoundingClientRect()
    const tol = Math.max(cr.height * 0.8, 8)
    const onEdge = down ? br.bottom - cr.bottom < tol : cr.top - br.top < tol
    if (!onEdge) return

    // step past the whole run of rules to the first editable block beyond them
    let target = blockAfterRuleRun(sibling, down)
    while (target && isHelper(target))
      target = (
        down ? target.nextElementSibling : target.previousElementSibling
      ) as HTMLElement | null

    if (target) {
      placeCaretAtEdge(target, down)
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    // nothing editable beyond the rules: at end-of-file land in the trailing paragraph (created on
    // demand); at the very top there's nowhere above, so leave it to the native move.
    if (down && placeCaretInTrailing(editor)) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  document.addEventListener('keydown', onKeydown, true)
  return () => document.removeEventListener('keydown', onKeydown, true)
}
