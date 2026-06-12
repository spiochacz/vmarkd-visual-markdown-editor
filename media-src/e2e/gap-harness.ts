// Harness for the self-cleaning gap paragraph (arrow nav between adjacent blocks).
// Real Vditor (IR, from source so our patches apply) laid out blockquote↔code↔blockquote
// plus two ADJACENT CALLOUTS ending the document, with observeGapParagraphs +
// observeCallouts wired exactly as main.ts does. The spec drives real arrow keys and
// asserts that the empty paragraph Vditor splices on arrow self-cleans on pass-through,
// while typed content is kept — for code blocks AND callouts (incl. end-of-file).
import Vditor from 'vditor/src/index'
import { expandMarker } from 'vditor/src/ts/ir/expandMarker'
import { setupCalloutArrowNav } from '../src/callout-nav'
import { observeCallouts } from '../src/callouts'
import {
  observeGapParagraphs,
  observeTrailingParagraph,
  setupTrailingNav,
} from '../src/gap-paragraph'

const FENCE = '```'
// beta is MULTI-LINE on purpose: the injected preview then carries a "\n" in its
// textContent, which is exactly what broke Vditor's raw-textContent last-line check
// (single-line callouts dodge the bug because divs add no newlines to textContent).
const value = `> quote above\n\n${FENCE}js\nconst a = 1\n${FENCE}\n\n> quote below\n\n> [!NOTE]\n> alpha callout\n\n> [!TIP]\n> beta callout\n> second line beta\n`

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  height: 500,
  cdn: `${location.origin}/vditor`,
  value,
  after() {
    const iv = (editor as any).vditor
    const ir = iv.ir.element as HTMLElement
    observeGapParagraphs(() => ir)
    observeTrailingParagraph(ir)
    setupTrailingNav(() => ir)
    observeCallouts(ir)
    setupCalloutArrowNav(
      () => ir,
      () => iv,
    )
    ;(window as any).vditor = editor
    ;(window as any).__el = () => ir
    // Caret at the END of a callout's EDITABLE content + Vditor's real caret-move expand
    // (expandMarker). A collapsed callout's source is display:none — setting a selection
    // into hidden text gets normalized away by Chromium — so expand FIRST via the same
    // call a real caret move makes, then (re-)place the caret in the now-visible text.
    ;(window as any).__placeEndOfCallout = (marker: string) => {
      const bq = Array.from(
        ir.querySelectorAll<HTMLElement>('blockquote[data-callout]'),
      ).find((b) => (b.textContent || '').includes(marker))
      if (!bq) return false
      const lastEditableText = () => {
        const walker = document.createTreeWalker(bq, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            (n.parentElement as HTMLElement).closest('.vmarkd-callout__preview')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        })
        let last: Text | null = null
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if ((n as Text).data.trim() !== '') last = n as Text
        }
        return last
      }
      const place = () => {
        const t = lastEditableText()
        if (!t) return null
        const r = document.createRange()
        r.setStart(t, t.data.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        return r
      }
      const r = place()
      if (!r) return false
      expandMarker(r, iv) // what Vditor calls on a real caret move
      place() // re-assert now that the source is visible
      return bq.classList.contains('vditor-ir__node--expand')
    }
    ;(window as any).__ready = true
  },
})
