import '../src/preload'
import Vditor from 'vditor'
import { buildVditorOptions } from '../src/vditor-options'
import { createToolbar } from '../src/toolbar'

// Config-application harness for settings that flow through buildVditorOptions
// (outline enable/position) and the main.ts construction-site toolbar gate
// (showToolbar). Mirrors EXACTLY how main.ts builds the Vditor options so the spec
// verifies the setting → rendered-DOM path, not a hand-rolled option object.
//
// Query params:
//   ?openByDefault=1|0  -> msg.options.showOutlineByDefault (outline.enable)
//   ?position=left|right -> msg.options.outlinePosition (outline.position)
//   ?toolbar=1|0        -> msg.options.showToolbar
//   ?mode=ir|wysiwyg|sv -> editor mode (default ir)
const params = new URLSearchParams(location.search)
const openByDefault = params.get('openByDefault') === '1'
const position = params.get('position') === 'left' ? 'left' : 'right'
const showToolbar = params.get('toolbar') !== '0' // default on, like the setting
const mode = params.get('mode') || 'ir'

const msg: any = {
  cdn: `${location.origin}/vditor`,
  theme: 'light',
  options: {
    showOutlineByDefault: openByDefault,
    outlinePosition: position,
    showToolbar,
  },
}

const opts = buildVditorOptions(msg)

const value = [
  '# First heading',
  '',
  'Paragraph under the first heading.',
  '',
  '## Second heading',
  '',
  'Paragraph under the second heading.',
  '',
  '### Third heading',
  '',
  'Paragraph under the third heading.',
  '',
].join('\n')

const editor = new Vditor('app', {
  ...opts,
  mode,
  cache: { enable: false },
  // Mirror main.ts's construction-site toolbar gate (toolbar lives there, not in
  // buildVditorOptions): an empty toolbar when the setting is off.
  toolbar:
    msg.options.showToolbar === false
      ? []
      : createToolbar({ wikiEnabled: false }),
  value,
  after() {
    ;(window as any).vditor = editor
    ;(window as any).__effectiveOutline = {
      enable: editor.vditor.options.outline.enable,
      position: editor.vditor.options.outline.position,
    }
    ;(window as any).__ready = true
  },
})
