// Task 255 — "Fix list numbering" (caret's list) / "Renormalize all lists" (whole doc).
//
// The renumbering primitive already exists and is proven correct: list-backspace.ts's
// liftTopLevelItemToParagraph replaces a list's outerHTML with
// vditor.lute.SpinVditorIRDOM/SpinVditorDOM(outerHTML) — a round trip through Lute's own
// markdown parser that renumbers ordered lists as a side effect ("Lute normalizes on spin",
// task 284's probe). This module exposes that same "spin one list root, in place" primitive as
// a user-triggered command, scoped to the LIST BLOCK only (never the whole document's DOM) so
// unrelated content stays byte-identical — and shares it with task 281 (sort), which needs the
// identical renumber-after-reorder step ("build it shareable" per that task's scope note).
//
// ir/wysiwyg only: sv's block-scoping story is different (its DOM only gets split into
// per-paragraph `data-block` divs by local edits — a freshly opened document is ONE div for the
// whole source, per vditor/src/index.ts's setValue) and needs its own measurement before it can
// reuse this module's "spin one root" approach; task 255 tracks that as a follow-up.
import { execAfterRender } from 'vditor/src/ts/util/fixBrowserBehavior'
import { setRangeByWbr } from 'vditor/src/ts/util/selection'

interface VditorLike {
  currentMode: string
  lute: {
    SpinVditorIRDOM: (html: string) => string
    SpinVditorDOM: (html: string) => string
  }
  [mode: string]: unknown
}

// Whether `list` sits directly inside another list (i.e. it's a NESTED sublist, not a
// top-level root) — its `<ul>/<ol>` is inside an `<li>` that itself belongs to an enclosing
// list within `editor`. Shared by findEnclosingListRoot (climb OUT of nesting) and
// collectListRoots (skip anything that isn't already a top-level root).
function parentListOf(
  list: HTMLElement,
  editor: HTMLElement,
): HTMLElement | null {
  const parentLi = list.parentElement?.closest<HTMLElement>('li') ?? null
  if (!parentLi || !editor.contains(parentLi)) return null
  return parentLi.closest<HTMLElement>('ul, ol')
}

/**
 * Walk from `node` up to the OUTERMOST `<ul>/<ol>` enclosing it — crossing every nested-list
 * boundary — stopping at `editor`. Returns null when `node` isn't inside a list at all. Pure DOM
 * logic (no Lute/undo involvement), so it's unit-testable in jsdom on its own — see
 * list-backspace.test.ts's header for why the DOM-MUTATING half of this family isn't.
 */
export function findEnclosingListRoot(
  node: Node | null,
  editor: HTMLElement,
): HTMLElement | null {
  const start =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  if (!start || !editor.contains(start)) return null
  let root = start.closest<HTMLElement>('ul, ol')
  if (!root || !editor.contains(root)) return null
  for (;;) {
    const outer = parentListOf(root, editor)
    if (!outer) break
    root = outer
  }
  return root
}

// Every TOP-LEVEL list root in `editor` — i.e. every `<ul>/<ol>` that is not itself nested
// inside another list (a blockquote- or table-cell-nested list still counts as top-level here;
// only NESTING UNDER ANOTHER LIST excludes it, since that sublist is rewritten as part of its
// parent root's outerHTML spin). querySelectorAll('ul, ol') rather than a `:scope >` child
// selector — a top-level list can sit inside a blockquote/callout, not just directly in editor.
function collectListRoots(editor: HTMLElement): HTMLElement[] {
  return Array.from(editor.querySelectorAll<HTMLElement>('ul, ol')).filter(
    (list) => !parentListOf(list, editor),
  )
}

export function spinFor(vditor: VditorLike): (html: string) => string {
  return vditor.currentMode === 'wysiwyg'
    ? vditor.lute.SpinVditorDOM.bind(vditor.lute)
    : vditor.lute.SpinVditorIRDOM.bind(vditor.lute)
}

/**
 * Re-serialize ONE list root through Lute, in place — the primitive both commands below use, and
 * that task 281's post-sort renumbering is meant to reuse once it exists (not exported yet: knip
 * flags an export nothing outside this file imports — 281 can re-export the day it actually
 * consumes it). Caller owns caret placement (insert a `<wbr>` into `root` before calling, if a
 * caret needs to survive the swap); this only performs the spin.
 */
function normalizeListRoot(vditor: VditorLike, root: HTMLElement): void {
  const spin = spinFor(vditor)
  root.outerHTML = spin(root.outerHTML)
}

/**
 * Re-spin `root` (renumbering every level) keeping the caret at `range` via a `<wbr>`, as ONE undo
 * step. Shared by the "Fix list numbering" command below and list-backspace.ts (task 525: after an
 * empty item is removed or a typed marker converts an item). A null `root` only re-places the caret.
 */
export function respinListAtRange(
  vditor: VditorLike,
  root: HTMLElement | null,
  range: Range,
  editor: HTMLElement,
): void {
  range.insertNode(document.createElement('wbr'))
  if (root) normalizeListRoot(vditor, root)
  setRangeByWbr(editor, range)
  execAfterRender(vditor as never)
}

/**
 * Command "Fix list numbering" — normalize the list enclosing the caret. Returns false
 * (no-op, nothing to undo) when the caret isn't inside a list.
 */
export function fixListNumberingAtCaret(
  vditor: VditorLike,
  editor: HTMLElement,
): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return false
  const root = findEnclosingListRoot(range.startContainer, editor)
  if (!root) return false
  respinListAtRange(vditor, root, range, editor)
  return true
}

/**
 * Command "Renormalize all lists" — normalize every top-level list in the document. Returns the
 * number of list roots touched (0 = no-op, nothing to undo). One undo step regardless of how
 * many roots changed: Vditor's undo stack snapshots the whole editor once per execAfterRender()
 * call, not once per DOM mutation, so batching every spin before the single call at the end
 * records exactly one entry.
 */
export function fixAllListNumbering(
  vditor: VditorLike,
  editor: HTMLElement,
): number {
  const roots = collectListRoots(editor)
  if (roots.length === 0) return 0
  const sel = window.getSelection()
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const caretRoot =
    range && editor.contains(range.startContainer)
      ? findEnclosingListRoot(range.startContainer, editor)
      : null
  // Insert the wbr BEFORE reading caretRoot.outerHTML (below) — normalizeListRoot reads
  // outerHTML at call time, so the marker must already be in the tree by then.
  if (caretRoot && range) range.insertNode(document.createElement('wbr'))
  for (const root of roots) {
    if (root === caretRoot) continue
    normalizeListRoot(vditor, root)
  }
  if (caretRoot) normalizeListRoot(vditor, caretRoot)
  if (caretRoot && range) setRangeByWbr(editor, range)
  execAfterRender(vditor as never)
  return roots.length
}
