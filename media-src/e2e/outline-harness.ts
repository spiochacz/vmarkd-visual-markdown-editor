import '../src/preload'
import Vditor from 'vditor'
import { setupOutlineFlash } from '../src/outline'
import { setupOutlineResize } from '../src/outline-resize'

// Real Vditor (IR) with headings + the outline panel enabled on the right, and
// the outline-click flash wired up — mirrors how main.ts sets it for tasks
// 07/08/13. Globals let the spec read/drive the outline and headings.
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
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value,
  outline: { enable: true, position: 'right' },
  customWysiwygToolbar: () => {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    setupOutlineFlash(editor)
    const oel = (editor as any).vditor?.outline?.element as
      | HTMLElement
      | undefined
    if (oel) setupOutlineResize(oel, 'right', () => {})
    ;(window as any).__ready = true
  },
})
