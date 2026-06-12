import '../src/preload'
import Vditor from 'vditor'
import { setupPreviewScrollPreserve } from '../src/preview-scroll-preserve'
import { findScroller } from '../src/toolbar-scroll-guard'

// Harness for edit↔preview scroll preservation. Creates Vditor in IR mode with
// many headings, wires setupPreviewScrollPreserve(), and exposes helpers so the
// spec can drive the SAME display toggle the toolbar Preview button performs and
// assert that the pane being shown lands at the matching scroll position.

const sections: string[] = ['# Document title', '']
for (let i = 1; i <= 40; i++) {
  sections.push(
    `## Section ${i}`,
    '',
    `Paragraph under section ${i}. `.repeat(8),
    '',
  )
}
const value = sections.join('\n')

// test harness reaching Vditor internals (no public typings).
type AnyV = any

function iv(): AnyV {
  return (window as AnyV).vditor.vditor
}
function mode(): string {
  return (window as AnyV).vditor.getCurrentMode()
}
function editReset(): HTMLElement {
  return iv()[mode()].element as HTMLElement
}
function editScroller(): HTMLElement {
  return findScroller(editReset())
}
function previewScroller(): HTMLElement {
  return iv().preview.element as HTMLElement
}

// Index of the heading nearest the viewport centre — a layout-independent way to
// assert "same place" across two panes with different block heights.
function centeredHeadingIndex(
  scroller: HTMLElement,
  headRoot: HTMLElement,
): number {
  const heads = (Array.from(headRoot.children) as HTMLElement[]).filter((el) =>
    /^H[1-6]$/.test(el.tagName),
  )
  const centre =
    scroller.getBoundingClientRect().top + scroller.clientHeight / 2
  let best = -1
  let bestDist = Infinity
  heads.forEach((h, i) => {
    const d = Math.abs(h.getBoundingClientRect().top - centre)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

// The block at the viewport centre + the centre's fraction down that block — a
// precise "same place" check that distinguishes landing inside a tall diagram.
function centeredBlock(
  scroller: HTMLElement,
  headRoot: HTMLElement,
): { index: number; frac: number } {
  const blocks = Array.from(headRoot.children) as HTMLElement[]
  const centre =
    scroller.getBoundingClientRect().top + scroller.clientHeight / 2
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect()
    if (centre >= r.top && centre < r.bottom) {
      return { index: i, frac: r.height > 0 ? (centre - r.top) / r.height : 0 }
    }
  }
  return { index: -1, frac: 0 }
}

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value,
  height: '100%',
  preview: { delay: 50 },
  after() {
    ;(window as AnyV).vditor = editor
    setupPreviewScrollPreserve()

    const api: AnyV = {
      getEditScroll: () => editScroller().scrollTop,
      getPreviewScroll: () => previewScroller().scrollTop,
      setEditScroll: (px: number) => {
        editScroller().scrollTop = px
      },
      setPreviewScroll: (px: number) => {
        previewScroller().scrollTop = px
      },
      // Replicates toolbar/Preview.ts (show preview overlay, hide edit, fresh render).
      enterPreview: () => {
        const v = iv()
        v.preview.element.style.display = 'block'
        v[mode()].element.parentElement.style.display = 'none'
        v.preview.render(v)
      },
      leavePreview: () => {
        const v = iv()
        v.preview.element.style.display = 'none'
        v[mode()].element.parentElement.style.display = 'block'
      },
      editCenteredHeading: () =>
        centeredHeadingIndex(editScroller(), editReset()),
      previewCenteredHeading: () =>
        centeredHeadingIndex(previewScroller(), iv().preview.previewElement),
      editCenteredBlock: () => centeredBlock(editScroller(), editReset()),
      previewCenteredBlock: () =>
        centeredBlock(previewScroller(), iv().preview.previewElement),
    }
    ;(window as AnyV).__preview = api
    ;(window as AnyV).__ready = true
  },
})
