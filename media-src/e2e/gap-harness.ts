// Harness for the self-cleaning gap paragraph (arrow nav between adjacent blocks).
// Real Vditor (IR, from source so our patches apply) laid out blockquote↔code↔blockquote,
// with observeGapParagraphs wired exactly as main.ts does. The spec drives real arrow keys
// and asserts that the empty paragraph Vditor splices on arrow self-cleans on pass-through,
// while typed content is kept.
import Vditor from 'vditor/src/index'
import { observeGapParagraphs } from '../src/gap-paragraph'

const FENCE = '```'
const value = `> quote above\n\n${FENCE}js\nconst a = 1\n${FENCE}\n\n> quote below\n`

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  height: 500,
  cdn: `${location.origin}/vditor`,
  value,
  after() {
    const ir = (editor as any).vditor.ir.element as HTMLElement
    observeGapParagraphs(() => ir)
    ;(window as any).vditor = editor
    ;(window as any).__el = () => ir
    ;(window as any).__ready = true
  },
})
