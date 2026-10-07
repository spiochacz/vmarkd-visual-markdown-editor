// Task 530 — Shift+Enter inside prose is a real hard line break, in both the IR and WYSIWYG modes.
//
// Neither mode makes one itself: IR leaves the key to the browser, WYSIWYG leaves it to the browser in
// a paragraph / list item (a bare `<br>` Lute knows nothing about) and inserts a text "\n" elsewhere.
// This handler owns the key in PROSE: it inserts `<br data-marker="<form>">` — the exact element the
// patched Lute emits and reads back (scripts/lute-blob-patch.mjs) — so the break is a hard break from
// the first keystroke on and the next spin keeps it. Everywhere the browser's / Vditor's own behaviour
// is right (headings, table cells, code, math, markers, previews) it stands down.
//
// A capture-phase `keydown` on `document` with `stopImmediatePropagation`, the gap-nav.ts pattern, so
// Vditor's own keydown handler never sees the key.
import { getHardBreakForm } from '../../../src/shared/lute-hard-break'
import { isBlank } from './trailing-paragraph'

// Ancestors in which the browser / Vditor behaviour stays: a heading cannot hold a hard break (a
// backslash there would be literal), a cell cannot hold a newline, and code / math / html / IR syntax
// markers / rendered previews are source text, not prose. A READ-ONLY node (contenteditable=false: the
// callout marker and preview) is never ours either.
const STOCK_SELECTOR = [
  'h1,h2,h3,h4,h5,h6,td,th,pre,code',
  '.vditor-ir__marker,.vditor-ir__preview,[data-render]',
  '[data-type="math-inline"],[data-type="code"],[data-type="html-inline"]',
  '.vmarkd-callout__preview,.vmarkd-callout__marker,[contenteditable="false"]',
].join(',')

const elementOf = (node: Node): Element | null =>
  node.nodeType === 1 ? (node as Element) : node.parentElement

/**
 * The prose block (paragraph / tight list item) holding `node`, or null when Shift+Enter there is not
 * ours. The WHOLE chain up to `root` is checked — a paragraph inside a read-only callout preview, a
 * table cell or a preview is still protected — and the first P/LI on the way up is the block.
 */
export function proseBlockAt(node: Node, root: HTMLElement): Element | null {
  let el = elementOf(node)
  let block: Element | null = null
  while (el && el !== root) {
    if (el.matches(STOCK_SELECTOR)) return null
    if (!block && (el.tagName === 'P' || el.tagName === 'LI')) block = el
    el = el.parentElement
  }
  return el === root ? block : null
}

// Atomic inline content: it is something, even though it has no text.
const ATOMIC = 'img,svg,input,canvas,object,embed,video,audio,iframe'

// Does real content follow the caret inside `el`? IR syntax-marker spans, `<wbr>`, `<br>` and
// whitespace / ZWSP text do not count; text, an image or any other atom does.
function contentFollowsInside(
  el: Element,
  node: Node,
  offset: number,
): boolean {
  const tail = document.createRange()
  tail.setStart(node, offset)
  tail.setEnd(el, el.childNodes.length)
  const frag = tail.cloneContents()
  for (const x of Array.from(
    frag.querySelectorAll('.vditor-ir__marker,wbr,br'),
  ))
    x.remove()
  return !isBlank(frag.textContent ?? '') || !!frag.querySelector(ATOMIC)
}

// A hard break must never be the LAST thing inside inline formatting (`**bold\\\n**` is not strong
// any more). From a collapsed caret, climb every inline element that ends exactly at the caret and
// return the outermost one; the break goes after it. A break in the middle of formatting stays inside.
function outermostEndingAt(range: Range, block: Element): Element | null {
  let outer: Element | null = null
  let el = elementOf(range.startContainer)
  while (el && el !== block) {
    if (contentFollowsInside(el, range.startContainer, range.startOffset)) break
    outer = el
    el = el.parentElement
  }
  return outer
}

// Does anything but whitespace/ZWSP text, `<wbr>` or `<br>` follow `br` anywhere in its block?
function nothingFollowsInBlock(br: HTMLElement, block: Element): boolean {
  const walker = document.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  )
  walker.currentNode = br
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      if (!isBlank((n as Text).data)) return false
    } else if (!['WBR', 'BR'].includes((n as Element).tagName)) return false
  }
  return true
}

/**
 * Insert a marked hard break at `range` (deleting a selection first), put the caret after it, and
 * tell Vditor with an `insertLineBreak` input event so it spins, records undo and saves. When nothing
 * follows the break in its block a bare `<br>` placeholder is appended: a browser needs it to paint
 * (and type on) the new line. Lute's spin drops it again, so `keepLinePlaceholder` restores it.
 */
export function insertHardBreak(
  editor: HTMLElement,
  range: Range,
  form: string,
): void {
  if (!range.collapsed) range.deleteContents()
  const prose = proseBlockAt(range.startContainer, editor)
  const outer = prose ? outermostEndingAt(range, prose) : null
  if (outer) {
    range.setStartAfter(outer)
    range.collapse(true)
  }
  const br = document.createElement('br')
  br.setAttribute('data-marker', form)
  range.insertNode(br)
  const block = br.closest('p, li')
  if (block && nothingFollowsInBlock(br, block))
    block.appendChild(document.createElement('br'))
  const after = document.createRange()
  after.setStartAfter(br)
  after.collapse(true)
  const sel = getSelection()
  sel?.removeAllRanges()
  sel?.addRange(after)
  editor.dispatchEvent(
    new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true }),
  )
}

/**
 * `getVditor` returns the inner Vditor instance (`window.vditor.vditor`): this capture-phase handler
 * pre-empts Vditor's own keydown, which is where it records the undo caret of the very first edit
 * (`undo.recordFirstPosition`) — so it is called here, before mutating.
 */
export function setupHardBreakKey(
  getEditor: () => HTMLElement | null | undefined,
  getVditor?: () => any,
): () => void {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !e.shiftKey) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const editor = getEditor()
    const sel = getSelection()
    if (!editor || !sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    // Both ends must sit in the SAME prose block: a selection across blocks (or over a code block)
    // is not representable as one break, so the stock handling keeps it.
    const block = proseBlockAt(range.startContainer, editor)
    if (!block || block !== proseBlockAt(range.endContainer, editor)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const vditor = getVditor?.()
    vditor?.undo?.recordFirstPosition?.(vditor, e)
    insertHardBreak(editor, range, getHardBreakForm())
  }
  document.addEventListener('keydown', onKeydown, true)
  return () => document.removeEventListener('keydown', onKeydown, true)
}
