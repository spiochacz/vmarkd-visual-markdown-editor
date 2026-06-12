// Harness for code-block arrow navigation. Real Vditor (IR, from
// source so our patches apply): a paragraph then TWO ADJACENT code blocks, the document ENDING
// with a code block. With observeGapParagraphs + observeTrailingParagraph + setupTrailingNav
// wired exactly as main.ts. The spec drives real keys and asserts: arrowing off a code block
// never splices an empty <p> (moves into the next/prev real block, or stays at EOF — no trailing
// paragraph), and Enter at the code's end ("```|") exits into a fresh paragraph below.
import Vditor from 'vditor/src/index'
import { expandMarker } from 'vditor/src/ts/ir/expandMarker'
import {
  observeGapParagraphs,
  observeTrailingParagraph,
  setupTrailingNav,
} from '../src/gap-paragraph'

const FENCE = '```'
// para, code A, code B (B is the LAST block — end of file).
const value = `text before\n\n${FENCE}js\nconst a = 1\n${FENCE}\n\n${FENCE}js\nconst b = 2\n${FENCE}\n`

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
    ;(window as any).vditor = editor
    ;(window as any).__el = () => ir

    const codeNode = (needle: string) =>
      Array.from(ir.querySelectorAll<HTMLElement>('.vditor-ir__node')).find(
        (n) =>
          n.getAttribute('data-type') === 'code-block' &&
          (n.textContent || '').includes(needle),
      )

    // Expand the code block containing `needle` and drop the caret at the very END of its
    // editable source (the trailing empty line = "```|"). A collapsed source is display:none,
    // so expand FIRST (expandMarker, what a real caret move calls) then re-assert the caret.
    ;(window as any).__placeAtEndOfCode = (needle: string) => {
      const node = codeNode(needle)
      if (!node) return false
      const code = node.querySelector(
        '.vditor-ir__marker--pre code',
      ) as HTMLElement | null
      if (!code) return false
      const place = () => {
        const tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
        let last: Text | null = null
        for (let n = tw.nextNode(); n; n = tw.nextNode()) last = n as Text
        const r = document.createRange()
        if (last) r.setStart(last, last.data.length)
        else r.setStart(code, code.childNodes.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        return r
      }
      const r = place()
      expandMarker(r, iv)
      place()
      return node.classList.contains('vditor-ir__node--expand')
    }
    ;(window as any).__ready = true
  },
})
