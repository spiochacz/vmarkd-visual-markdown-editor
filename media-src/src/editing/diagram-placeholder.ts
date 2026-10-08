// Task 532 step 5c — what the instant-paint overlay shows for a diagram: an empty box of the height
// the rendered diagram will have, not the raw source in a code-sized box (which jumped by hundreds of
// px at the swap and showed fence text the editor never displays).
//
// The host (shared/diagram-size.ts annotateDiagramSizes) tags a diagram it has a recorded size for with
// `data-vmarkd-dsize="w,h,pad"`; the webview records that size when a render lands
// (render-cache-client.ts → measureDiagramSize). A tagged diagram reserves `aspect-ratio: w / h` at
// `min(100%, w)` with `pad` folded into the height — the svg is shrink-only, so a narrower column scales the height with it,
// and all of it is plain CSS, so the pass needs no layout (it runs on blocks moved into a detached
// fragment, content-decorators.ts decorateOverlay). An untagged one gets the fixed
// `--vmarkd-geo-diagram-min-h` (main.css): still a jump, but a bounded one.
//
// Paint-only: the overlay is never read back, so clearing the source text cannot reach the saved
// markdown (the live editor builds its own DOM from the document).

import {
  DIAGRAM_SIZE_ATTR,
  type DiagramSize,
  parseDiagramSizeAttr,
} from '../../../src/shared/diagram-size'
import { engineLangSet } from '../diagram-kit/engine-registry'

// Everything the registry calls a diagram (math is a formula: KaTeX draws it in the overlay).
const DIAGRAM_LANGS = engineLangSet((e) => e.diagram)

export const PLACEHOLDER_CLASS = 'vmarkd-diagram-placeholder'
export const PLACEHOLDER_SIZED_CLASS = 'vmarkd-diagram-placeholder--sized'

const PREVIEW_SEL = 'pre.vditor-ir__preview, pre.vditor-wysiwyg__preview'
const round1 = (n: number) => Math.round(n * 10) / 10

const languageOf = (el: Element): string => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('language-'))
  return cls ? cls.slice('language-'.length) : ''
}

// CSS absolute units -> px. Anything else (`%`, `em`, none of the above) is not a natural size.
const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3 }

function lengthPx(v: string | null): number | undefined {
  const m = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(v ?? '')
  const k = m ? UNIT_PX[m[2].toLowerCase()] : undefined
  const n = m && k ? Number(m[1]) * k : 0
  return n > 0 && Number.isFinite(n) ? n : undefined
}

/**
 * The svg's NATURAL size — what it draws at in a column wide enough: its absolute `width`/`height`
 * attributes, else its viewBox. Independent of the pane it was measured in (the live box is shrink-only,
 * so a narrow pane would under-reserve a wide one). Undefined when the svg declares neither.
 */
function naturalSvgSize(svg: SVGElement): [number, number] | undefined {
  const w = lengthPx(svg.getAttribute('width'))
  const h = lengthPx(svg.getAttribute('height'))
  if (w && h) return [w, h]
  const vb = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? [vb[2], vb[3]] : undefined
}

/**
 * The size a rendered diagram occupies: its svg's NATURAL size (see `naturalSvgSize`; the live box when
 * the svg declares none) plus what its wrapper adds around it. Undefined while there is nothing valid to
 * measure (no svg yet, hidden pane, zero-size box) — never a zero, so the caller can retry later.
 */
export function measureDiagramSize(
  wrapper: HTMLElement,
): DiagramSize | undefined {
  const svg = wrapper.querySelector('svg')
  if (!svg) return undefined
  const s = svg.getBoundingClientRect()
  const w = wrapper.getBoundingClientRect()
  if (s.width <= 0 || s.height <= 0 || w.height <= 0) return undefined
  const [nw, nh] = naturalSvgSize(svg) ?? [s.width, s.height]
  return [round1(nw), round1(nh), round1(Math.max(0, w.height - s.height))]
}

/** Replace the raw source of every diagram under `root` with an empty, correctly sized box. */
export function applyDiagramPlaceholders(root: ParentNode): void {
  for (const pre of Array.from(
    root.querySelectorAll<HTMLElement>(PREVIEW_SEL),
  )) {
    const box = pre.firstElementChild as HTMLElement | null
    if (!box || !DIAGRAM_LANGS.has(languageOf(box))) continue
    if (pre.classList.contains(PLACEHOLDER_CLASS)) continue
    pre.classList.add(PLACEHOLDER_CLASS)
    box.textContent = ''
    const size = parseDiagramSizeAttr(pre.getAttribute(DIAGRAM_SIZE_ATTR))
    if (!size) continue
    pre.classList.add(PLACEHOLDER_SIZED_CLASS)
    box.style.setProperty('--vmarkd-dw', String(size[0]))
    // The wrapper's own extra height rides in the ratio (a `padding-bottom` would lose to the
    // `<code>`-diagram panel reset in main.css); it scales with the box, a few px at most.
    box.style.setProperty('--vmarkd-dh', String(round1(size[1] + size[2])))
  }
}
