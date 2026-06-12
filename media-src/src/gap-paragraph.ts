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
  // A gap neighbour = a block Vditor splices an empty paragraph against: a code block, or a
  // callout (the fixCalloutArrowNav patch adds `data-callout` to Vditor's splice set so you can
  // type between two adjacent callouts too).
  const isGapNeighbour = (el: Element | null) =>
    !!el &&
    (el.getAttribute('data-type') === 'code-block' ||
      (el.tagName === 'BLOCKQUOTE' && el.hasAttribute('data-callout')))
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(':scope > p'),
  )) {
    if (!isEmptyGapParagraph(p)) continue
    if (caretNode && p.contains(caretNode)) continue
    if (p.hasAttribute(TRAILING_ATTR)) continue // maintained by the trailing invariant
    const prev = p.previousElementSibling
    const next = p.nextElementSibling
    if (!next || isHelper(next)) {
      // Last paragraph (nothing, or only our helper wrapper, after it). Normally kept — BUT the
      // transient landing Vditor splices when you ArrowDown past the END of a code block (so the
      // caret gets a spot AFTER the closing ```), once the caret moves on, is reclaimed here: a
      // code block at EOF must not keep a stray empty paragraph (the user wants no extra empty
      // block; code is excluded from the persistent trailing invariant — see endsWithBlock).
      // Callouts/tables keep their trailing paragraph (maintained, serializer-invisible).
      if (prev?.getAttribute('data-type') === 'code-block') p.remove()
      continue
    }
    if (!isGapNeighbour(prev) && !isGapNeighbour(next)) continue
    p.remove()
  }
}

// ---------------------------------------------------------------------------------------
// Trailing paragraph invariant: a document that ENDS with a block (callout, code block,
// table, math, …) must always offer an empty paragraph after it — otherwise there is no
// caret position below the last block at all (arrow-down at end-of-file dropped the
// selection; Vditor's keyup then re-normalised it to the editor start = "screen jumps to
// the top, nowhere to type"). Mirrors ProseMirror's trailing-node plugin. The paragraph is
// tagged data-vmarkd-trailing (attributes are invisible to Lute's serializer, so the
// markdown round-trips unchanged); typing in it strips the tag (it became real content),
// and a stale tagged paragraph that is no longer last (e.g. blocks appended during
// streaming) is garbage-collected while still empty.
const TRAILING_ATTR = 'data-vmarkd-trailing'

// Which last-child blocks need a trailing paragraph offered below them. Earlier this was a
// whitelist (TABLE / [data-type] / callout) — too narrow: the real editor ends documents in
// blocks that match NONE of those (e.g. a normal blockquote — Vditor's IR processKeydown only
// routes code-blocks/tables through insertAfterBlock, so arrow-down off a quote at EOF had no
// target). Flip to a BLACKLIST: anything that is NOT a plain editable text block (where you can
// already place a caret and type) is "atomic" and needs an escape paragraph below it.
const TEXT_BLOCKS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
])
// Code blocks are EXCLUDED — no PERSISTENT trailing paragraph after a code block. ArrowDown past a
// code block's end lands the caret in a TRANSIENT paragraph after the closing ``` (Vditor's own
// insertAfterBlock splice), which cleanupGapParagraphs reclaims once the caret leaves it empty — so
// there's a landing on demand but no stray empty block. (The user explicitly didn't want a
// persistent empty block here.) Tables / callouts / math still get the maintained escape paragraph.
const endsWithBlock = (el: Element): boolean =>
  !TEXT_BLOCKS.has(el.tagName) &&
  !el.hasAttribute(TRAILING_ATTR) &&
  el.getAttribute('data-type') !== 'code-block'

// Non-content helpers that live INSIDE the contenteditable IR element but are not document
// blocks — chiefly our own floating table-edit panel (`#fix-table-ir-wrapper`, fix-table-ir.ts),
// a contenteditable=false 0×0 box pinned at top:0/left:0. It is appended as the editor's last
// child, so it lands in the block sibling chain: Vditor's insertAfterBlock then does
// `selectNodeContents(table.nextElementSibling)` INTO it and the caret jumps to the page top.
// The trailing paragraph must sit BETWEEN the last real block and this wrapper so the caret
// lands in the (in-flow, bottom) paragraph instead. Treat such helpers as non-content.
const isHelper = (el: Element): boolean =>
  el.id === 'fix-table-ir-wrapper' ||
  (el.getAttribute('contenteditable') === 'false' &&
    (el as HTMLElement).style?.position === 'absolute')

// Skipping EMPTY trailing paragraphs and helper wrappers, the last real CONTENT child. A
// trailing paragraph the user has typed into is content (it's about to lose its tag), so it
// must NOT be skipped — otherwise a fresh trailing p gets wedged above it.
function lastContentChild(editor: HTMLElement): Element | null {
  let el = editor.lastElementChild
  while (
    el &&
    ((el.hasAttribute(TRAILING_ATTR) &&
      isEmptyGapParagraph(el as HTMLElement)) ||
      isHelper(el))
  ) {
    el = el.previousElementSibling
  }
  return el
}

function makeTrailing(): HTMLParagraphElement {
  const p = document.createElement('p')
  p.setAttribute('data-block', '0')
  p.setAttribute(TRAILING_ATTR, '')
  p.textContent = '​' // ZWSP seed, like Vditor's own splices
  return p
}

// Exported pure for tests. Returns true when it changed the DOM.
export function ensureTrailingParagraph(
  editor: HTMLElement,
  caretNode: Node | null,
): boolean {
  let changed = false
  const lastContent = lastContentChild(editor)
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(`:scope > p[${TRAILING_ATTR}]`),
  )) {
    if (!isEmptyGapParagraph(p)) {
      p.removeAttribute(TRAILING_ATTR) // user typed — it's real content now
      changed = true
      continue
    }
    // Keep ONLY the trailing paragraph that sits immediately after the last content block
    // (a helper wrapper may follow it). Any other empty trailing p (blocks streamed in after
    // it, or one stranded after the wrapper) is reclaimed.
    if (
      p.previousElementSibling !== lastContent &&
      !(caretNode && p.contains(caretNode))
    ) {
      p.remove()
      changed = true
    }
  }
  if (lastContent && endsWithBlock(lastContent)) {
    const after = lastContent.nextElementSibling
    if (!after?.hasAttribute(TRAILING_ATTR)) {
      // insert AFTER the last content block — before any helper wrapper, never appendChild
      // (which would strand it after the wrapper and re-expose the jump).
      lastContent.insertAdjacentElement('afterend', makeTrailing())
      changed = true
    }
  }
  return changed
}

// Keep the invariant as the editor re-renders (Vditor rebuilds the IR DOM on every edit,
// dropping our model-less paragraph — re-add it). rAF-debounced; idempotent (a run that
// changes nothing schedules nothing → no observer loop). Returns a disposer.
export function observeTrailingParagraph(
  editorEl: HTMLElement | null | undefined,
): () => void {
  if (!editorEl) return () => {}
  let raf = 0
  const run = () => {
    raf = 0
    const sel = window.getSelection()
    const caret = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
    ensureTrailingParagraph(editorEl, caret)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const obs = new MutationObserver(schedule)
  obs.observe(editorEl, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  run()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}

// ---------------------------------------------------------------------------------------
// Trailing-paragraph NAVIGATION (the "mover"). The invariant above guarantees a paragraph
// EXISTS after the last block, but nothing MOVES the caret into it: at end-of-file the
// native ArrowDown from inside a special block (code/callout/table) drops the selection,
// and Vditor's keyup (expandMarker(getEditorRange())) then re-normalises the lost selection
// to the editor START — the "screen jumps to the top, nowhere to type" bug. So we actively
// place the caret in the trailing paragraph ourselves and stop Vditor's keyup from running.
//
// Two-layer, mirroring callout-nav: pre-empt on KEYDOWN where the geometry is certain (caret
// on the block's bottom line) so nothing ever paints a skip, and a geometry-free KEYUP net
// for whatever keydown couldn't predict (selection dropped, caret normalised to the top, or
// the native move did nothing). Both bypass Vditor entirely for the EOF case.

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

// `block` is the last CONTENT block when nothing follows it except trailing paragraph(s) or
// non-content helper wrappers (the table-edit panel).
function isLastContentBlock(block: HTMLElement): boolean {
  let n = block.nextElementSibling
  while (n) {
    if (!(n instanceof HTMLElement)) return false
    if (!n.hasAttribute(TRAILING_ATTR) && !isHelper(n)) return false
    n = n.nextElementSibling
  }
  return true
}

// The caret's line box. A collapsed range can report a zero rect at element boundaries —
// expand it by one character for a measurable line rect; last resort: the container's box.
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

// Ensure the trailing paragraph exists, then drop the caret into it. Returns true on success.
function placeCaretInTrailing(editor: HTMLElement): boolean {
  const sel0 = window.getSelection()
  const caret0 = sel0?.rangeCount ? sel0.getRangeAt(0).startContainer : null
  ensureTrailingParagraph(editor, caret0)
  const p = editor.querySelector<HTMLElement>(`:scope > p[${TRAILING_ATTR}]`)
  if (!p) return false
  const textNode = Array.from(p.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE,
  ) as Text | undefined
  const r = document.createRange()
  if (textNode) r.setStart(textNode, textNode.data.length)
  else r.setStart(p, 0)
  r.collapse(true)
  const s = window.getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
  return true
}

export function setupTrailingNav(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  let snap: {
    block: HTMLElement
    container: Node
    offset: number
    y: number | null // caret line bottom at keydown — to tell a real line-descent apart
  } | null = null

  const onKeydown = (e: KeyboardEvent) => {
    snap = null
    if (
      e.key !== 'ArrowDown' ||
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
    // already in the trailing paragraph — nothing below it.
    if (block.hasAttribute(TRAILING_ATTR)) return
    // caret resolved into a non-content helper (table panel) — recover it into the trailing
    // paragraph immediately (this IS the jump-to-top: the helper is pinned at top:0).
    if (isHelper(block)) {
      if (placeCaretInTrailing(editor)) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      return
    }
    if (!endsWithBlock(block) || !isLastContentBlock(block)) return
    const cr = caretLineRect(r)
    snap = {
      block,
      container: r.startContainer,
      offset: r.startOffset,
      y: cr ? cr.bottom : null,
    }
    if (!cr) return // unmeasurable — defer to the keyup net
    const br = block.getBoundingClientRect()
    const tol = Math.max(cr.height * 0.8, 8)
    const onBottom = br.bottom - cr.bottom <= tol
    if (!onBottom) return // not on the last visual line yet — let it move down inside
    if (placeCaretInTrailing(editor)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      snap = null
    }
  }

  const onKeyup = (e: KeyboardEvent) => {
    const s = snap
    snap = null
    if (!s || e.key !== 'ArrowDown') return
    const editor = getEditor()
    if (!editor?.isConnected) return
    const sel = window.getSelection()
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null

    if (r && editor.contains(r.startContainer)) {
      const tb = topLevelBlock(editor, r.startContainer)
      if (tb?.hasAttribute(TRAILING_ATTR)) return // native already landed in trailing — ok
      // Vditor's insertAfterBlock moved the caret INTO the table-edit helper (pinned at
      // top:0 → the jump). Recover it into the trailing paragraph.
      if (tb && isHelper(tb)) {
        if (placeCaretInTrailing(editor)) e.stopImmediatePropagation()
        return
      }
      if (tb === s.block) {
        // Still in the same block. Did the caret actually DESCEND a line? If yes it was a
        // normal inner-line move — leave it. If not (stuck at the same offset, OR the browser
        // only slid it to the end of the SAME line — common in a blockquote at EOF where there
        // is no line below), it failed to exit downward → push it into the trailing paragraph.
        const now = caretLineRect(r)
        const sameSpot =
          r.startContainer === s.container && r.startOffset === s.offset
        // descended a measurable line → real inner move; otherwise (or unmeasurable +
        // exactly stuck) → failed to exit downward.
        const shouldPlace =
          s.y != null && now ? now.bottom <= s.y + 3 : sameSpot
        if (shouldPlace && placeCaretInTrailing(editor))
          e.stopImmediatePropagation()
        return
      }
      // caret in a DIFFERENT block: only a backward jump (to the top) is a failure.
      if (
        tb &&
        s.block.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_PRECEDING
      ) {
        if (placeCaretInTrailing(editor)) e.stopImmediatePropagation()
      }
      return
    }
    // selection lost or thrown outside the editor → the EOF drop. Restore into trailing.
    if (placeCaretInTrailing(editor)) e.stopImmediatePropagation()
  }

  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('keyup', onKeyup, true)
  return () => {
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('keyup', onKeyup, true)
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
