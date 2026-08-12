import '../src/boot/preload'
import Vditor from 'vditor'
import { buildVditorOptions } from '../src/boot/vditor-options'
import { applyBodyOptions } from '../src/boot/live-config'

// D11 — config INTERACTION-PAIR harness (tasks/516, 455 "config interaction pairs" open
// item). Every existing config-apply/width/code-linenumber harness proves ONE setting at a
// time; this one drives the SAME `msg.options` blob through BOTH buildVditorOptions (Vditor
// constructor opts: outline, codeBlockLineNumbers) AND applyBodyOptions (body attrs/vars:
// fullWidth, fontSize) — mirroring how main.ts really wires them (message-router.ts calls
// applyBodyOptions(msg.options) with the exact options object buildVditorOptions also reads,
// task 450's lesson: prove the pair at THIS layer, not with N real-VS-Code boots).
//
// Query params:
//   ?fullWidth=1|0     -> msg.options.enableFullWidth
//   ?outline=1|0       -> msg.options.showOutlineByDefault (outline panel open on init)
//   ?fontSize=NUMBER    -> msg.options.fontSize (--me-font-size)
//   ?lineNumbers=1|0   -> msg.options.codeBlockLineNumbers
//   ?mode=ir|wysiwyg|sv -> editor mode (default ir)
const params = new URLSearchParams(location.search)
const fullWidth = params.get('fullWidth') === '1'
const outlineOn = params.get('outline') === '1'
const fontSize = params.get('fontSize')
  ? Number(params.get('fontSize'))
  : undefined
const lineNumbersOn = params.get('lineNumbers') === '1'
const mode = params.get('mode') || 'ir'

const options: any = {
  enableFullWidth: fullWidth,
  showOutlineByDefault: outlineOn,
  outlinePosition: 'right',
  codeBlockLineNumbers: lineNumbersOn,
}
if (fontSize !== undefined) options.fontSize = fontSize

const msg: any = {
  cdn: `${location.origin}/vditor`,
  theme: 'light',
  options,
}

const opts = buildVditorOptions(msg)

const value = [
  '# First heading',
  '',
  'Paragraph under the first heading with enough text to span a good part of the column so its box width is meaningful to measure.',
  '',
  '## Second heading',
  '',
  'Paragraph under the second heading.',
  '',
  '```js',
  'const a = 1',
  'const b = 2',
  'const c = 3',
  '```',
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
  toolbar: [],
  value,
  after() {
    ;(window as any).vditor = editor
    // applyBodyOptions is the SAME call message-router.ts makes on init/config-change with
    // this exact options object — drives the body attrs/vars half of the pair (fullWidth,
    // fontSize) that buildVditorOptions never touches.
    applyBodyOptions(options)
    ;(window as any).__effectiveOutline = {
      enable: editor.vditor.options.outline.enable,
      position: editor.vditor.options.outline.position,
    }
    ;(window as any).__effectiveLineNumber =
      editor.vditor.options.preview.hljs.lineNumber === true
    ;(window as any).__ready = true
  },
})
