import '../src/preload'
// Source import so any wysiwyg/input or processCode patch is applied.
import Vditor from 'vditor/src/index'
import { processPasteCode } from 'vditor/src/ts/util/processCode'

// Real Vditor (WYSIWYG) for the tab+text → code-block bug (task 63). Exposes the
// editor plus a direct `__spin` into Lute's SpinVditorDOM, which is what
// wysiwyg/input.ts feeds the block through — a deterministic way to confirm
// whether a leading tab spins a paragraph into a code block.
const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'wysiwyg',
  cdn: `${location.origin}/vditor`,
  value: '',
  customWysiwygToolbar: () => {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__spin = (html: string) =>
      (editor as any).vditor.lute.SpinVditorDOM(html)
    // Patched paste-code detector (task 63 / PR #1921).
    ;(window as any).__processPasteCode = (
      html: string,
      text: string,
      type = 'wysiwyg',
    ) => processPasteCode(html, text, type)
    ;(window as any).__ready = true
  },
})
