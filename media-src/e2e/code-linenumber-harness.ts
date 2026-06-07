import '../src/preload'
import Vditor from 'vditor'
import { buildVditorOptions } from '../src/vditor-options'

// Code-block hljs config harness (line numbers + highlight theme). Drives Vditor
// through the REAL buildVditorOptions (the same option mapping main.ts uses) so the
// spec can prove the `codeLineNumbers` and `codeTheme` settings actually govern the
// rendered code block — INCLUDING the regression class where a stale SAVED
// `preview.hljs.*` value (saveVditorOptions persists the whole preview object)
// shadows the live setting and pins it.
//
// Query params let each test pick a scenario without re-init gymnastics:
//   ?setting=1|0      -> msg.options.codeBlockLineNumbers (the line-number setting)
//   ?codeTheme=NAME   -> msg.options.codeTheme (the highlight theme setting)
//   ?saved=1          -> simulate a saved blob carrying preview.hljs.lineNumber:true
//   ?savedStyle=NAME  -> simulate a saved blob carrying a stale preview.hljs.style
//   ?theme=dark|light -> VS Code theme (default light)
//   ?mode=ir|wysiwyg|sv -> editor mode (default ir)
const params = new URLSearchParams(location.search)
const settingOn = params.get('setting') === '1'
const savedOn = params.get('saved') === '1'
const codeTheme = params.get('codeTheme') || undefined
const savedStyle = params.get('savedStyle') || undefined
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const mode = params.get('mode') || 'ir'

// The webview saves the ENTIRE preview object (utils.ts saveVditorOptions), so a
// past session persists hljs.lineNumber / hljs.style; on the next open the host
// spreads that saved blob into msg.options.
const savedHljs: any = {}
if (savedOn) savedHljs.lineNumber = true
if (savedStyle) savedHljs.style = savedStyle

const options: any = { codeBlockLineNumbers: settingOn }
if (codeTheme) options.codeTheme = codeTheme
if (Object.keys(savedHljs).length > 0) options.preview = { hljs: savedHljs }

const msg: any = {
  cdn: `${location.origin}/vditor`,
  theme,
  options,
}

const opts = buildVditorOptions(msg)

const value = [
  'Intro paragraph before the code.',
  '',
  '```js',
  'const a = 1',
  'const b = 2',
  'const c = 3',
  'const d = 4',
  '```',
  '',
  'Trailing paragraph after the code.',
  '',
].join('\n')

const editor = new Vditor('app', {
  ...opts,
  mode,
  cache: { enable: false },
  value,
  after() {
    ;(window as any).vditor = editor
    // Read the effective options Vditor merged in — lets the spec assert the
    // option mapping independently of async highlight rendering.
    ;(window as any).__effectiveLineNumber =
      editor.vditor.options.preview.hljs.lineNumber === true
    ;(window as any).__effectiveCodeStyle =
      editor.vditor.options.preview.hljs.style
    ;(window as any).__lineNumberCount = () =>
      document.querySelectorAll('.vditor-linenumber__rows').length
    // highlightRender installs the hljs stylesheet <link> from hljs.style — the
    // observable end of "the code theme applied".
    ;(window as any).__hljsHref = () =>
      document.getElementById('vditorHljsStyle')?.getAttribute('href') ?? ''
    ;(window as any).__ready = true
  },
})
