// Which boundaries between blocks have NO reachable caret position — the rule half of task 292's
// gap cursor, kept free of layout, selection and events so the whole matrix is unit-testable
// against plain DOM strings (gap-boundary.test.ts). The movers live elsewhere: gap-nav.ts (arrows)
// and gap-click.ts (a click that missed every block) ask this module where a caret stop has to be
// manufactured, then splice the transient `data-vmarkd-gap` paragraph and place the caret.
//
// Why a real paragraph and not a ProseMirror-style drawn gap caret: in this codebase "where the
// caret is" IS a DOM Range — caret.ts (ADR-0007) re-asserts a {node, offset} intent every frame and
// focus-restore / caret-preserve / the undo restore all read a Range. A drawn caret would add a
// second kind of caret every one of them would have to learn about, and Vditor's per-keyup
// `expandMarker(getEditorRange())` normalises a selection that is "nowhere" to the editor start —
// the jump-to-top of tasks 439/446/490. See task 292 for the full decision record.
import { isAtomicBlock } from './trailing-paragraph'

export interface Boundary {
  // The blocks on either side; null means the start / end of the document.
  before: HTMLElement | null
  after: HTMLElement | null
  needsGap: boolean
}

const atomicOrNull = (el: HTMLElement | null): boolean =>
  !el || isAtomicBlock(el)

// A boundary needs a manufactured caret stop only when NOTHING ELSE can reach it (task 292
// decision 4 — deliberately NOT ProseMirror's "every boundary with no text position"). A plain
// editable text block on either side already offers one: Enter at the end of the block above, or at
// the start of the block below, opens a line exactly there. Two atomic blocks — or an atomic block
// against the edge of the document — offer nothing: Enter inside a code fence adds a code line,
// Enter inside front matter edits the YAML, and a `<hr>` has no text node at all.
export const needsGap = (
  before: HTMLElement | null,
  after: HTMLElement | null,
): boolean => atomicOrNull(before) && atomicOrNull(after)

// The document's blocks, in order.
export const contentBlocks = (editor: HTMLElement): HTMLElement[] =>
  Array.from(editor.children) as HTMLElement[]

// Every boundary in document order: before the first block, between each pair, after the last.
// Complete on purpose — the END boundary is included even though the arrow mover skips it (the
// trailing invariant owns that one, see task 292's ownership note); a rule that silently omitted a
// boundary would be a rule you cannot check against the matrix.
export function boundaries(editor: HTMLElement): Boundary[] {
  const blocks = contentBlocks(editor)
  const out: Boundary[] = []
  for (let i = 0; i <= blocks.length; i++) {
    const before = blocks[i - 1] ?? null
    const after = blocks[i] ?? null
    out.push({ before, after, needsGap: needsGap(before, after) })
  }
  return out
}

// The boundary immediately on `block`'s `down` side — what an arrow key leaving that block reaches
// first. Returns null when `block` is not a content child of `editor`.
export function boundaryToward(
  editor: HTMLElement,
  block: HTMLElement,
  down: boolean,
): Boundary | null {
  const blocks = contentBlocks(editor)
  const i = blocks.indexOf(block)
  if (i < 0) return null
  const before = down ? block : (blocks[i - 1] ?? null)
  const after = down ? (blocks[i + 1] ?? null) : block
  return { before, after, needsGap: needsGap(before, after) }
}
