// Task 532 — the parity gate's ONE snapshot function, shared by both layers (the chromium harness
// spec and the real-VS-Code spec). It runs INSIDE the page, so it must be self-contained: no
// closures over module state, no imports used at run time. `snapshotExpression` serialises it to a
// string the same way preview-spacing.spec.ts inlines READ_METRICS — the runner just `evaluate`s the
// returned expression.
//
// What it measures, per registry kind and per stage root (see test/parity/elements.ts):
//   rect     height, left, width, firstGlyphX (x of the first PAINTED glyph, relative to the root),
//            nestedListLeft, and gapBefore — the distance from the previous registered kind's bottom.
//            gapBefore + height (not an absolute `top`) is what makes one drifting block report ONCE:
//            an absolute top would repeat the same −16px on every block below a short callout and
//            bury the cause in 30 cascaded cells.
//   style    computed style of the block itself
//   text     computed style of the element holding the first painted glyph
//   marker   counts of each decoration marker (PARITY_MARKERS) that are VISIBLE under the block
//   shape    a block-structure signature, wrapper-insensitive (so `<li>` vs `<li><p>` — the loose
//            list bug — differs while Vditor's dual-node wrappers do not)

import { PARITY_ELEMENTS, PARITY_MARKERS, type ParityFamily } from './elements'

interface SnapshotElementSpec {
  kind: string
  anchor: string | null
  /** Selector for the closest-ancestor walk (anchor) or the direct query (no anchor). */
  selector: string
  /** False for dual-node blocks whose structure is Vditor edit chrome (see ParityElement.shape). */
  shape: boolean
}

interface SnapshotArg {
  rootSelector: string
  elements: SnapshotElementSpec[]
  markers: Record<string, string>
}

interface CellSnapshot {
  rect: Record<string, number | null>
  style: Record<string, string>
  text: Record<string, string>
  marker: Record<string, number>
  shape: string
}

export interface StageSnapshot {
  root: CellSnapshot
  cells: Record<string, CellSnapshot | null>
}

/** A flat `property → value` view of one cell; the unit the comparator and the allow-list speak. */
export type FlatCell = Record<string, string | number>
export type FlatSnapshot = Record<string, FlatCell>

/**
 * Runs in the page. Written in ES2019 with no helpers the transpilers would hoist, because it is
 * serialised with Function#toString.
 */
function snapshotStage(arg: SnapshotArg): StageSnapshot {
  const root = document.querySelector(arg.rootSelector) as HTMLElement | null
  if (!root) throw new Error(`parity: missing stage root ${arg.rootSelector}`)
  const rootRect = root.getBoundingClientRect()
  const BLOCK_STYLE = [
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'margin-top',
    'margin-bottom',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-left-width',
    'border-bottom-width',
    'text-indent',
    'list-style-position',
  ]
  const TEXT_STYLE = [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'color',
    'text-decoration-line',
  ]
  const STRUCTURAL =
    /^(ul|ol|li|p|blockquote|table|thead|tbody|tr|th|td|pre|hr|h[1-6]|dl|dt|dd|details|summary|input|img)$/
  const r2 = (n: number) => Math.round(n * 100) / 100

  // A box counts as painted only if no overflow-clipping ancestor (up to the stage root) is
  // collapsed to nothing: IR collapses a source panel to a zero-height `overflow:hidden` box whose text
  // still has non-empty client rects, so "has a rect" is not "is visible".
  const painted = (r: DOMRect, from: Element | null): boolean => {
    if (r.width <= 0 || r.height <= 0) return false
    for (let a = from; a && a !== root; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      // Only a COLLAPSED clipper hides its content. A scroll container whose content merely lies
      // beyond the visible window (a long code line in a narrow pane) is still painted content.
      const ar = a.getBoundingClientRect()
      if (ar.width <= 0 || ar.height <= 0) return false
    }
    return true
  }
  const visible = (el: Element): boolean => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const rects = el.getClientRects()
    for (let i = 0; i < rects.length; i++)
      if (painted(rects[i], el.parentElement)) return true
    return false
  }
  const read = (el: Element, props: string[]): Record<string, string> => {
    const cs = getComputedStyle(el)
    const out: Record<string, string> = {}
    for (const p of props) out[p] = cs.getPropertyValue(p)
    return out
  }

  // One text node's first painted glyph, or null. IR keeps Vditor's syntax markers (`**`, `# `,
  // fences, the info string) in the DOM and only collapses them; they are not content, so they never
  // count as "the first glyph".
  const glyphOf = (n: Text): { x: number; holder: Element } | null => {
    const holder = n.parentElement
    if (!holder || !/\S/.test(n.nodeValue || '')) return null
    if (holder.closest('[class*="vditor-ir__marker"], [data-type$="-marker"]'))
      return null
    const range = document.createRange()
    range.selectNodeContents(n)
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i++)
      if (painted(rects[i], holder)) return { x: rects[i].left, holder }
    return null
  }
  // The first text node whose range paints a box: this skips IR's collapsed markers and any hidden
  // dual-node source.
  const firstGlyph = (
    block: Element,
  ): { x: number; holder: Element } | null => {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let n: Node | null = w.nextNode()
    while (n) {
      const g = glyphOf(n as Text)
      if (g) return g
      n = w.nextNode()
    }
    return null
  }

  const shapeOf = (el: Element, depth: number): string => {
    const kids: string[] = []
    for (const child of Array.from(el.children)) {
      if (!visible(child)) continue
      const s = shapeOf(child, depth + 1)
      if (s) kids.push(s)
    }
    const tag = el.tagName.toLowerCase()
    if (!STRUCTURAL.test(tag)) return kids.join(',')
    if (depth > 4) return tag
    return kids.length ? `${tag}(${kids.join(',')})` : tag
  }

  const countMarkers = (block: Element): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const name of Object.keys(arg.markers)) {
      const sel = arg.markers[name]
      const hits = Array.from(block.querySelectorAll(sel))
      if (block.matches(sel)) hits.push(block)
      out[name] = hits.filter(visible).length
    }
    return out
  }

  const find = (spec: SnapshotElementSpec): Element | null => {
    if (spec.anchor === null) return root.querySelector(spec.selector)
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n: Node | null = w.nextNode()
    while (n) {
      if ((n.nodeValue || '').includes(spec.anchor)) {
        const hit = (n as Text).parentElement?.closest(spec.selector)
        if (hit && root.contains(hit)) return hit
        return null
      }
      n = w.nextNode()
    }
    return null
  }

  const cell = (
    el: Element,
    prevBottom: number | null,
    withShape: boolean,
  ): { snap: CellSnapshot; bottom: number } => {
    const rect = el.getBoundingClientRect()
    const top = rect.top - rootRect.top + root.scrollTop
    const glyph = firstGlyph(el)
    const nested = el.querySelector('ul ul, ul ol, ol ul, ol ol')
    return {
      bottom: top + rect.height,
      snap: {
        rect: {
          height: r2(rect.height),
          width: r2(rect.width),
          left: r2(rect.left - rootRect.left),
          gapBefore: prevBottom === null ? r2(top) : r2(top - prevBottom),
          firstGlyphX: glyph ? r2(glyph.x - rootRect.left) : null,
          nestedListLeft: nested
            ? r2(nested.getBoundingClientRect().left - rootRect.left)
            : null,
        },
        style: read(el, BLOCK_STYLE),
        text: glyph ? read(glyph.holder, TEXT_STYLE) : {},
        marker: countMarkers(el),
        shape: withShape ? shapeOf(el, 0) : '',
      },
    }
  }

  // Task 532 step 5b — what the user actually SEES behind the content: the first ancestor with a
  // painted background; a transparent webview body shows the editor background behind it, so that is
  // the fallback. The held overlay stands ON TOP of the live editor, so a walk that continued past a
  // transparent overlay would find the live page and agree by accident: for the overlay the walk
  // stops at its own container, which therefore has to paint the page colour itself.
  const pageBg = (): string => {
    const container = root.closest('#vmarkd-prerender')
    if (container) return getComputedStyle(container).backgroundColor
    for (let a: Element | null = root; a; a = a.parentElement) {
      const bg = getComputedStyle(a).backgroundColor
      if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg
    }
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:absolute;visibility:hidden;background-color:var(--vscode-editor-background, transparent)'
    document.body.appendChild(probe)
    const out = getComputedStyle(probe).backgroundColor
    probe.remove()
    return out
  }

  const rootSnap: CellSnapshot = {
    rect: { width: r2(rootRect.width) },
    style: read(root, [
      'font-family',
      'font-size',
      'line-height',
      'color',
      'background-color',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ]),
    text: {},
    marker: {},
    shape: '',
  }
  rootSnap.style['page-bg'] = pageBg()

  const cells: Record<string, CellSnapshot | null> = {}
  let prevBottom: number | null = null
  for (const spec of arg.elements) {
    const el = find(spec)
    if (!el) {
      cells[spec.kind] = null
      continue
    }
    const c = cell(el, prevBottom, spec.shape)
    prevBottom = c.bottom
    cells[spec.kind] = c.snap
  }
  return { root: rootSnap, cells }
}

/** The probe list for a stage family, in registry order; kinds the layer cannot render are dropped. */
function snapshotElements(family: ParityFamily): SnapshotElementSpec[] {
  return PARITY_ELEMENTS.map((e) =>
    'anchor' in e.probe
      ? {
          kind: e.kind,
          anchor: e.probe.anchor,
          selector: e.probe[family],
          shape: e.shape !== false,
        }
      : {
          kind: e.kind,
          anchor: null,
          selector: e.probe.select[family],
          shape: e.shape !== false,
        },
  )
}

/** The expression a runner passes to `evaluate`: the function source applied to the JSON argument. */
export function snapshotExpression(
  rootSelector: string,
  family: ParityFamily,
): string {
  const arg: SnapshotArg = {
    rootSelector,
    elements: snapshotElements(family),
    markers: { ...PARITY_MARKERS },
  }
  return `(${snapshotStage.toString()})(${JSON.stringify(arg)})`
}

function putProps(
  f: FlatCell,
  prefix: string,
  props: Record<string, string | number | null>,
): void {
  for (const [k, v] of Object.entries(props))
    if (v !== null && v !== undefined) f[`${prefix}.${k}`] = v
}

/** Flatten to the `kind → property → value` view the comparator and the allow-list use. */
export function flattenSnapshot(snap: StageSnapshot): FlatSnapshot {
  const flat: FlatSnapshot = {}
  const put = (kind: string, c: CellSnapshot | null) => {
    const f: FlatCell = { present: c ? 'yes' : 'no' }
    if (c) {
      putProps(f, 'rect', c.rect)
      putProps(f, 'style', c.style)
      putProps(f, 'text', c.text)
      putProps(f, 'marker', c.marker)
      f.shape = c.shape
    }
    flat[kind] = f
  }
  put('root', snap.root)
  for (const [kind, c] of Object.entries(snap.cells)) put(kind, c)
  return flat
}
