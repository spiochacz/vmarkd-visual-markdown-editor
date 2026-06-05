import '../src/preload'
import Vditor from 'vditor/src/index'
import { createIncrementalMd } from '../src/incremental-md'
import { useIncrementalSerialize } from '../src/edit-sync-tuning'
import '../src/utils' // sets window.vscode from the spec's acquireVsCodeApi stub

// Real Vditor (IR) + the task-69 incremental serializer, driven the same way main.ts
// drives it. The spec performs REAL edits (typing, Enter, Backspace, paste) — so the
// DOM comes from Vditor's own SpinVditorIRDOM, the one thing the Node spike could not
// cover — and after each edit compares the incremental markdown to the authoritative
// `editor.getValue()` (full VditorIRDOM2Md). They must be byte-identical.
//
// `?large=1` seeds a ≥ INCREMENTAL_MIN_BLOCKS document so the real gate
// (`serializeForHost`, mirrored below) routes through the incremental path.

let editor: Vditor

const incremental = createIncrementalMd((html: string) =>
  (editor as any).vditor.lute.VditorIRDOM2Md(html),
)
const irTopBlocks = (): string[] => {
  const el = (editor as any).vditor.ir.element as HTMLElement
  return Array.from(el.children, (c) => (c as HTMLElement).outerHTML)
}

// Mirror of main.ts serializeForHost: gate on block count, incremental when large.
const serializeForHost = (): { md: string; usedIncremental: boolean } => {
  const el = (editor as any).vditor.ir.element as HTMLElement
  const used = useIncrementalSerialize(
    editor.getCurrentMode?.(),
    el.children.length,
  )
  return {
    md: used ? incremental.update(irTopBlocks()) : editor.getValue(),
    usedIncremental: used,
  }
}

// Exposed to the spec: the engine compared directly (bypasses the gate)…
;(window as any).__incrementalVsFull = () => {
  const incr = incremental.update(irTopBlocks())
  const full = editor.getValue()
  return { incr, full, equal: incr === full }
}
// …and the gated path (what the editor actually posts to the host).
;(window as any).__serializeForHost = () => {
  const r = serializeForHost()
  const full = editor.getValue()
  return { ...r, full, equal: r.md === full }
}
;(window as any).__invalidate = () => incremental.invalidate()

const isLarge = new URLSearchParams(location.search).get('large') === '1'
const smallDoc = [
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
].join('\n')
// 800 paragraphs → 800 top-level blocks, comfortably over the gate (700).
const largeDoc = `${Array.from(
  { length: 800 },
  (_, i) => `Paragraph number ${i} with a little text to serialize.`,
).join('\n\n')}\n`

editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value: isLarge ? largeDoc : smallDoc,
  customWysiwygToolbar: () => {},
  input() {},
  after() {
    ;(window as any).vditor = editor
    ;(window as any).vditorTest = editor
    ;(window as any).__ready = true
  },
})
