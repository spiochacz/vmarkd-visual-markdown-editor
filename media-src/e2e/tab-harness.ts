import '../src/preload'
import Vditor from 'vditor/src/index'

// Real Vditor (IR) configured like main.ts for the Tab fix: `tab` set so Tab is
// captured (indents/inserts) instead of escaping focus to the host iframe and
// scrolling the view. A `?tab=off` variant omits it to show the pre-fix escape.
const withTab = new URLSearchParams(location.search).get('tab') !== 'off'

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value: ['a paragraph', '', 'second paragraph'].join('\n'),
  ...(withTab ? { tab: '\t' } : {}),
  customWysiwygToolbar: () => {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__ready = true
  },
})
