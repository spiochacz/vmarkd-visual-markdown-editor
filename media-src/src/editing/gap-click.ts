// Clicking a boundary that has no caret position — task 292's second trigger, the mouse
// counterpart of gap-nav.ts. Arrows alone are not enough: a document that STARTS with a diagram
// still looks broken if clicking the empty strip above it does nothing (measured in the harness:
// a 24px strip above the first block, ~14px between two fences, and a click in either lands the
// caret INSIDE the block above).
//
// The rule is shared with the arrow mover (gap-boundary.ts). Only the hit-testing is here, because
// it is the one part that needs real layout: jsdom reports every rect as zero, so this file's
// behaviour is covered at the harness layer (media-src/e2e/gap-cursor.spec.ts), not in a unit test.
import { requestCaret } from './caret'
import { type Boundary, contentBlocks, needsGap } from './gap-boundary'
import { makeGapParagraph } from './trailing-paragraph'

// Which boundary the point `y` falls in, or null when it is inside a block's own vertical band
// (there the browser's own caret placement is right and we must not interfere).
// The END boundary (below the last block) deliberately resolves to null too — that one belongs to
// the trailing invariant, see task 292's ownership note.
export function boundaryAtY(editor: HTMLElement, y: number): Boundary | null {
  const blocks = contentBlocks(editor)
  if (blocks.length === 0) return null
  const rects = blocks.map((b) => b.getBoundingClientRect())
  if (y < rects[0].top)
    return {
      before: null,
      after: blocks[0],
      needsGap: needsGap(null, blocks[0]),
    }
  for (let i = 0; i < blocks.length - 1; i++) {
    if (y > rects[i].bottom && y < rects[i + 1].top) {
      return {
        before: blocks[i],
        after: blocks[i + 1],
        needsGap: needsGap(blocks[i], blocks[i + 1]),
      }
    }
  }
  return null
}

export function setupGapClick(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  // mousedown, not click: this is where the browser decides where the caret goes, so pre-empting
  // here means a caret is never painted in the wrong block first (the same reason every nav handler
  // in this codebase works on keydown rather than keyup). The trade-off is deliberate: a selection
  // DRAG that starts inside one of these thin strips is cancelled instead of anchoring in the
  // neighbouring block — restricted to a plain single primary-button press to keep it that narrow.
  const onMousedown = (e: MouseEvent) => {
    if (
      e.button !== 0 ||
      e.detail !== 1 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    )
      return
    const editor = getEditor()
    // Only a click that MISSED every block: anything inside a block is the browser's business.
    if (!editor || e.target !== editor) return
    const boundary = boundaryAtY(editor, e.clientY)
    if (!boundary?.needsGap) return
    const p = makeGapParagraph()
    if (boundary.after) boundary.after.insertAdjacentElement('beforebegin', p)
    else if (boundary.before)
      boundary.before.insertAdjacentElement('afterend', p)
    else return
    editor.focus() // preventDefault below also suppresses the focus the press would have given
    const seed = p.firstChild as Text // makeGapParagraph always seeds one ZWSP text node
    if (requestCaret({ node: seed, offset: seed.data.length })) {
      e.preventDefault()
      e.stopImmediatePropagation()
    } else {
      p.remove() // could not place the caret — leave no litter behind
    }
  }

  document.addEventListener('mousedown', onMousedown, true)
  return () => document.removeEventListener('mousedown', onMousedown, true)
}
