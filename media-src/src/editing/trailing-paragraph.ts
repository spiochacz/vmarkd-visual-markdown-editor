// The trailing-paragraph invariant's SHAPE half: does a trailing paragraph exist after the last
// content block, and where inside it does the caret belong. Split out of gap-paragraph.ts (task
// 472) to break a two-file import cycle: caret.ts's 'document-end' intent needs to ask "where is
// the trailing paragraph" (trailingCaretTarget, below), while gap-paragraph.ts's setupTrailingNav
// needs to ask caret.ts to actually WRITE the Range there (requestCaret) — two independently
// necessary edges pointing at each other. requestCaret's state machine can't move (it's the one
// caret authority every other editing/*.ts file — gap-nav, editor-caret, focus-restore,
// initial-caret, caret-preserve — imports directly; duplicating or relocating it would fork that
// authority), so this file exists as the lower, caret-agnostic layer both sides import from
// instead: it never imports requestCaret or anything else from caret.ts, so caret.ts can import
// FROM here with no back-edge. gap-paragraph.ts still imports requestCaret directly for
// setupTrailingNav's actual placement — that edge is fine on its own; it only cycled because the
// shape logic used to sit next to it in the same file as a mutual import target.
//
// Everything here is pure DOM (a `<p>`'s existence, tag, and text content) — no selection reads
// or writes — which is what makes it unit-testable without a real Range/layout (see
// trailing-paragraph.test.ts) and safe for caret.ts to depend on without inheriting any
// selection-side assumptions.

// Exported: gap-paragraph.ts's isThematicBreakParagraph strips the same zero-width space when
// checking a paragraph's text — one definition of "what a ZWSP looks like here", not two.
export const ZWSP = /​/g

/** Nothing but whitespace and zero-width spaces. */
export const isBlank = (text: string): boolean =>
  text.replace(ZWSP, '').trim() === ''

// An "empty gap" = a paragraph with no element children and no text beyond zero-width spaces
// (Vditor seeds the insert with a ZWSP, and so does makeTrailing below). A `<wbr>` or any inline
// child means it is still mid-edit / holds something, so leave it alone. Shared beyond the
// trailing invariant: gap-paragraph.ts's own leading-block invariant and gap cleanup use this
// same predicate — it moved here with ensureTrailingParagraph because that's what created the
// cycle, not because it is trailing-specific.
export function isEmptyGapParagraph(p: HTMLElement): boolean {
  if (p.childElementCount > 0) return false
  return (p.textContent || '').replace(ZWSP, '').trim() === ''
}

// ---------------------------------------------------------------------------------------
// Trailing paragraph invariant: a document that ENDS with a block (callout, code block,
// table, math, …) must always offer an empty paragraph after it — otherwise there is no
// caret position below the last block at all (arrow-down at end-of-file dropped the
// selection; Vditor's keyup then re-normalised it to the editor start = "screen jumps to
// the top, nowhere to type"). Mirrors ProseMirror's trailing-node plugin. The paragraph is
// tagged data-vmarkd-trailing (attributes are invisible to Lute's serializer, so the
// markdown round-trips unchanged); typing in it strips the tag (it became real content),
// and a stale tagged paragraph that is no longer last (e.g. blocks appended during
// streaming) is garbage-collected while still empty.
export const TRAILING_ATTR = 'data-vmarkd-trailing'
// Marks the trailing paragraph WHILE the caret is inside it. main.css collapses the trailing
// paragraph to zero height unless it carries this class — so the empty EOF escape paragraph is
// invisible until you arrow into it, like the transient gap paragraphs between blocks (which are
// removed when empty). Toggled on selectionchange (`:focus-within` can't see the caret — the
// contenteditable host is an ancestor, not the <p>).
export const TRAILING_ACTIVE_CLASS = 'vmarkd-trailing--active'

// Add/remove TRAILING_ACTIVE_CLASS on the trailing paragraph(s) depending on whether the caret is
// inside. Pure (DOM-only) so it's unit-testable.
export function markTrailingActive(
  editor: HTMLElement,
  caretNode: Node | null,
): void {
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(`:scope > p[${TRAILING_ATTR}]`),
  )) {
    p.classList.toggle(
      TRAILING_ACTIVE_CLASS,
      !!caretNode && p.contains(caretNode),
    )
  }
}

// Which last-child blocks need a trailing paragraph offered below them. Earlier this was a
// whitelist (TABLE / [data-type] / callout) — too narrow: the real editor ends documents in
// blocks that match NONE of those (e.g. a normal blockquote — Vditor's IR processKeydown only
// routes code-blocks/tables through insertAfterBlock, so arrow-down off a quote at EOF had no
// target). Flip to a BLACKLIST: anything that is NOT a plain editable text block (where you can
// already place a caret and type) is "atomic" and needs an escape paragraph below it.
const TEXT_BLOCKS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
])
// "Atomic" = NOT a plain editable text block: a table, code block, front matter, math/html block,
// blockquote/callout, thematic break … You cannot put a caret next to one from the outside, and
// pressing Enter at its edge edits its INSIDE (a code line, a table cell) instead of opening a line
// beside it — so a caret position adjacent to one has to be manufactured. Two consumers: the
// trailing invariant below (a document ENDING in an atomic block needs an escape paragraph) and
// gap-nav.ts (a rule sitting next to an atomic block leaves an unreachable slot between the two).
export const isAtomicBlock = (el: Element): boolean =>
  !TEXT_BLOCKS.has(el.tagName)

// Code blocks are EXCLUDED — no PERSISTENT trailing paragraph after a code block. ArrowDown past a
// code block's end lands the caret in a TRANSIENT paragraph after the closing ``` (Vditor's own
// insertAfterBlock splice), which cleanupGapParagraphs (gap-paragraph.ts) reclaims once the caret
// leaves it empty — so there's a landing on demand but no stray empty block. (The user explicitly
// didn't want a persistent empty block here.) Tables / callouts / math still get the maintained
// escape paragraph.
export const endsWithBlock = (el: Element): boolean =>
  isAtomicBlock(el) &&
  !el.hasAttribute(TRAILING_ATTR) &&
  el.getAttribute('data-type') !== 'code-block'

// A manufactured caret stop between a thematic break and an atomic block (gap-nav.ts). Tagged so
// cleanupGapParagraphs (gap-paragraph.ts) reclaims it once the caret leaves it still empty, exactly
// like Vditor's own transient splices — the neighbours here (a rule, front matter, a table) are
// outside that cleanup's isGapNeighbour set, so the tag is what makes it self-cleaning. Attributes
// are invisible to Lute's serializer, so an untouched gap round-trips to nothing.
export const GAP_ATTR = 'data-vmarkd-gap'

// Both manufactured paragraphs (trailing + gap) carry a ZWSP seed like Vditor's own splices: a
// collapsed Range in a genuinely EMPTY element has a zero-height client rect, so the caret would be
// placed but never painted (task 439).
function makeSeededParagraph(attr: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.setAttribute('data-block', '0')
  p.setAttribute(attr, '')
  p.textContent = '​'
  return p
}

export const makeGapParagraph = (): HTMLParagraphElement =>
  makeSeededParagraph(GAP_ATTR)

// Non-content helpers that live INSIDE the contenteditable IR element but are not document
// blocks — chiefly our own floating table-edit panel (`#fix-table-ir-wrapper`, fix-table-ir.ts),
// a contenteditable=false 0×0 box pinned at top:0/left:0. It is appended as the editor's last
// child, so it lands in the block sibling chain: Vditor's insertAfterBlock then does
// `selectNodeContents(table.nextElementSibling)` INTO it and the caret jumps to the page top.
// The trailing paragraph must sit BETWEEN the last real block and this wrapper so the caret
// lands in the (in-flow, bottom) paragraph instead. Treat such helpers as non-content. Exported:
// gap-paragraph.ts's cleanupGapParagraphs and setupTrailingNav both need the same check.
export const isHelper = (el: Element): boolean =>
  el.id === 'fix-table-ir-wrapper' ||
  (el.getAttribute('contenteditable') === 'false' &&
    (el as HTMLElement).style?.position === 'absolute')

// Skipping EMPTY trailing paragraphs and helper wrappers, the last real CONTENT child. A
// trailing paragraph the user has typed into is content (it's about to lose its tag), so it
// must NOT be skipped — otherwise a fresh trailing p gets wedged above it.
function lastContentChild(editor: HTMLElement): Element | null {
  let el = editor.lastElementChild
  while (
    el &&
    ((el.hasAttribute(TRAILING_ATTR) &&
      isEmptyGapParagraph(el as HTMLElement)) ||
      isHelper(el))
  ) {
    el = el.previousElementSibling
  }
  return el
}

const makeTrailing = (): HTMLParagraphElement =>
  makeSeededParagraph(TRAILING_ATTR)

// Exported pure for tests. Returns true when it changed the DOM.
export function ensureTrailingParagraph(
  editor: HTMLElement,
  caretNode: Node | null,
): boolean {
  let changed = false
  const lastContent = lastContentChild(editor)
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(`:scope > p[${TRAILING_ATTR}]`),
  )) {
    if (!isEmptyGapParagraph(p)) {
      p.removeAttribute(TRAILING_ATTR) // user typed — it's real content now
      changed = true
      continue
    }
    // Keep ONLY the trailing paragraph that sits immediately after the last content block
    // (a helper wrapper may follow it). Any other empty trailing p (blocks streamed in after
    // it, or one stranded after the wrapper) is reclaimed.
    if (
      p.previousElementSibling !== lastContent &&
      !(caretNode && p.contains(caretNode))
    ) {
      // Chromium's native paragraph split (pressing Enter inside `p`) does not copy the
      // TRAILING_ATTR onto the new sibling it creates — so a deliberate Enter-to-add-a-blank-line
      // below the trailing paragraph looked identical to "new content streamed in after it": `p`
      // is no longer immediately before `lastContent`, so it fell into the same removal above and
      // silently ate the blank line (task 486). When the gap is exactly that split — `p`'s very
      // next sibling IS the new last-content, and it's still empty — transfer the role instead of
      // deleting: `p` becomes a normal kept blank line, the new sibling becomes the trailing one.
      // A genuinely stale trailing paragraph (streamed-in REAL content following it) still hits
      // the plain `p.remove()` below, since real content is never `isEmptyGapParagraph`.
      const next = p.nextElementSibling
      if (
        next === lastContent &&
        next instanceof HTMLElement &&
        isEmptyGapParagraph(next)
      ) {
        p.removeAttribute(TRAILING_ATTR)
        next.setAttribute(TRAILING_ATTR, '')
        changed = true
        continue
      }
      p.remove()
      changed = true
    }
  }
  if (lastContent && endsWithBlock(lastContent)) {
    const after = lastContent.nextElementSibling
    if (!after?.hasAttribute(TRAILING_ATTR)) {
      // insert AFTER the last content block — before any helper wrapper, never appendChild
      // (which would strand it after the wrapper and re-expose the jump).
      lastContent.insertAdjacentElement('afterend', makeTrailing())
      changed = true
    }
  }
  return changed
}

// Ensure the trailing paragraph exists and resolve where the caret belongs inside it — WITHOUT
// touching the selection. Pure so it's the shape-owner half of caret.ts's 'document-end' intent
// (ADR-0007 / task 446): the SHAPE decision (does a trailing paragraph exist, is it the RIGHT one)
// lives here; the actual Range write lives in caret.ts. Imported by caret.ts (one direction only —
// see this file's header); gap-paragraph.ts's setupTrailingNav and gap-nav.ts call
// requestCaret('document-end') instead of this directly.
export function trailingCaretTarget(
  editor: HTMLElement,
  caretNode: Node | null,
): { node: Node; offset: number } | null {
  ensureTrailingParagraph(editor, caretNode)
  const p = editor.querySelector<HTMLElement>(`:scope > p[${TRAILING_ATTR}]`)
  if (!p) return null
  const textNode = Array.from(p.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE,
  ) as Text | undefined
  return textNode
    ? { node: textNode, offset: textNode.data.length }
    : { node: p, offset: 0 }
}
