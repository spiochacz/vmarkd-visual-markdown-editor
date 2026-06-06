import '../src/preload'
import Vditor from 'vditor'
import { setupSplitScrollSync } from '../src/split-scroll-sync'

// Split-view scroll sync harness. Creates Vditor in SV mode with preview.mode
// "both" (source + preview side-by-side) and enough headings to scroll.
// The spec scrolls the source pane and verifies the preview follows.

const sections: string[] = ['# Document title', '']
for (let i = 1; i <= 30; i++) {
  sections.push(
    `## Section ${i}`,
    '',
    `Paragraph under section ${i}. `.repeat(6),
    '',
  )
}
const value = sections.join('\n')

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'sv',
  cdn: `${location.origin}/vditor`,
  value,
  preview: { mode: 'both' },
  height: '100%',
  after() {
    ;(window as any).vditor = editor
    setupSplitScrollSync()
    ;(window as any).__ready = true
  },
})
