// Self-cleaning "gap" paragraph for IR navigation between adjacent blocks.
//
// Vditor's insertAfterBlock/insertBeforeBlock (util/fixBrowserBehavior.ts) splice an empty
// `<p>` when you arrow off a block toward an adjacent CODE block — so you CAN type between
// two otherwise-touching blocks (e.g. blockquote↔code or code↔code, which have no editable
// paragraph between them). That insert is wanted when you mean to write, but pure navigation
// then litters the document with empty paragraphs (blank markdown lines) and visible gaps
// that "accumulate" as you arrow around.
//
// Fix: KEEP the insert (so typing between blocks works) but reclaim it lazily — once the
// caret LEAVES such a paragraph while it is still empty, it was only navigation, so drop it.
// An empty `<p>` sitting next to a code block is never real content (markdown has no empty
// paragraphs), so this only ever removes Vditor's transient inserts; the moment the user
// types, the `<p>` holds content and is kept (becomes a normal paragraph).

const ZWSP = /​/g

// An "empty gap" = a paragraph with no element children and no text beyond zero-width
// spaces (Vditor seeds the insert with a ZWSP). A `<wbr>` or any inline child means it is
// still mid-edit / holds something, so leave it alone.
function isEmptyGapParagraph(p: HTMLElement): boolean {
  if (p.childElementCount > 0) return false
  return (p.textContent || '').replace(ZWSP, '').trim() === ''
}

// Remove transient empty gap paragraphs the caret has moved away from. Exported pure so it
// can be unit-tested with a plain DOM. Only touches `<p>` that (a) is empty, (b) does not
// hold the caret, (c) has a code-block neighbour, and (d) is not the trailing paragraph
// (kept so there's always a place to type after the last block).
export function cleanupGapParagraphs(
  editor: HTMLElement,
  caretNode: Node | null,
): void {
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(':scope > p'),
  )) {
    if (!isEmptyGapParagraph(p)) continue
    if (caretNode && p.contains(caretNode)) continue
    const prev = p.previousElementSibling
    const next = p.nextElementSibling
    if (!next) continue // trailing paragraph — keep it
    const codeNeighbour =
      prev?.getAttribute('data-type') === 'code-block' ||
      next.getAttribute('data-type') === 'code-block'
    if (!codeNeighbour) continue
    p.remove()
  }
}

// Wire the cleanup to selection changes (covers arrow nav, clicks, programmatic moves).
// Debounced to one run per animation frame so it runs AFTER Vditor's own handlers settle
// the selection, and never re-enters (removing a caret-less node fires no selectionchange).
// Returns a disposer. Reads the active editor lazily so it survives editor re-inits.
export function observeGapParagraphs(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  let scheduled = false
  const onSelectionChange = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      const editor = getEditor()
      if (!editor) return
      const sel = window.getSelection()
      const caret = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
      cleanupGapParagraphs(editor, caret)
    })
  }
  document.addEventListener('selectionchange', onSelectionChange)
  return () =>
    document.removeEventListener('selectionchange', onSelectionChange)
}
