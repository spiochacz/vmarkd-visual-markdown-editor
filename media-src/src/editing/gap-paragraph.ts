// Self-cleaning "gap" paragraph for IR navigation between adjacent blocks.
//
// Vditor's insertAfterBlock/insertBeforeBlock (util/fixBrowserBehavior.ts) splice an empty
// `<p>` when you arrow off a block toward an adjacent CODE block — so you CAN type between
// two otherwise-touching blocks (e.g. blockquote↔code or code↔code, which have no editable
// paragraph between them). That insert is wanted when you mean to write, but pure navigation
// then litters the document with empty paragraphs (blank markdown lines) and visible gaps
// that "accumulate" as you arrow around.
//
// Fix: KEEP the insert (so typing between blocks works) but reclaim it lazily — once the
// caret LEAVES such a paragraph while it is still empty, it was only navigation, so drop it.
// An empty `<p>` sitting next to a code block is never real content (markdown has no empty
// paragraphs), so this only ever removes Vditor's transient inserts; the moment the user
// types, the `<p>` holds content and is kept (becomes a normal paragraph).
//
// The trailing-paragraph invariant's SHAPE (does one exist, where inside it does the caret
// belong — ensureTrailingParagraph / trailingCaretTarget) now lives in trailing-paragraph.ts
// (task 472, split out of this file): this file's setupTrailingNav needs requestCaret from
// caret.ts to actually MOVE the caret there, and caret.ts's 'document-end' intent needs the
// shape functions — that used to be a two-file import cycle (this file <-> caret.ts).
// trailing-paragraph.ts is the lower layer both this file and caret.ts import from, and it
// imports from neither — this file -> caret.ts (requestCaret) and caret.ts ->
// trailing-paragraph.ts no longer point at each other. See trailing-paragraph.ts's own header
// for the full breakdown of what moved and why.
import {
  GAP_ATTR,
  ZWSP,
  endsWithBlock,
  ensureTrailingParagraph,
  isEmptyGapParagraph,
  markTrailingActive,
  TRAILING_ATTR,
} from './trailing-paragraph'
import { requestCaret } from './caret'
// caretLineRect/topLevelBlock: pure geometry shared with callout-nav.ts and gap-nav.ts (task 473
// — these three used to each carry their own copy; see nav-geometry.ts's header for why they
// moved and why the surrounding handler shape did not).
import { caretLineRect, topLevelBlock } from './nav-geometry'

// A markdown thematic-break marker: 3+ of one of `-`/`*`/`_`, optional spaces between/around
// (`---`, `***`, `___`, `- - -`). Adjacent top-level `<p>` elements are blank-line-separated in the
// source, so a lone `<p>--- </p>` always serialises as a thematic break (never a setext underline —
// that would already be an `<h2>`).
const THEMATIC_BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/

// A "lone thematic-break paragraph" = a `<p>` whose only content is a thematic-break marker (no
// element children → no `<wbr>`/inline = not mid-edit). Lute's full open-render turns `---` into
// `<hr>`, but the block-scoped SpinVditorIRDOM does NOT promote the LAST such paragraph (nothing
// follows it to force a block boundary), so it lingers as editable `--- ` source forever. Task 100.
export function isThematicBreakParagraph(el: Element): boolean {
  if (el.tagName !== 'P' || el.childElementCount > 0) return false
  return THEMATIC_BREAK.test((el.textContent || '').replace(ZWSP, ''))
}

// Promote lone thematic-break paragraphs the caret has LEFT to real `<hr>` elements, so a `---`
// typed under another `---` (or at end-of-file) actually renders as a rule instead of staying as
// literal `--- ` text. Lute serialises `<hr>` back to `---`, so the markdown round-trips; the focused
// paragraph is left as editable source (only promote when the caret is elsewhere). The trailing
// invariant then offers an escape paragraph below the new rule (endsWithBlock treats `<hr>` as
// atomic). Pure DOM → unit-testable. Returns true if it changed anything. Task 100.
export function promoteThematicBreaks(
  editor: HTMLElement,
  caretNode: Node | null,
): boolean {
  let changed = false
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(':scope > p'),
  )) {
    if (caretNode && p.contains(caretNode)) continue
    if (!isThematicBreakParagraph(p)) continue
    const hr = editor.ownerDocument.createElement('hr')
    hr.setAttribute('data-block', '0')
    p.replaceWith(hr)
    changed = true
  }
  return changed
}

// True when `p` reaches the caret through an unbroken run of sibling `<p>` elements (empty ones,
// terminating in the one that actually holds the caret). Task 486: distinguishes a chain of blank
// lines the user is actively building with Enter from a single stale navigation splice — walking
// OFF the chain (a non-`<p>`, or an empty `<p>` that doesn't lead anywhere) means `p` is not part
// of whatever the caret is doing right now.
function gapChainReachesCaret(p: HTMLElement, caretNode: Node | null): boolean {
  if (!caretNode) return false
  let n = p.nextElementSibling
  while (n && n.tagName === 'P') {
    if (n.contains(caretNode)) return true
    if (!isEmptyGapParagraph(n as HTMLElement)) return false
    n = n.nextElementSibling
  }
  return false
}

// Remove transient empty gap paragraphs the caret has moved away from. Exported pure so it
// can be unit-tested with a plain DOM. Only touches `<p>` that (a) is empty, (b) does not
// hold the caret, (c) has a code-block neighbour, and (d) is not the trailing paragraph
// (kept so there's always a place to type after the last block).
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reclaims transient gap paragraphs against the (a)-(d) exclusion set above; pre-existing (task 469 baseline)
export function cleanupGapParagraphs(
  editor: HTMLElement,
  caretNode: Node | null,
): void {
  // A gap neighbour = a block Vditor splices an empty paragraph against: a code block, or a
  // callout (the fixCalloutArrowNav patch adds `data-callout` to Vditor's splice set so you can
  // type between two adjacent callouts too).
  const isGapNeighbour = (el: Element | null) =>
    !!el &&
    (el.getAttribute('data-type') === 'code-block' ||
      (el.tagName === 'BLOCKQUOTE' && el.hasAttribute('data-callout')))
  for (const p of Array.from(
    editor.querySelectorAll<HTMLElement>(':scope > p'),
  )) {
    if (!isEmptyGapParagraph(p)) continue
    if (caretNode && p.contains(caretNode)) continue
    if (p.hasAttribute(TRAILING_ATTR)) continue // maintained by the trailing invariant
    if (p.hasAttribute(LEADING_ATTR)) continue // maintained by the leading invariant (task 446)
    // `p` reaches the caret through an unbroken run of empty paragraphs (task 486): the user is
    // SPLITTING it via repeated Enter, building deliberate blank lines below a callout/code-block —
    // not Vditor's transient arrow-navigation splice (which is a lone insert; navigating past it
    // lands the caret in a REAL block, breaking the chain). Without this, `endsWithBlock` being
    // false for plain paragraphs means no replacement trailing paragraph gets created either, so
    // each Enter reclaimed the one before it and the paragraph count — and the caret — never
    // visually descended past the line right after the callout/code-block.
    // Hoisted above the branches below (it used to sit between them) so it also protects an
    // Enter-built chain starting in one of OUR hr-adjacent gaps, which is reclaimed right after.
    // No-op for the `!next` branch: with nothing after `p` the chain walk can't reach the caret.
    if (gapChainReachesCaret(p, caretNode)) continue
    // Our own splice between a thematic break and an atomic block (gap-nav.ts). Its neighbours (a
    // rule, front matter, a table) are outside isGapNeighbour's set, so the tag is what makes it
    // self-cleaning — same "transient unless typed into" contract as Vditor's own inserts.
    if (p.hasAttribute(GAP_ATTR)) {
      p.remove()
      continue
    }
    const prev = p.previousElementSibling
    const next = p.nextElementSibling
    if (!next) {
      // Last paragraph (nothing after it). Normally kept — BUT the transient landing Vditor
      // splices when you ArrowDown past the END of a code block (so the caret gets a spot AFTER
      // the closing ```), once the caret moves on, is reclaimed here: a
      // code block at EOF must not keep a stray empty paragraph (the user wants no extra empty
      // block; code is excluded from the persistent trailing invariant — see endsWithBlock).
      // Callouts/tables keep their trailing paragraph (maintained, serializer-invisible).
      if (prev?.getAttribute('data-type') === 'code-block') p.remove()
      continue
    }
    if (!isGapNeighbour(prev) && !isGapNeighbour(next)) continue
    p.remove()
  }
}

// ---------------------------------------------------------------------------------------
// Leading-block invariant: the document must always offer AT LEAST ONE editable block — the
// mirror of the trailing-paragraph invariant (trailing-paragraph.ts), and the fix for task 439 (a
// caret placed before any block existed anchored on the bare editable, which is UNPAINTABLE: a
// collapsed Range in an empty container reports a zero-height client rect — "the caret flashed
// and disappeared").
// Deliberately narrower than a full mirror of endsWithBlock (task 446 Part 1): only a genuinely
// EMPTY editable (zero element children — measured to be how Vditor leaves a blank document until
// the user types; see initial-caret.ts's former ensureFirstBlock, now deleted) gets a manufactured
// block. A document that already starts with SOME block (even an atomic one like a code block)
// already offers a typeable position inside it, so there is nothing to invent — and inventing one
// there would visibly add a blank line above the user's first block on every open, which 439 never
// measured as necessary. Caret code no longer reasons about document shape at all — see caret.ts's
// 'document-start' intent, which now simply assumes a first block exists.
const LEADING_ATTR = 'data-vmarkd-leading'

// Exported pure for tests. Returns true when it changed the DOM. Re-asserted on every rebuild by
// observeTrailingParagraph's run() below (same MutationObserver, same lifecycle as the trailing
// invariant — one observer, not two, per task 446's Stage 1 note).
export function ensureLeadingBlock(editor: HTMLElement): boolean {
  let changed = false
  // A leading paragraph the user has typed into is real content now — drop the tag so it's never
  // mistaken for the manufactured seed again (mirrors ensureTrailingParagraph's same rule).
  const tagged = editor.querySelector<HTMLElement>(
    `:scope > p[${LEADING_ATTR}]`,
  )
  if (tagged && !isEmptyGapParagraph(tagged)) {
    tagged.removeAttribute(LEADING_ATTR)
    changed = true
  }
  if (editor.childElementCount === 0) {
    const p = document.createElement('p')
    p.setAttribute('data-block', '0')
    p.setAttribute(LEADING_ATTR, '')
    p.textContent = '​' // ZWSP seed — Lute drops it, so an empty file stays empty on disk.
    editor.appendChild(p)
    changed = true
  }
  return changed
}

// Keep the invariant as the editor re-renders (Vditor rebuilds the IR DOM on every edit,
// dropping our model-less paragraph — re-add it). rAF-debounced; idempotent (a run that
// changes nothing schedules nothing → no observer loop). Returns a disposer.
//
// `root` is what the MutationObserver watches; `getEditor` resolves, on every run, WHICH element the
// invariant is asserted on. finish-init.ts passes the stable `#app` and a lazy block-mode getter so the
// invariant follows a toolbar mode switch (no re-init) and is a no-op in sv (null: sv saves its pane's
// textContent, a manufactured ZWSP paragraph would land in the file). Default = `root` itself.
export function observeTrailingParagraph(
  root: HTMLElement | null | undefined,
  getEditor: () => HTMLElement | null | undefined = () => root,
): () => void {
  // No root mounted yet — nothing to observe; hand back a no-op
  // disposer so callers can always call the returned teardown unconditionally.
  if (!root)
    return () => {
      /* no-op disposer */
    }
  let raf = 0
  const run = () => {
    raf = 0
    const editorEl = getEditor()
    if (!editorEl) return
    const sel = window.getSelection()
    const caret = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
    // Leading BEFORE trailing: on a genuinely empty editor this settles the whole shape in one
    // pass (the manufactured leading <p> is itself the last-content block, so trailing correctly
    // sees a TEXT_BLOCKS tag and adds nothing) instead of needing a second run() to catch up.
    ensureLeadingBlock(editorEl)
    ensureTrailingParagraph(editorEl, caret)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(run)
  }
  const obs = new MutationObserver(schedule)
  obs.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  run()
  return () => {
    obs.disconnect()
    if (raf) cancelAnimationFrame(raf)
  }
}

// ---------------------------------------------------------------------------------------
// Trailing-paragraph NAVIGATION (the "mover"). trailing-paragraph.ts's ensureTrailingParagraph
// guarantees a paragraph EXISTS after the last block, but nothing MOVES the caret into it: at
// end-of-file the native ArrowDown from inside a special block (code/callout/table) drops the
// selection, and Vditor's keyup (expandMarker(getEditorRange())) then re-normalises the lost
// selection to the editor START — the "screen jumps to the top, nowhere to type" bug. So we
// actively place the caret in the trailing paragraph ourselves (via caret.ts's requestCaret) and
// stop Vditor's keyup from running.
//
// Two-layer, mirroring callout-nav: pre-empt on KEYDOWN where the geometry is certain (caret
// on the block's bottom line) so nothing ever paints a skip, and a geometry-free KEYUP net
// for whatever keydown couldn't predict (selection dropped, caret normalised to the top, or
// the native move did nothing). Both bypass Vditor entirely for the EOF case.

// `block` is the last CONTENT block when nothing follows it except trailing paragraph(s).
function isLastContentBlock(block: HTMLElement): boolean {
  let n = block.nextElementSibling
  while (n) {
    if (!(n instanceof HTMLElement)) return false
    if (!n.hasAttribute(TRAILING_ATTR)) return false
    n = n.nextElementSibling
  }
  return true
}

export function setupTrailingNav(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  let snap: {
    block: HTMLElement
    container: Node
    offset: number
    y: number | null // caret line bottom at keydown — to tell a real line-descent apart
  } | null = null

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ArrowUp/Down-across-a-gap-paragraph snapshot/guard logic; pre-existing (task 469 baseline)
  const onKeydown = (e: KeyboardEvent) => {
    snap = null
    if (
      e.key !== 'ArrowDown' ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return
    }
    const editor = getEditor()
    const sel = window.getSelection()
    if (!editor || !sel?.rangeCount || !sel.isCollapsed) return
    const r = sel.getRangeAt(0)
    if (!editor.contains(r.startContainer)) return
    const block = topLevelBlock(editor, r.startContainer)
    if (!block) return
    // already in the trailing paragraph — nothing below it.
    if (block.hasAttribute(TRAILING_ATTR)) return
    if (!endsWithBlock(block) || !isLastContentBlock(block)) return
    const cr = caretLineRect(r)
    snap = {
      block,
      container: r.startContainer,
      offset: r.startOffset,
      y: cr ? cr.bottom : null,
    }
    if (!cr) return // unmeasurable — defer to the keyup net
    const br = block.getBoundingClientRect()
    const tol = Math.max(cr.height * 0.8, 8)
    const onBottom = br.bottom - cr.bottom <= tol
    if (!onBottom) return // not on the last visual line yet — let it move down inside
    if (requestCaret('document-end')) {
      e.preventDefault()
      e.stopImmediatePropagation()
      snap = null
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: re-applies the pre-move snapshot then places the caret past the reclaimed gap paragraph; pre-existing (task 469 baseline)
  const onKeyup = (e: KeyboardEvent) => {
    const s = snap
    snap = null
    if (!s || e.key !== 'ArrowDown') return
    const editor = getEditor()
    if (!editor?.isConnected) return
    const sel = window.getSelection()
    const r = sel?.rangeCount ? sel.getRangeAt(0) : null

    if (r && editor.contains(r.startContainer)) {
      const tb = topLevelBlock(editor, r.startContainer)
      if (tb?.hasAttribute(TRAILING_ATTR)) return // native already landed in trailing — ok
      if (tb === s.block) {
        // Still in the same block. Did the caret actually DESCEND a line? If yes it was a
        // normal inner-line move — leave it. If not (stuck at the same offset, OR the browser
        // only slid it to the end of the SAME line — common in a blockquote at EOF where there
        // is no line below), it failed to exit downward → push it into the trailing paragraph.
        const now = caretLineRect(r)
        const sameSpot =
          r.startContainer === s.container && r.startOffset === s.offset
        // descended a measurable line → real inner move; otherwise (or unmeasurable +
        // exactly stuck) → failed to exit downward.
        const shouldPlace =
          s.y != null && now ? now.bottom <= s.y + 3 : sameSpot
        if (shouldPlace && requestCaret('document-end'))
          e.stopImmediatePropagation()
        return
      }
      // caret in a DIFFERENT block: only a backward jump (to the top) is a failure.
      if (
        tb &&
        s.block.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_PRECEDING
      ) {
        if (requestCaret('document-end')) e.stopImmediatePropagation()
      }
      return
    }
    // selection lost or thrown outside the editor → the EOF drop. Restore into trailing.
    if (requestCaret('document-end')) e.stopImmediatePropagation()
  }

  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('keyup', onKeyup, true)
  return () => {
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('keyup', onKeyup, true)
  }
}

// Wire the cleanup to selection changes (covers arrow nav, clicks, programmatic moves).
// Debounced to one run per animation frame so it runs AFTER Vditor's own handlers settle
// the selection, and never re-enters (removing a caret-less node fires no selectionchange).
// Returns a disposer. Reads the active editor lazily so it survives editor re-inits.
export function observeGapParagraphs(
  getEditor: () => HTMLElement | null | undefined,
): () => void {
  let scheduled = false
  const onSelectionChange = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      const editor = getEditor()
      if (!editor) return
      const sel = window.getSelection()
      const caret = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
      // Render a `---` the caret has left as an actual <hr> (the block-scoped re-spin won't promote
      // the last one — see promoteThematicBreaks). The trailing-paragraph observer then offers an
      // escape line below the new rule.
      promoteThematicBreaks(editor, caret)
      cleanupGapParagraphs(editor, caret)
      // Reveal the trailing paragraph only while the caret is inside it.
      markTrailingActive(editor, caret)
    })
  }
  document.addEventListener('selectionchange', onSelectionChange)
  return () =>
    document.removeEventListener('selectionchange', onSelectionChange)
}
