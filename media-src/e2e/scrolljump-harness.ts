// Repro harness for the toolbar-click scroll-jump bug: a large doc, scrolled down
// WITHOUT placing a caret, jumps back to the top when a toolbar button is clicked.
// Real Vditor (from source, so our patches apply) in IR mode with a tall document and
// a toolbar. The spec scrolls the editor's scroll container to the bottom, clicks a
// toolbar button, and asserts the scroll position is preserved.
import '../src/preload'
import Vditor from 'vditor/src/index'
import { guardToolbarScroll } from '../src/toolbar-scroll-guard'

const big = Array.from(
  { length: 250 },
  (_, i) =>
    `## Section ${i}\n\nParagraph ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit, plenty of text to make the document tall enough to scroll.`,
).join('\n\n')

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  // Bounded height so the editor scrolls INTERNALLY (pre.vditor-reset) with a fixed
  // toolbar, matching the VS Code webview — otherwise the document scrolls and the
  // toolbar leaves the viewport (a harness artifact, not the real layout).
  height: 600,
  // 'bold' exercises the toolbar→processToolbar→getEditorRange path; 'edit-mode' the
  // EditMode focus() path — the two ways a click moves the caret to doc-start.
  toolbar: ['edit-mode', 'bold'],
  cdn: `${location.origin}/vditor`,
  value: big,
  after() {
    ;(window as any).vditor = editor
    const params = new URLSearchParams(location.search)
    // Optionally focus the editor with the caret at the very top (the real webview
    // state: Vditor focuses on load, the user only scrolled, never moved the caret).
    if (params.get('focustop') === '1') {
      const el = (editor as any).vditor.ir.element as HTMLElement
      el.focus()
      const r = document.createRange()
      r.setStart(el, 0)
      r.collapse(true)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    }
    // The production scroll-preservation hook (called from main.ts finishInit).
    // `?noguard=1` skips it so a spec can observe the RAW Vditor behavior.
    if (params.get('noguard') !== '1') guardToolbarScroll(editor)
    ;(window as any).__modeEl = () =>
      (editor as any).vditor?.[editor.getCurrentMode()]?.element as HTMLElement
    // The element that actually scrolls (pre.vditor-reset in the webview layout).
    ;(window as any).__scroller = () => {
      let n: HTMLElement | null = (editor as any).vditor.ir.element
      while (n && n !== document.body) {
        const oy = getComputedStyle(n).overflowY
        if (
          (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          n.scrollHeight > n.clientHeight + 1
        )
          return n
        n = n.parentElement
      }
      return document.scrollingElement as HTMLElement
    }
    ;(window as any).__ready = true
  },
})
