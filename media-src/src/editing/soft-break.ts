// Task 83 (increment 3) — the DOM half of the editor's soft-line-break reflow.
//
// In the IR / WYSIWYG DOM a soft break is a literal "\n" text character inside a `<p>` / `<li>`; the
// surfaces are `white-space: pre-wrap`, so it shows as a line break. To make the text flow like the
// Preview does, every NON-trailing soft-break "\n" is wrapped in
// `<span class="vmarkd-softbreak" contenteditable="false">\n</span>`: the CSS gives the span
// `white-space: normal` (the newline paints as a space) and a `↵` glyph from a pseudo-element, so the
// glyph is never text and never reaches the markdown or the clipboard.
//
// Why a span and not CSS alone / not data-render: `white-space-collapse: preserve-spaces` is not
// available in Chromium, and `data-render` would hide the "\n" from Lute (the saved file would lose the
// newline). A bare span round-trips: Lute reads its text, the "\n", exactly as before. `contenteditable=
// false` is REQUIRED — next to an editable span, Chromium canonicalised the "\n" to " " as soon as you
// typed beside it.
//
// Pure DOM, no observers: see soft-break-observer.ts for the wiring.

const SOFTBREAK_CLASS = 'vmarkd-softbreak'
export const SOFTBREAK_SELECTOR = `.${SOFTBREAK_CLASS}`

// Prose containers whose direct inline content may hold soft breaks. Headings / table cells cannot
// carry a newline; code, math and html blocks are source text.
const PROSE = 'p,li,blockquote'

// A "\n" under any of these is source text or somebody else's DOM, not a soft break.
const SKIP = [
  'pre,code,script,style',
  '.vditor-ir__marker,.vditor-ir__preview,.vditor-wysiwyg__preview,[data-render]',
  '[data-type="math-inline"],[data-type="math-block"],[data-type="html-inline"],[data-type="html-block"]',
  '[contenteditable="false"]',
  SOFTBREAK_SELECTOR, // our own spans: skipped by class too, so re-wrapping never nests
].join(',')

// Nested blocks are decorated as blocks of their own — never as part of the enclosing block's flow.
const NESTED_BLOCK = 'p,ul,ol,li,blockquote,pre,table,h1,h2,h3,h4,h5,h6,hr,div'

const ATOM = 'img,svg,input,canvas,object,embed,video,audio,iframe'
// zero-width space: Vditor's IR uses it as a caret anchor, it is not content
const ZWSP = String.fromCharCode(0x200b)
const CONTENT = new RegExp(`[^\\s${ZWSP}]`)
// A callout's first line: `[!NOTE]` + optional title. Its newline separates the title from the body.
const CALLOUT_HEAD = /^\s*\[![^\]\n]+\][^\n]*\n/

interface Item {
  /** The text node, or null for an element that counts as content but is never wrapped. */
  text: Text | null
  /** May a "\n" in this text node be wrapped? */
  wrap: boolean
  /** Does this item count as visible content (for the "is anything after me" test)? */
  content: boolean
  /** A hard break `<br>` — a "\n" right after it is part of the break, not a soft break. */
  br?: boolean
}

const textItem = (text: Text, wrap: boolean): Item => ({
  text,
  wrap,
  content: CONTENT.test(text.data),
})
const atomItem = (content: boolean, br = false): Item => ({
  text: null,
  wrap: false,
  content,
  br,
})

// The item an element contributes, or null when it contributes none of its own (a nested block, or
// plain inline markup whose children are walked instead — signalled by `descend`).
function elementItem(el: Element): Item | null | 'descend' {
  if (el.tagName === 'BR') return atomItem(false, true)
  if (el.matches(NESTED_BLOCK)) return null
  if (el.matches(SKIP))
    return atomItem(
      CONTENT.test(el.textContent ?? '') || !!el.querySelector(ATOM),
    )
  if (el.matches(ATOM)) return atomItem(true)
  return 'descend'
}

function collect(parent: Node, wrap: boolean, out: Item[]): void {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      out.push(textItem(n as Text, wrap))
      continue
    }
    if (n.nodeType !== 1) continue
    const item = elementItem(n as Element)
    if (item === 'descend') collect(n, wrap, out)
    else if (item) out.push(item)
  }
}

/** Is `block` (a prose container) itself inside source text / a read-only subtree? */
function insideSkipped(block: Element): boolean {
  const skip = block.closest(SKIP)
  // the editable root is itself a <pre class="vditor-reset"> — only a skip zone BELOW it counts
  return skip !== null && !skip.classList.contains('vditor-reset')
}

/** Wrap the "\n" at `node.data[i]` in a marker span; returns the text node after it. */
function wrapNewlineAt(node: Text, i: number): Text {
  const nl = node.splitText(i)
  const rest = nl.splitText(1)
  const span = document.createElement('span')
  span.className = SOFTBREAK_CLASS
  span.setAttribute('contenteditable', 'false')
  nl.replaceWith(span)
  span.append(nl)
  return rest
}

interface NewlineContext {
  /** The last content item of the block: only a "\n" that real text follows is a soft break there. */
  isLast: boolean
  /** The item before this one is a hard-break `<br>`. */
  afterBr: boolean
  /** The first newline is a callout title-line separator, not a soft break. */
  skipFirst: boolean
}

/** Wrap the soft-break newlines of one text node. Returns the spans made and the carried `skipFirst`. */
function wrapNewlines(
  text: Text,
  ctx: NewlineContext,
): { made: number; skipFirst: boolean } {
  let node = text
  let made = 0
  let { skipFirst } = ctx
  for (;;) {
    const i = node.data.indexOf('\n')
    if (i < 0) break
    if (ctx.isLast && !CONTENT.test(node.data.slice(i + 1))) break
    if (skipFirst || (i === 0 && ctx.afterBr)) {
      // not a soft break (callout title line / the newline of a hard break): leave it as text
      skipFirst = false
      if (node.data.length === i + 1) break
      node = node.splitText(i + 1)
      continue
    }
    node = wrapNewlineAt(node, i)
    made++
  }
  return { made, skipFirst }
}

/**
 * Wrap the non-trailing "\n" runs of ONE prose block's own inline flow. Returns the number of spans
 * created. Idempotent: an already-wrapped "\n" lives in a skipped span. Does not touch the selection
 * (see `withSelectionKept`).
 */
export function wrapProseBlock(block: Element): number {
  if (insideSkipped(block)) return 0
  const items: Item[] = []
  collect(block, true, items)
  let last = items.length - 1
  while (last >= 0 && !items[last].content) last--
  if (last < 0) return 0
  let made = 0
  let skipFirst = CALLOUT_HEAD.test(
    items.find((it) => it.text)?.text?.data ?? '',
  )
  for (let idx = 0; idx <= last; idx++) {
    const it = items[idx]
    if (!it.text || !it.wrap || !it.text.data.includes('\n')) continue
    const r = wrapNewlines(it.text, {
      isLast: idx === last,
      afterBr: items[idx - 1]?.br === true,
      skipFirst,
    })
    made += r.made
    skipFirst = r.skipFirst
  }
  return made
}

// ---- selection kept across a wrap / unwrap ---------------------------------------------------
//
// Wrapping / unwrapping splits and merges text nodes, which invalidates a (node, offset) selection
// point. Chromium's own live-selection fix-up is not enough: a caret sitting BETWEEN two children of
// the block (just after a hard-break <br>) ended up before the newly inserted spans, a line too early.
// So both kinds of endpoint are carried explicitly:
//  - a TEXT endpoint as a character offset into `scope` (`atStart` breaks the tie between "end of the
//    text before" and "start of the text after" a boundary);
//  - an ELEMENT endpoint as the child it sat in front of (or the end of the element), which wrapping
//    never removes.

type Carried =
  | { kind: 'text'; chars: number; atStart: boolean }
  | { kind: 'element'; parent: Node; before: Node | null }

interface Point {
  node: Node
  offset: number
}

function carry(
  scope: Element,
  node: Node | null,
  offset: number,
): Carried | null {
  if (!node || !scope.contains(node)) return null
  if (node.nodeType === 3) {
    const r = document.createRange()
    r.setStart(scope, 0)
    r.setEnd(node, offset)
    return {
      kind: 'text',
      chars: r.toString().length,
      atStart: offset === 0 && (node as Text).data.length > 0,
    }
  }
  return {
    kind: 'element',
    parent: node,
    before: node.childNodes[offset] ?? null,
  }
}

// The (node, offset) `c.chars` characters into `scope`, never inside a soft-break span: a position
// after a span's "\n" continues in the next text node.
function placeText(
  scope: Element,
  chars: number,
  atStart: boolean,
): Point | null {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  let left = chars
  let lastText: Text | null = null
  for (
    let t = walker.nextNode() as Text | null;
    t;
    t = walker.nextNode() as Text | null
  ) {
    if (t.parentElement?.closest(SOFTBREAK_SELECTOR)) {
      left -= t.data.length
      continue
    }
    lastText = t
    if (atStart ? left < t.data.length : left <= t.data.length)
      return { node: t, offset: left }
    left -= t.data.length
  }
  return lastText ? { node: lastText, offset: lastText.data.length } : null
}

function place(scope: Element, c: Carried): Point | null {
  if (c.kind === 'text') return placeText(scope, c.chars, c.atStart)
  if (!c.parent.isConnected) return null
  if (!c.before) return { node: c.parent, offset: c.parent.childNodes.length }
  if (c.before.parentNode !== c.parent) return null
  return {
    node: c.parent,
    offset: Array.prototype.indexOf.call(c.parent.childNodes, c.before),
  }
}

/**
 * Run `fn` (which splits / merges text nodes under `scope`) and put the selection's endpoints back
 * where they were. A no-op unless an endpoint is inside `scope`. The selection is written when `fn`
 * moved it, and ALSO whenever `mutated(result)` says the DOM changed even though the stored
 * (node, offset) did not: Chromium keeps a layout-level copy of the caret that goes stale when the
 * nodes around it are split, and the next typed character then lands where the OLD DOM had the caret
 * (measured: Shift+Enter at a paragraph end, then typing, put the letter at the end of line 1).
 * Re-writing the same range makes it recompute.
 */
export function withSelectionKept<T>(
  scope: Element,
  fn: () => T,
  mutated: (result: T) => boolean = () => false,
): T {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return fn()
  const aC = carry(scope, sel.anchorNode, sel.anchorOffset)
  const fC = carry(scope, sel.focusNode, sel.focusOffset)
  if (!aC && !fC) return fn()
  const result = fn()
  const a = (aC && place(scope, aC)) || {
    node: sel.anchorNode,
    offset: sel.anchorOffset,
  }
  const f = (fC && place(scope, fC)) || {
    node: sel.focusNode,
    offset: sel.focusOffset,
  }
  if (
    a.node &&
    f.node &&
    (mutated(result) ||
      sel.anchorNode !== a.node ||
      sel.anchorOffset !== a.offset ||
      sel.focusNode !== f.node ||
      sel.focusOffset !== f.offset)
  )
    sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
  return result
}

function wrapAll(top: Element): number {
  let made = 0
  if (top.matches(PROSE)) made += wrapProseBlock(top)
  for (const b of top.querySelectorAll(PROSE)) made += wrapProseBlock(b)
  return made
}

/**
 * Wrap every prose block inside `top` (a top-level block, or `top` itself when it is one).
 * `keepSelection` is for the block(s) that actually hold the selection: reading the selection of an
 * editor whose DOM was just changed forces a style + layout flush (measured ~1.2 ms per call on a
 * 1500-paragraph document, 1.8 s over a whole decoration pass), so callers decide ONCE which blocks
 * need it (see `selectionBlocks` in soft-break-observer.ts) instead of every call probing.
 */
export function wrapTopBlock(top: Element, keepSelection = true): number {
  if (!keepSelection) return wrapAll(top)
  return withSelectionKept(
    top,
    () => wrapAll(top),
    (made) => made > 0,
  )
}

/** Replace every span under `root` by its text and merge the text nodes back. Returns the span count. */
export function unwrapSoftBreaks(root: Element): number {
  const spans = root.querySelectorAll(SOFTBREAK_SELECTOR)
  if (spans.length === 0) return 0
  const parents = new Set<Node>()
  for (const sp of spans) {
    if (sp.parentNode) parents.add(sp.parentNode)
    sp.replaceWith(...Array.from(sp.childNodes))
  }
  for (const p of parents) p.normalize()
  return spans.length
}

/** `unwrapSoftBreaks(root)` with the selection carried across the node merges. */
export function unwrapKeepingSelection(root: Element): number {
  return withSelectionKept(
    root,
    () => unwrapSoftBreaks(root),
    (n) => n > 0,
  )
}

// ---- idle chunk scheduler ---------------------------------------------------------------------

export interface ChunkScheduler {
  /** Queue blocks (viewport-first ordering is the caller's job). */
  enqueue(blocks: Iterable<Element>): void
  /** Run one chunk synchronously now (the first-screen chunk), then keep the rest on idle. */
  runNow(): void
  /** Drop everything queued and stop. */
  cancel(): void
  /** Pending count (tests). */
  size(): number
}

export interface ChunkOptions {
  /** Work per chunk in ms. */
  budgetMs?: number
  /** Called at the start of every chunk (e.g. to read per-chunk state once). */
  onChunkStart?: () => void
  /** Called at the end of every chunk (after the last block of it). */
  afterChunk?: () => void
  now?: () => number
  /** Schedule a callback on idle; returns a cancel function. */
  schedule?: (cb: () => void) => () => void
}

const defaultSchedule = (cb: () => void): (() => void) => {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, o?: { timeout: number }) => number)
    | undefined
  // The timeout matters: on a diagram-heavy document the main thread stays busy and a bare idle
  // callback can starve for seconds (task 145 item 1).
  if (ric) {
    const id = ric(cb, { timeout: 120 })
    return () => (window as any).cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(cb, 0)
  return () => window.clearTimeout(id)
}

/**
 * Work through `process(block)` in budgeted chunks. Each chunk keeps going until the budget is spent
 * (always at least one block), then yields. Blocks that were detached meanwhile are skipped.
 */
export function createChunkScheduler(
  process: (block: Element) => void,
  opts: ChunkOptions = {},
): ChunkScheduler {
  const budget = opts.budgetMs ?? 5
  const now = opts.now ?? (() => performance.now())
  const schedule = opts.schedule ?? defaultSchedule
  let queue: Element[] = []
  let head = 0
  let cancelTimer: (() => void) | null = null

  const run = (): void => {
    cancelTimer = null
    opts.onChunkStart?.()
    const start = now()
    while (head < queue.length) {
      const b = queue[head++]
      if (b.isConnected) process(b)
      if (now() - start >= budget) break
    }
    opts.afterChunk?.()
    if (head < queue.length) cancelTimer = schedule(run)
    else {
      queue = []
      head = 0
    }
  }

  return {
    runNow() {
      cancelTimer?.()
      cancelTimer = null
      if (head < queue.length) run()
    },
    enqueue(blocks) {
      for (const b of blocks) queue.push(b)
      if (!cancelTimer && head < queue.length) cancelTimer = schedule(run)
    },
    cancel() {
      cancelTimer?.()
      cancelTimer = null
      queue = []
      head = 0
    },
    size: () => queue.length - head,
  }
}
