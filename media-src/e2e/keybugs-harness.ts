// E2e harness for the keydown/DOM editing-bug repros (task 65). A real Vditor (from
// source, so our patches apply) in the mode named by `?mode=ir|wysiwyg|sv`. The spec
// sets content via setValue, positions the caret/selection through the exposed
// helpers, then drives real keystrokes with Playwright and reads getValue() back.
import Vditor from 'vditor/src/index'
import { preserveCaretAndScroll } from '../src/caret-preserve'
import { setupCaretScroll } from '../src/caret-scroll'

const params = new URLSearchParams(location.search)
const mode = (params.get('mode') as 'ir' | 'wysiwyg' | 'sv') || 'wysiwyg'

// `?toolbar=1` adds a real toolbar so specs can drive toolbar commands (e.g. the
// inline-code button for the #7 data-marker repro).
const withToolbar = params.get('toolbar') === '1'

const editor = new Vditor('app', {
  cache: { enable: false },
  mode,
  ...(withToolbar
    ? { toolbar: ['bold', 'inline-code', 'code', 'italic', 'strike'] }
    : {}),
  cdn: `${location.origin}/vditor`,
  value: '',
  after() {
    ;(window as any).vditor = editor
    // The contenteditable element of the active mode (where keystrokes land).
    ;(window as any).__modeEl = () =>
      (editor as any).vditor?.[editor.getCurrentMode()]?.element as HTMLElement
    // #1912 mechanism: the production caret/scroll preservation wrapper used by the
    // main.ts external-update path, exposed so the spec can drive it around setValue.
    ;(window as any).__preserveCaretAndScroll = (fn: () => void) =>
      preserveCaretAndScroll(editor, fn)
    // Production wiring under test: keep the caret visible during programmatic arrow
    // moves (table cells) — main.ts wires the same.
    setupCaretScroll(
      () => (editor as any).vditor?.[editor.getCurrentMode()]?.element ?? null,
    )
    ;(window as any).__ready = true
  },
})
