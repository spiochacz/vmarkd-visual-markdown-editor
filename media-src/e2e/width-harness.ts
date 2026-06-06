import '../src/preload'
import Vditor from 'vditor'
import { applyBodyOptions } from '../src/live-config'

// Narrow-width centring harness (full-width OFF). Mirrors how main.ts drives the
// body-attribute layout: applyBodyOptions sets data-full-width / data-heading-markers,
// which main.css keys off to centre the 800px text column. The spec measures that the
// IR editor, the Preview pane, and markers-on vs markers-off all centre identically
// (equal left/right margins, no Edit↔Preview horizontal shift).
const head = [
  '# First heading',
  '',
  'Paragraph under the first heading with enough text to span a good part of the column so its box width is meaningful to measure.',
  '',
  '## Second heading',
  '',
  'A reference link to [CommonMark][cm] and more body text here.',
  '',
  '[cm]: https://spec.commonmark.org/ "CommonMark spec"',
  '',
]
// Pad the document tall enough to force a vertical scrollbar in BOTH the editor and
// the preview pane — the Edit↔Preview shift is a scrollbar-position artefact, so a
// short doc (no scrollbar) hides it.
const filler: string[] = []
for (let i = 0; i < 80; i++) {
  filler.push(
    `### Section ${i}`,
    '',
    `Body paragraph number ${i} with some text.`,
    '',
  )
}
const value = [...head, ...filler].join('\n')

function setLayout(showHeadingMarkers: boolean) {
  applyBodyOptions({ enableFullWidth: false, showHeadingMarkers })
}

// Start narrow + markers on (the default product state).
setLayout(true)
;(window as any).__setMarkers = (on: boolean) => setLayout(on)

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value,
  // A real Preview toolbar button so the spec can toggle the preview pane.
  toolbar: ['preview'],
  customWysiwygToolbar: () => {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).__ready = true
  },
})
