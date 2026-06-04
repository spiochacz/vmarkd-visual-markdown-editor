// E2e harness for the keydown/DOM editing-bug repros (task 65). A real Vditor (from
// source, so our patches apply) in the mode named by `?mode=ir|wysiwyg|sv`. The spec
// sets content via setValue, positions the caret/selection through the exposed
// helpers, then drives real keystrokes with Playwright and reads getValue() back.
import Vditor from 'vditor/src/index'

const params = new URLSearchParams(location.search)
const mode = (params.get('mode') as 'ir' | 'wysiwyg' | 'sv') || 'wysiwyg'

const editor = new Vditor('app', {
  cache: { enable: false },
  mode,
  cdn: `${location.origin}/vditor`,
  value: '',
  after() {
    ;(window as any).vditor = editor
    // The contenteditable element of the active mode (where keystrokes land).
    ;(window as any).__modeEl = () =>
      (editor as any).vditor?.[editor.getCurrentMode()]?.element as HTMLElement
    ;(window as any).__ready = true
  },
})
