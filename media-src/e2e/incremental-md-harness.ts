import '../src/preload'
import Vditor from 'vditor/src/index'
import { createIncrementalMd } from '../src/incremental-md'
import '../src/utils' // sets window.vscode from the spec's acquireVsCodeApi stub

// Real Vditor (IR) + the task-69 incremental serializer, driven the same way main.ts
// drives it. The spec performs REAL edits (typing, Enter, Backspace, paste) — so the
// DOM comes from Vditor's own SpinVditorIRDOM, the one thing the Node spike could not
// cover — and after each edit compares the incremental markdown to the authoritative
// `editor.getValue()` (full VditorIRDOM2Md). They must be byte-identical.

let editor: Vditor

const incremental = createIncrementalMd((html: string) =>
  (editor as any).vditor.lute.VditorIRDOM2Md(html),
)
const irTopBlocks = (): string[] => {
  const el = (editor as any).vditor.ir.element as HTMLElement
  return Array.from(el.children, (c) => (c as HTMLElement).outerHTML)
}

// Exposed to the spec: recompute incrementally from the live DOM and return both the
// incremental result and the authoritative full serialize for a byte-for-byte compare.
;(window as any).__incrementalVsFull = () => {
  const incr = incremental.update(irTopBlocks())
  const full = editor.getValue()
  return { incr, full, equal: incr === full }
}
;(window as any).__invalidate = () => incremental.invalidate()

editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value: [
    '# Title',
    '',
    'Intro paragraph with **bold** and `code`.',
    '',
    '- one',
    '- two',
    '- three',
    '',
    '> a quote',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'Closing paragraph.',
    '',
  ].join('\n'),
  customWysiwygToolbar: () => {},
  input() {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__ready = true
  },
})
