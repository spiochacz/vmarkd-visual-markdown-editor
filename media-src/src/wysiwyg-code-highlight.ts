// WYSIWYG live code-block syntax highlighting — FULL fidelity (colour + bold + italic), matching
// the rendered preview exactly.
//
// In WYSIWYG, when the caret enters a code block Vditor SHOWS the editable source
// (`pre.vditor-wysiwyg__pre > code`) and hides the highlighted preview — so the code was
// monochrome while editing. We re-highlight that editable source with real highlight.js token
// `<span>`s carrying the normal `hljs-*` classes, so the active hljs theme stylesheet styles them
// IDENTICALLY to the preview — including `font-weight`/`font-style` (bold keywords, italic
// comments). The CSS Custom Highlight API was tried first but `::highlight()` can only paint colour
// (the spec excludes font metrics), so bold/italic were lost — unacceptable for "exactly like the
// render". Spans are the only way to get full fidelity.
//
// THE CATCH spans create, and how we handle it: Vditor reparses the whole code block through Lute
// on EVERY keystroke (`input()` → `SpinVditorDOM(blockElement.outerHTML)`, wysiwyg/input.ts) and
// `getValue()` serialises via `VditorDOM2Md` — both read the source's text, and stray spans corrupt
// the code (truncated markdown, mangled text while typing). So we make the spans INVISIBLE to Lute:
// `wrapLuteFlatten()` wraps those two Lute methods to flatten the wysiwyg code source (strip our
// `hljs` class + unwrap all token spans, preserving `<wbr>`/text) in the HTML string BEFORE Lute
// reads it. Lute therefore always sees clean raw code; markdown round-trips byte-identical.
//
// Because Vditor rebuilds the block (fresh, span-free source) on each keystroke, we re-highlight on
// every mutation. Re-highlighting replaces the source's innerHTML, so we save the caret as a
// character offset and restore it afterwards. We skip during IME composition and guard against our
// own mutations (disconnect the observer while writing + an applied-text cache) to avoid loops.

import { addScript } from 'vditor/src/ts/util/addScript'
import { CUSTOM_LANGS } from './code-source'

const OBS_OPTS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}

/**
 * Eager-load highlight.js so WYSIWYG code highlighting is available from the start rather than
 * lazily on the first code-block render (Vditor's default). Reuses Vditor's own script id
 * (`vditorHljsScript`) + URL/version (`markdown/highlightRender.ts`) so it dedupes with Vditor's
 * later lazy load. Resolves once `window.hljs` is usable.
 */
export function ensureHljsLoaded(cdn: string): Promise<void> {
  if ((window as any).hljs) return Promise.resolve()
  const base = `${cdn}/dist/js/highlight.js`
  return addScript(`${base}/highlight.min.js?v=11.7.0`, 'vditorHljsScript')
    .then(() =>
      addScript(`${base}/third-languages.js?v=1.0.1`, 'vditorHljsThirdScript'),
    )
    .then(() => undefined)
    .catch(() => undefined)
}

/**
 * Make our highlight spans invisible to Lute: in the HTML string Lute is about to read, strip the
 * `hljs` class off every wysiwyg code source `<code>` (in WYSIWYG Lute derives the fence info-string
 * from the class list, so a stray `hljs` would emit ` ```js hljs `) and unwrap all token spans to
 * their text — keeping `<wbr>` (Vditor's caret marker) and the raw text intact. Returns the original
 * string untouched when there's no wysiwyg code source (the common case), so it's cheap on every
 * keystroke/serialize. Pure string→string — unit-tested.
 */
export function flattenSourceHtml(html: string): string {
  if (typeof html !== 'string' || html.indexOf('vditor-wysiwyg__pre') === -1)
    return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  let changed = false
  const codes = tpl.content.querySelectorAll<HTMLElement>(
    'pre.vditor-wysiwyg__pre > code',
  )
  for (const code of Array.from(codes)) {
    if (code.classList.contains('hljs')) {
      code.classList.remove('hljs')
      changed = true
    }
    let span = code.querySelector('span')
    while (span) {
      span.replaceWith(...Array.from(span.childNodes))
      changed = true
      span = code.querySelector('span')
    }
  }
  return changed ? tpl.innerHTML : html
}

/**
 * Wrap the Lute methods that read the wysiwyg DOM (`SpinVditorDOM` — every keystroke; `VditorDOM2Md`
 * — getValue) so they flatten our source spans first. Idempotent per Lute instance. WYSIWYG-only:
 * IR uses `SpinVditorIRDOM`/`VditorIRDOM2Md`, which we never touch (IR highlighting is class-only).
 */
export function wrapLuteFlatten(vditor: any): void {
  const lute = vditor?.vditor?.lute
  if (!lute || lute.__vmcsFlattenWrapped) return
  lute.__vmcsFlattenWrapped = true
  for (const method of ['SpinVditorDOM', 'VditorDOM2Md']) {
    const orig = lute[method]
    if (typeof orig !== 'function') continue
    const bound = orig.bind(lute)
    lute[method] = (html: string, ...rest: unknown[]) =>
      bound(flattenSourceHtml(html), ...rest)
  }
}

type Hljs = {
  highlight: (
    code: string,
    opts: { language: string; ignoreIllegals?: boolean },
  ) => { value: string }
  getLanguage?: (name: string) => unknown
}

/** All descendant text nodes of `el`, in document order. */
function textNodesOf(el: Element): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n = walker.nextNode()
  while (n) {
    nodes.push(n as Text)
    n = walker.nextNode()
  }
  return nodes
}

/** The `language-X` token from a code element's class list, or '' if none. */
function langOf(code: Element): string {
  const c = Array.from(code.classList).find((x) => x.startsWith('language-'))
  return c ? c.slice('language-'.length) : ''
}

/**
 * Map a plaintext character offset onto a sequence of text nodes (by their lengths). Returns
 * `[nodeIndex, offsetWithinNode]`, clamped to the last node when past the end. Pure arithmetic —
 * the fiddly bit of caret restoration, unit-tested.
 */
export function positionAtOffset(
  nodeLens: number[],
  offset: number,
): [number, number] {
  if (nodeLens.length === 0) return [0, 0]
  const starts: number[] = []
  let acc = 0
  for (const len of nodeLens) {
    starts.push(acc)
    acc += len
  }
  const last = nodeLens.length - 1
  if (offset >= acc) return [last, nodeLens[last]]
  if (offset <= 0) return [0, 0]
  for (let i = last; i >= 0; i--) {
    if (offset >= starts[i]) return [i, offset - starts[i]]
  }
  return [0, 0]
}

/** The caret/selection as character offsets within `code`, or null if it isn't inside `code`. */
function caretOffsetsWithin(
  code: HTMLElement,
): { start: number; end: number } | null {
  const sel = (code.ownerDocument ?? document).getSelection?.()
  if (!sel || sel.rangeCount === 0) return null
  const rng = sel.getRangeAt(0)
  if (!code.contains(rng.startContainer) || !code.contains(rng.endContainer))
    return null
  const charOffset = (node: Node, offset: number): number => {
    const r = (code.ownerDocument ?? document).createRange()
    r.setStart(code, 0)
    r.setEnd(node, offset)
    return r.toString().length
  }
  return {
    start: charOffset(rng.startContainer, rng.startOffset),
    end: charOffset(rng.endContainer, rng.endOffset),
  }
}

/** Restore a caret/selection from character offsets within `code` (after rebuilding its spans). */
function applyCaretOffsets(
  code: HTMLElement,
  start: number,
  end: number,
): void {
  const doc = code.ownerDocument ?? document
  const tnodes = textNodesOf(code)
  const r = doc.createRange()
  if (tnodes.length === 0) {
    r.setStart(code, 0)
    r.setEnd(code, 0)
  } else {
    const lens = tnodes.map((n) => n.length)
    const [sn, so] = positionAtOffset(lens, start)
    const [en, eo] = positionAtOffset(lens, end)
    r.setStart(tnodes[sn], so)
    r.setEnd(tnodes[en], eo)
  }
  const sel = doc.getSelection?.()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(r)
}

/**
 * The wysiwyg code SOURCE element the caret is currently in, or null. We highlight only the focused
 * block (others have their source hidden — Vditor shows their rendered preview).
 */
function focusedCodeSource(root: ParentNode): HTMLElement | null {
  const sel = ((root as Element).ownerDocument ?? document).getSelection?.()
  const anchor = sel?.anchorNode
  if (!anchor || !root.contains(anchor)) return null
  let el: Node | null = anchor
  while (el && el !== root) {
    if (
      el.nodeType === Node.ELEMENT_NODE &&
      (el as Element).classList?.contains('vditor-wysiwyg__block') &&
      (el as Element).getAttribute('data-type') === 'code-block'
    ) {
      return (el as Element).querySelector<HTMLElement>(
        'pre.vditor-wysiwyg__pre > code',
      )
    }
    el = el.parentNode
  }
  return null
}

/** Is this a code source we should highlight (real, hljs-known language)? */
function highlightable(code: HTMLElement, hljs: Hljs): string | null {
  const lang = langOf(code)
  if (!lang || CUSTOM_LANGS.has(lang)) return null
  if (hljs.getLanguage && !hljs.getLanguage(lang)) return null
  return lang
}

/** Highlight one focused code source with hljs spans, preserving the caret. */
function applyToCode(code: HTMLElement, hljs: Hljs, lang: string): void {
  const text = code.textContent ?? ''
  // Already highlighted for this exact text? (re-fires on selectionchange) — skip to avoid churn.
  if ((code as any).__vmcsText === text && code.querySelector('span')) return
  let html: string
  try {
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return
  }
  const caret = caretOffsetsWithin(code)
  code.innerHTML = html
  code.classList.add('hljs')
  ;(code as any).__vmcsText = text
  if (caret) applyCaretOffsets(code, caret.start, caret.end)
}

/**
 * Tag every real-code wysiwyg source `<code>` with `.hljs` so it carries the theme's base
 * colour/background the MOMENT Vditor reveals it — before our (rAF) token spans land. Without this,
 * the un-highlighted frame is styled by `code:not(.hljs)` (the content theme's inline-code colour,
 * which can be near-invisible on the code panel) → a colour "flash" (e.g. white text) when switching
 * between code blocks. Mirrors IR's `observeCodeSource`. Synchronous + attribute-free (the observer
 * doesn't watch attributes → no loop, applied before paint). Skips diagram languages (mermaid/echarts
 * sources aren't hljs code). The class is stripped before serialization by `flattenSourceHtml`.
 */
function tagSources(root: ParentNode): void {
  const codes = root.querySelectorAll<HTMLElement>(
    'pre.vditor-wysiwyg__pre > code',
  )
  for (const code of Array.from(codes)) {
    if (code.classList.contains('hljs')) continue
    const lang = langOf(code)
    if (lang && CUSTOM_LANGS.has(lang)) continue
    code.classList.add('hljs')
  }
}

/**
 * Live-highlight the focused WYSIWYG code block's editable source with full-fidelity hljs spans.
 * Observes `root` (a stable container — the editor mount) so it survives Vditor's per-keystroke
 * block rebuilds AND a later switch into WYSIWYG; finds the focused source via the selection;
 * coalesces mutations per animation frame; skips during IME composition; disconnects while writing
 * so its own DOM changes don't re-trigger it. Call `wrapLuteFlatten(vditor)` once before this so the
 * spans stay invisible to serialisation. Returns a disposer.
 */
export function observeWysiwygCodeHighlight(
  root: HTMLElement | null | undefined,
  getHljs: () => Hljs | undefined,
): () => void {
  if (!root) return () => {}

  let composing = false
  let rafId = 0

  // On every DOM change: synchronously ensure `.hljs` on all sources (no base-colour flash, runs in
  // the observer microtask = before paint), then schedule the (heavier, caret-restoring) token spans.
  const obs = new MutationObserver(() => {
    tagSources(root)
    schedule()
  })

  const run = (): void => {
    rafId = 0
    if (composing) return
    const hljs = getHljs()
    if (!hljs) return
    // Highlight EVERY real-code source — not just the focused one — and keep them highlighted. A
    // block you switch to is then ALREADY coloured, so it never flashes the monochrome (near-white
    // on a dark theme) base for a frame before the token spans land. Switching reveals a source via
    // a display toggle (no childList mutation), so we can't reliably colour it before the browser
    // paints; pre-highlighting all sources sidesteps that race entirely. The cache (`__vmcsText` +
    // presence of spans) skips unchanged sources, so this stays cheap on every selectionchange /
    // keystroke. Caret is restored only for the source holding the selection (see applyToCode), so
    // highlighting the hidden ones is side-effect-free.
    const todo: Array<[HTMLElement, string]> = []
    for (const code of Array.from(
      root.querySelectorAll<HTMLElement>('pre.vditor-wysiwyg__pre > code'),
    )) {
      const lang = highlightable(code, hljs)
      if (!lang) continue
      if (
        (code as any).__vmcsText === (code.textContent ?? '') &&
        code.querySelector('span')
      )
        continue
      todo.push([code, lang])
    }
    if (todo.length === 0) return
    // Disconnect so our own innerHTML/caret writes aren't observed (no loop).
    obs.disconnect()
    try {
      for (const [code, lang] of todo) applyToCode(code, hljs, lang)
    } finally {
      obs.observe(root, OBS_OPTS)
    }
  }
  const schedule = (): void => {
    if (rafId) return
    rafId = requestAnimationFrame(run)
  }

  const onCompStart = (): void => {
    composing = true
  }
  const onCompEnd = (): void => {
    composing = false
    schedule()
  }

  const doc = root.ownerDocument ?? document
  obs.observe(root, OBS_OPTS)
  doc.addEventListener('selectionchange', schedule)
  root.addEventListener('compositionstart', onCompStart)
  root.addEventListener('compositionend', onCompEnd)
  // Pre-tag any sources already present (incl. hidden ones) so the FIRST reveal is flash-free.
  tagSources(root)
  schedule()

  return () => {
    if (rafId) cancelAnimationFrame(rafId)
    obs.disconnect()
    doc.removeEventListener('selectionchange', schedule)
    root.removeEventListener('compositionstart', onCompStart)
    root.removeEventListener('compositionend', onCompEnd)
  }
}
