// Task 83 (increment 5) — open parity for the soft-line-break reflow. The instant-paint overlay is
// host-rendered HTML painted before any script runs, so it cannot reuse the webview's DOM wrapper
// (media-src/src/editing/soft-break.ts); this is the same rule on an HTML STRING, applied to the
// overlay markup when `vmarkd.editor.reflowLineBreaks` is on, so the overlay already has the one-line
// paragraphs and ↵ markers the live editor will have and nothing moves at the swap.
//
// The rule mirrors soft-break.ts (a webview jsdom test runs both over the same corpus and compares):
// in each prose block (p / li / blockquote) the "\n" of a text run that real content follows is wrapped
// in `<span class="vmarkd-softbreak" contenteditable="false">\n</span>`; text under code, markers,
// previews, `data-render`, math/html nodes, read-only subtrees and our own spans is source, not prose;
// a "\n" right after a hard-break <br> and a callout's title-line "\n" are not soft breaks.
//
// Pure string transform, no DOM — safe for the extension host (lute-host.ts) to import.

export const SOFTBREAK_CLASS = 'vmarkd-softbreak'
const SPAN = `<span class="${SOFTBREAK_CLASS}" contenteditable="false">\n</span>`

const PROSE = new Set(['p', 'li', 'blockquote'])
const NESTED_BLOCK = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'div',
])
const SKIP_TAGS = new Set(['pre', 'code', 'script', 'style'])
const SKIP_CLASSES = new Set([
  'vditor-ir__marker',
  'vditor-ir__preview',
  'vditor-wysiwyg__preview',
  SOFTBREAK_CLASS,
])
const SKIP_DATA_TYPES = new Set([
  'math-inline',
  'math-block',
  'html-inline',
  'html-block',
])
const ATOMS = new Set([
  'img',
  'svg',
  'input',
  'canvas',
  'object',
  'embed',
  'video',
  'audio',
  'iframe',
])
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const ZWSP = String.fromCharCode(0x200b)
const CONTENT = new RegExp(`[^\\s${ZWSP}]`)
const CALLOUT_HEAD = /^\s*\[![^\]\n]+\][^\n]*\n/

const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

interface Item {
  /** Index into the output tokens of the text run, or -1 for an element item. */
  at: number
  wrap: boolean
  content: boolean
  br: boolean
}

interface Frame {
  tag: string
  /** Where this element's inline content goes: its own item list (a prose block), the enclosing block's, or none. */
  items: Item[] | null
  /** The element, or an ancestor, is source / somebody else's DOM: nothing inside is prose. */
  skip: boolean
  /** The outermost skipped element — it reports ONE item (content or not) to its parent when it closes. */
  root: Frame | null
  hasContent: boolean
  /** Does the root report an item to the enclosing flow when it closes (not a nested block / atom)? */
  reports: boolean
}

const item = (content: boolean): Item => ({
  at: -1,
  wrap: false,
  content,
  br: false,
})

function skippedByAttrs(attrs: string): boolean {
  for (const m of attrs.matchAll(ATTR)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (name === 'data-render') return true
    if (name === 'contenteditable' && value === 'false') return true
    if (name === 'data-type' && SKIP_DATA_TYPES.has(value)) return true
    if (name === 'class' && value.split(/\s+/).some((c) => SKIP_CLASSES.has(c)))
      return true
  }
  return false
}

/** Wrap the soft-break newlines of one text run. Mirrors `wrapNewlines` in media-src soft-break.ts. */
function wrapRun(
  text: string,
  isLast: boolean,
  afterBr: boolean,
  skipFirst: boolean,
): { html: string; skipFirst: boolean } {
  let out = ''
  let rest = text
  for (;;) {
    const i = rest.indexOf('\n')
    if (i < 0) break
    if (isLast && !CONTENT.test(rest.slice(i + 1))) break
    if (skipFirst || (i === 0 && afterBr)) {
      skipFirst = false
      if (rest.length === i + 1) break
      out += rest.slice(0, i + 1)
      rest = rest.slice(i + 1)
      continue
    }
    out += rest.slice(0, i) + SPAN
    rest = rest.slice(i + 1)
  }
  return { html: out + rest, skipFirst }
}

/** Wrap one finished prose block's own flow. Mirrors `wrapProseBlock`. */
function finishBlock(items: Item[], out: string[]): void {
  let last = items.length - 1
  while (last >= 0 && !items[last].content) last--
  if (last < 0) return
  const firstText = items.find((it) => it.at >= 0)
  let skipFirst = CALLOUT_HEAD.test(firstText ? out[firstText.at] : '')
  for (let idx = 0; idx <= last; idx++) {
    const it = items[idx]
    if (it.at < 0 || !it.wrap || !out[it.at].includes('\n')) continue
    const r = wrapRun(
      out[it.at],
      idx === last,
      items[idx - 1]?.br === true,
      skipFirst,
    )
    out[it.at] = r.html
    skipFirst = r.skipFirst
  }
}

class Scanner {
  readonly out: string[] = []
  private readonly stack: Frame[] = []

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1]
  }

  private items(): Item[] | null {
    return this.top()?.items ?? null
  }

  private report(it: Item): void {
    this.items()?.push(it)
  }

  private close(frame: Frame): void {
    if (frame.items && PROSE.has(frame.tag) && !frame.skip && frame.reports)
      finishBlock(frame.items, this.out)
    if (frame.root === frame && frame.reports)
      this.report(item(frame.hasContent))
  }

  text(raw: string): void {
    const cur = this.top()
    if (cur?.skip) {
      if (cur.root && CONTENT.test(raw)) cur.root.hasContent = true
    } else if (cur?.items)
      cur.items.push({
        at: this.out.length - 1,
        wrap: true,
        content: CONTENT.test(raw),
        br: false,
      })
  }

  closeTag(tag: string): void {
    let k = this.stack.length - 1
    while (k >= 0 && this.stack[k].tag !== tag) k--
    if (k < 0) return
    while (this.stack.length > k) this.close(this.stack.pop() as Frame)
  }

  /** Inside source text only atoms count as content; the stack just stays balanced. */
  private openInSkip(cur: Frame, tag: string, isVoid: boolean): void {
    if (cur.root && ATOMS.has(tag)) cur.root.hasContent = true
    if (!isVoid)
      this.stack.push({
        tag,
        items: null,
        skip: true,
        root: cur.root,
        hasContent: false,
        reports: false,
      })
  }

  /** A source / read-only element (or a non-void atom): ONE item of the enclosing flow. */
  private openSkipped(
    tag: string,
    isVoid: boolean,
    skipped: boolean,
    nested: boolean,
  ): void {
    if (isVoid) {
      if (!nested) this.report(item(ATOMS.has(tag)))
      return
    }
    // a non-void atom (svg, canvas…) is content whatever it holds
    if (!skipped) this.report(item(true))
    const frame: Frame = {
      tag,
      items: null,
      skip: true,
      root: null,
      hasContent: false,
      reports: skipped && !nested,
    }
    frame.root = frame
    this.stack.push(frame)
  }

  openTag(tag: string, attrs: string, selfClosed: boolean): void {
    const isVoid = VOID.has(tag) || selfClosed
    const cur = this.top()
    const nested = NESTED_BLOCK.has(tag)
    const skipped = SKIP_TAGS.has(tag) || skippedByAttrs(attrs)
    if (cur?.skip) this.openInSkip(cur, tag, isVoid)
    else if (tag === 'br') this.report({ ...item(false), br: true })
    else if (skipped || (ATOMS.has(tag) && !isVoid))
      this.openSkipped(tag, isVoid, skipped, nested)
    else if (ATOMS.has(tag)) this.report(item(true))
    else if (!isVoid)
      this.stack.push({
        tag,
        items: nested ? (PROSE.has(tag) ? [] : null) : this.items(),
        skip: false,
        root: null,
        hasContent: false,
        reports: true,
      })
  }

  finish(): string {
    while (this.stack.length) this.close(this.stack.pop() as Frame)
    return this.out.join('')
  }
}

/**
 * Wrap every soft-break newline in the prose of `html` (the inner HTML of the IR / WYSIWYG editable
 * root). A document without a newline inside a block passes through byte for byte.
 */
export function wrapSoftBreaksInHtml(html: string): string {
  if (!html.includes('\n')) return html
  const sc = new Scanner()
  for (const m of html.matchAll(TOKEN)) {
    const [raw, closing, rawTag, attrs = ''] = m
    sc.out.push(raw)
    if (!rawTag) {
      if (!raw.startsWith('<')) sc.text(raw) // else a comment / stray "<"
      continue
    }
    const tag = rawTag.toLowerCase()
    if (closing) sc.closeTag(tag)
    else sc.openTag(tag, attrs, raw.endsWith('/>'))
  }
  return sc.finish()
}
