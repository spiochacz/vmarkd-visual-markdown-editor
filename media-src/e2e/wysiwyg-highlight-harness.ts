import '../src/preload'
// Source import so any wysiwyg/input + processCode patches are applied.
import Vditor from 'vditor/src/index'
import {
  ensureHljsLoaded,
  observeWysiwygCodeHighlight,
  wrapLuteFlatten,
} from '../src/wysiwyg-code-highlight'

// Real Vditor (WYSIWYG) wired with the live code highlighter, exactly as main.ts wires it. The
// spec drives keystrokes into a code block and asserts that (a) hljs token spans appear in the
// editable source while editing, (b) getValue() stays byte-clean despite the spans (the Lute-flatten
// guard), and (c) the spans clear when the caret leaves the block.
const cdn = `${location.origin}/vditor`
const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'wysiwyg',
  cdn,
  value: 'text before\n\n```js\nconst a = 1\n```\n\ntext after\n',
  preview: { hljs: { style: 'github', lineNumber: false } },
  customWysiwygToolbar: () => {},
  after() {
    ;(window as any).vditor = editor
    wrapLuteFlatten(editor)
    ensureHljsLoaded(cdn)
    const dispose = observeWysiwygCodeHighlight(
      document.getElementById('app'),
      () => (window as any).hljs,
    )
    ;(window as any).__disposeHighlight = dispose
    // The editable code source of the first code block (where keystrokes land in the spec).
    ;(window as any).__codeSource = () =>
      document.querySelector(
        '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre > code',
      )
    // hljs token classes currently present in the editable source (full-fidelity spans).
    ;(window as any).__sourceTokenClasses = () =>
      Array.from(
        document.querySelectorAll(
          '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre > code span[class^="hljs-"]',
        ),
      ).map((s) => (s as HTMLElement).className)
    ;(window as any).__getValue = () => editor.getValue()
    ;(window as any).__ready = true
  },
})
