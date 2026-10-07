// Task 83 (increment 3) — keeps the soft-break spans (soft-break.ts) on the IR / WYSIWYG surface while
// `vmarkd.editor.reflowLineBreaks` is on. Vditor's per-keystroke spin replaces whole blocks with fresh
// span-free DOM, so this re-decorates after the fact, the way callouts.ts / code-source.ts decorate:
//
//  - a MutationObserver on the stable `#app` re-wraps ONLY the top-level blocks a mutation touched
//    (a whole-root walk cost 160 ms per keystroke on a 1500-paragraph document, block-scoped 1.3-1.8 ms);
//  - structural keys (Enter / Shift+Enter / Backspace / Delete, incl. Ctrl+word-delete) hand Vditor the
//    PLAIN block: a window capture-phase keydown unwraps the caret block first. Window capture runs
//    before every document-level capture handler, so it is ahead of hard-break-key.ts's Shift+Enter
//    handler by construction. The observer is held off until a macrotask (its microtask would re-wrap
//    between this listener and Vditor's);
//  - a caret that lands inside a span (a click on the glyph) is moved to just after it;
//  - the initial document (and any bulk replacement, e.g. a mode switch or an undo) is decorated in
//    budgeted idle chunks, blocks on screen first, the first chunk before paint.
//
// Live setting flips arrive through onReflowLineBreaksChange: off unwraps everything, on re-decorates.
import {
  getReflowLineBreaks,
  onReflowLineBreaksChange,
} from './reflow-line-breaks'
import {
  SOFTBREAK_SELECTOR,
  createChunkScheduler,
  unwrapKeepingSelection,
  wrapTopBlock,
} from './soft-break'

// IR / WYSIWYG editable roots. The Preview pane and SV are `.vditor-reset` too but sit elsewhere.
const ROOT_SELECTOR =
  '.vditor-ir > .vditor-reset, .vditor-wysiwyg > .vditor-reset'

// More distinct touched blocks than this in one batch = a bulk replace (setValue, mode switch,
// undo of a large change): decorate in idle chunks instead of inside the observer callback.
const BULK_BLOCKS = 6

const OBS_OPTS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}

const NOOP = (): void => undefined

const elementOf = (n: Node | null): Element | null =>
  !n ? null : n.nodeType === 1 ? (n as Element) : n.parentElement

const rootOf = (n: Node | null): Element | null =>
  elementOf(n)?.closest(ROOT_SELECTOR) ?? null

/** The child of `root` that contains `n` (or `n` itself), null when `n` is not under `root`. */
function topBlockOf(n: Node, root: Element): Element | null {
  let cur: Node | null = n
  while (cur && cur.parentNode !== root) cur = cur.parentNode
  return cur && cur.nodeType === 1 ? (cur as Element) : null
}

/**
 * Order `blocks` (document order) so the ones intersecting the viewport come first, then the rest
 * below it, then the rest above it. Layout reads are a binary search, not one per block.
 */
export function orderViewportFirst(
  blocks: Element[],
  viewportH: number,
): Element[] {
  const n = blocks.length
  if (n < 2) return blocks
  const rect = (i: number) => blocks[i].getBoundingClientRect()
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rect(mid).bottom > 0) hi = mid
    else lo = mid + 1
  }
  const first = lo
  let end = first
  while (end < n && rect(end).top < viewportH) end++
  return [
    ...blocks.slice(first, end),
    ...blocks.slice(end),
    ...blocks.slice(0, first),
  ]
}

/**
 * The top-level blocks holding either end of the selection ("none" when the editor is not the
 * focused element, which needs no selection read at all).
 */
function selectionBlocks(): Set<Element> {
  const out = new Set<Element>()
  const active = document.activeElement
  if (!active?.matches(ROOT_SELECTOR)) return out
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return out
  for (const n of [sel.anchorNode, sel.focusNode]) {
    const top = n && active.contains(n) ? topBlockOf(n, active) : null
    if (top) out.add(top)
  }
  return out
}

/** The top-level blocks a batch of mutation records touched. */
function touchedBlocks(records: MutationRecord[]): Set<Element> {
  const tops = new Set<Element>()
  for (const r of records) {
    const root = rootOf(r.target)
    if (!root) continue
    if (r.target === root) {
      // a block replaced / inserted directly under the root (the spin's outerHTML write)
      for (const a of Array.from(r.addedNodes))
        if (a.nodeType === 1 && a.parentNode === root) tops.add(a as Element)
      continue
    }
    const top = topBlockOf(r.target, root)
    if (top) tops.add(top)
  }
  return tops
}

// Mid-word Backspace / Delete never touches a break: leave those keys alone (the cheap path).
function isMidWordDelete(e: KeyboardEvent, sel: Selection): boolean {
  if (e.key === 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return false
  if (!sel.isCollapsed || sel.anchorNode?.nodeType !== 3) return false
  const len = (sel.anchorNode as Text).data.length
  return e.key === 'Backspace' ? sel.anchorOffset > 0 : sel.anchorOffset < len
}

/** Every top-level block from `a` to `f` (either order), in document order. */
function blocksSpanning(a: Element, f: Element): Element[] {
  const reversed =
    a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING
  const [from, to] = reversed ? [f, a] : [a, f]
  const blocks: Element[] = []
  for (let b: Element | null = from; b; b = b.nextElementSibling) {
    blocks.push(b)
    if (b === to) break
  }
  return blocks
}

/** The top-level blocks holding the two ends of `sel`, when both are in the same IR / WYSIWYG root. */
function selectionEnds(sel: Selection): [Element, Element] | null {
  const root = rootOf(sel.anchorNode)
  if (!root || root !== rootOf(sel.focusNode)) return null
  const a = topBlockOf(sel.anchorNode as Node, root)
  const f = topBlockOf(sel.focusNode as Node, root)
  return a && f ? [a, f] : null
}

/** The blocks to hand the editor plain for this key, or [] when the key is not ours / has no spans. */
function blocksToUnwrap(e: KeyboardEvent): Element[] {
  if (e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== 'Delete')
    return []
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey)) return []
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || isMidWordDelete(e, sel)) return []
  const ends = selectionEnds(sel)
  if (!ends) return []
  const blocks = blocksSpanning(...ends)
  return blocks.some((b) => b.querySelector(SOFTBREAK_SELECTOR)) ? blocks : []
}

/** A collapsed caret that landed inside a marker span (a click on the glyph) goes just after it. */
function moveCaretOutOfMarker(): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return
  const span = elementOf(sel.anchorNode)?.closest(SOFTBREAK_SELECTOR)
  if (!span) return
  const next = span.nextSibling
  if (next?.nodeType === 3) {
    sel.collapse(next, 0)
    return
  }
  const r = document.createRange()
  r.setStartAfter(span)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

class SoftBreakController {
  private enabled = getReflowLineBreaks() === true
  // Records held back while a structural key / IME composition is in flight.
  private held: MutationRecord[] | null = null
  private heldBlocks = new Set<Element>()
  private composing = false
  // The top-level block(s) holding the selection, read ONCE per chunk / batch (see wrapTopBlock).
  private caretBlocks = new Set<Element>()
  private readonly obs: MutationObserver
  private readonly scheduler = createChunkScheduler(
    (block) => {
      const caret = this.caretBlocks.has(block)
      // An idle chunk must not split the text node an IME is composing into: defer that block.
      if (caret && this.composing) this.heldBlocks.add(block)
      else wrapTopBlock(block, caret)
    },
    {
      onChunkStart: () => this.refreshCaretBlocks(),
      // our own writes are not edits
      afterChunk: () => this.obs.takeRecords(),
    },
  )
  private readonly unsubscribe: () => void

  constructor(
    private readonly app: HTMLElement,
    private readonly getRoot: () => HTMLElement | null,
  ) {
    this.obs = new MutationObserver((records) => this.onMutations(records))
    this.obs.observe(app, OBS_OPTS)
    window.addEventListener('keydown', this.onKeydown, true)
    document.addEventListener('selectionchange', this.onSelectionChange)
    document.addEventListener('compositionstart', this.onCompStart, true)
    document.addEventListener('compositionend', this.onCompEnd, true)
    this.unsubscribe = onReflowLineBreaksChange((on) => this.setEnabled(on))
    if (this.enabled) this.decorateAll()
  }

  dispose(): void {
    this.obs.disconnect()
    this.scheduler.cancel()
    this.unsubscribe()
    window.removeEventListener('keydown', this.onKeydown, true)
    document.removeEventListener('selectionchange', this.onSelectionChange)
    document.removeEventListener('compositionstart', this.onCompStart, true)
    document.removeEventListener('compositionend', this.onCompEnd, true)
  }

  private refreshCaretBlocks(): void {
    this.caretBlocks = selectionBlocks()
  }

  private decorateNow(tops: Iterable<Element>): void {
    this.refreshCaretBlocks()
    for (const t of tops)
      if (t.isConnected) wrapTopBlock(t, this.caretBlocks.has(t))
    this.obs.takeRecords()
  }

  private enqueueOrdered(blocks: Element[]): void {
    this.scheduler.enqueue(
      orderViewportFirst(blocks, window.innerHeight || 800),
    )
    this.scheduler.runNow() // the first chunk (the screen) before paint, the rest on idle
  }

  /** Decorate the whole active surface (chunked). */
  private decorateAll(): void {
    const root = this.getRoot()
    if (root?.matches(ROOT_SELECTOR))
      this.enqueueOrdered(Array.from(root.children))
  }

  private handle(records: MutationRecord[]): void {
    const tops = touchedBlocks(records)
    if (tops.size === 0) return
    if (tops.size > BULK_BLOCKS) this.enqueueOrdered(Array.from(tops))
    else this.decorateNow(tops)
  }

  private onMutations(records: MutationRecord[]): void {
    if (!this.enabled) return
    if (this.held || this.composing) {
      this.held ??= []
      this.held.push(...records)
      return
    }
    this.handle(records)
  }

  private release = (): void => {
    if (this.composing) {
      this.held ??= [] // still composing: keep holding (compositionend releases again)
      return
    }
    const records = this.held ?? []
    this.held = null
    const blocks = this.heldBlocks
    this.heldBlocks = new Set()
    if (!this.enabled) return
    if (records.length) this.handle(records)
    this.decorateNow(blocks) // blocks the key unwrapped that the editor left in place
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.isComposing) return
    const blocks = blocksToUnwrap(e)
    if (blocks.length === 0) return
    // The observer's microtask would re-wrap BEFORE Vditor's keydown listener runs: hold it off
    // until a macrotask, then re-decorate whatever the key (and Vditor's spin) changed.
    this.held ??= []
    // add, not replace: a second key before the release must not drop the first key's blocks
    for (const b of blocks) {
      this.heldBlocks.add(b)
      unwrapKeepingSelection(b)
    }
    this.obs.takeRecords() // our unwrap is not an edit either
    setTimeout(this.release, 0)
  }

  private onSelectionChange = (): void => {
    if (this.enabled) moveCaretOutOfMarker()
  }

  // IME composition: never split a node the IME is writing into.
  private onCompStart = (): void => {
    this.composing = true
  }

  private onCompEnd = (): void => {
    this.composing = false
    setTimeout(this.release, 0)
  }

  private setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      this.decorateAll()
      return
    }
    this.scheduler.cancel()
    this.held = null
    this.heldBlocks.clear()
    for (const root of this.app.querySelectorAll(ROOT_SELECTOR))
      unwrapKeepingSelection(root)
    this.obs.takeRecords()
  }
}

export function observeSoftBreaks(
  app: HTMLElement | null | undefined,
  getRoot: () => HTMLElement | null,
): () => void {
  if (!app) return NOOP
  const controller = new SoftBreakController(app, getRoot)
  return () => controller.dispose()
}
