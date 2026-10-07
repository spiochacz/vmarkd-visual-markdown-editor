// ADR-0007 / task 446 — the caret authority: every PROGRAMMATIC selection write goes through
// requestCaret() instead of a module hand-rolling its own getSelection()/addRange().
//
// A request is a declarative INTENT ("the caret belongs at X"), not a one-shot Range write. Vditor
// rebuilds the IR/WYSIWYG DOM on every edit — and creates some structure LAZILY (an empty
// document's editable has zero element children until the user types) — so a Range written once is
// a bet the DOM won't change under it. Task 439 shipped exactly that bet lost: a Range that was
// collapsed, in the right container, at the right offset, and completely INVISIBLE, because it
// anchored on an empty container and a collapsed Range in an empty container has a ZERO-HEIGHT
// client rect. Three test layers passed against that build because all three asked "is the Range
// there?" and none asked "can a caret be drawn?" — see initial-caret.test.ts / caret-on-open.spec.ts.
//
// So an intent stays ARMED — re-resolved and re-written on every animation frame — until it is
// CONSUMED (placed and currently paintable for MAX_TOTAL_TICKS, nothing has since invalidated it —
// consuming does not un-place the Range, it only stops the background re-polling once a position
// has held for long enough that nothing legitimate is still going to move it) or INVALIDATED (a
// real user gesture: keydown, pointerdown, beforeinput, or compositionstart — decision 3) or bound
// to an editor that no longer exists (a re-init or mode switch swapped it out, WITH or without a
// gesture — see tick()'s identity check). Invalidation fails OPEN: on any doubt, drop the intent
// rather than fight the user. A caret that overrides where the user just moved, or writes into a
// DIFFERENT document than the one it was armed against, is strictly worse than the flash-and-vanish
// bug this module exists to close.
import { clamp } from '../../../src/shared/clamp'
import { activeModeElement } from '../util/source-map'
// trailing-paragraph.ts, not gap-paragraph.ts directly (task 472): trailingCaretTarget used to
// live in gap-paragraph.ts, which also imports requestCaret (below) from this file — a two-file
// cycle. It moved to the lower, caret-agnostic layer both files import from; see that file's
// header for the full breakdown.
import { isEmptyGapParagraph, trailingCaretTarget } from './trailing-paragraph'
import { isHostFindOpen } from './host-find'

type CaretIntent =
  // The very start of the first block (task 439). gap-paragraph.ts's leading-block invariant
  // (task 446 Part 1) guarantees a first block always exists — this module does not create one.
  | 'document-start'
  // The EOF trailing paragraph (gap-paragraph.ts's own trailing-nav net, gap-nav.ts's step-past-a-
  // rule fallback). gap-paragraph.ts owns creating the paragraph; this only asks where inside it.
  | 'document-end'
  // An exact DOM position the caller has already computed (hr step-across onto a specific block).
  | { node: Node; offset: number }
  // A character offset into the editor's TEXT, not a node — the one intent kind a {node, offset}
  // pair cannot express: after a full `setValue()` rebuild (caret-preserve.ts, Vditor #1912) every
  // old node is gone, so only a character offset survives to re-resolve against the fresh DOM.
  | { textOffset: number }
  // A STRUCTURAL position — a PATH of child indices from the editable down to the element that
  // directly holds the caret, plus M characters into THAT element's text.
  // Task 487: `{ textOffset }` is blind to element boundaries (`Range.toString()` skips them), so it
  // cannot address an EMPTY block at all — an empty <p>/<li> contributes zero characters, making
  // "end of block N" and "inside the empty block N+1" the same number on BOTH the capture and the
  // resolve side. That is exactly a freshly Enter-split blank line, which is why Vditor's undo
  // checkpoint (patchUndoCaretSplitRestore, esbuild-shared.mjs) used to yank the caret back to the
  // end of the previous line ~800ms after every Enter. Naming the block removes the ambiguity by
  // construction: an empty element is `{ blockPath: [...N], offsetInBlock: 0 }`, a different value
  // from the end of the one before it. Valid only where capture and restore see the same tree — true
  // for the undo path (the wbr `insertNode` splits a text node in place, it never reorders elements),
  // not for caret-preserve.ts's `setValue()` rebuild of CHANGED host content, which keeps using
  // `{ textOffset }` because indices are not stable across it.
  //
  // A path, not a single top-level index: inside a list the top-level block is the `<ul>`, so a
  // top-level index put every `<li>` back into one shared character space and reproduced the exact
  // same ambiguity one level down — measured in the real webview, the caret still snapped back on
  // Enter inside a list. Bottoming out at the caret's own element is the granularity at which
  // "empty" is finally unambiguous.
  //
  // `breaksBefore` (task 530): the number of `<br>` elements before the caret inside that element. A hard
  // break holds no characters, so "after the break" and "before the break" are the SAME character offset;
  // without it the undo checkpoint put the caret back before a just-made Shift+Enter break and the next
  // typed character landed on the old line, losing the break.
  | { blockPath: number[]; offsetInBlock: number; breaksBefore?: number }

interface Target {
  node: Node
  offset: number
}

// Injectable ONLY for unit tests: jsdom has no layout engine at all — Range.getBoundingClientRect
// doesn't even EXIST there (throws, not "returns zero") — so the "is this position paintable"
// branch (the actual regression 439 shipped, see the file header) is otherwise untestable without
// a real webview. Wrapped in its own try/catch so a missing/throwing implementation degrades to
// "not paintable" rather than being mistaken for a failed WRITE by tryPlace's outer catch below.
const measureHeight = (range: Range): boolean => {
  try {
    return range.getBoundingClientRect().height > 0
  } catch {
    return false
  }
}
let isPaintable = measureHeight
export function setCaretPaintabilityProbeForTests(
  probe: (range: Range) => boolean,
): void {
  isPaintable = probe
}
function resetCaretPaintabilityProbeForTests(): void {
  isPaintable = measureHeight
}

// First text node under `root`, depth-first. Ported from initial-caret.ts (task 439) — Stage 1
// moved "does a first block exist" to gap-paragraph.ts; this is only "where inside it".
function firstTextNode(root: Node): Text | null {
  return document
    .createTreeWalker(root, NodeFilter.SHOW_TEXT)
    .nextNode() as Text | null
}

// A flat character offset cannot distinguish "end of this text" from "start of an immediately
// following EMPTY block" (P/LI/…) — an empty block contributes zero characters either way. Task
// 486: this is exactly what a freshly Enter-split blank line looks like the INSTANT it's created —
// even the CAPTURE side (patchUndoCaretSplitRestore's undo-checkpoint snapshot, caret-preserve.ts's
// external-update snapshot) computes the same number for "caret inside the new empty block" as for
// "caret at the end of the block before it", because `Range.toString()` is blind to element
// boundaries. Resolving that offset must therefore PREFER the empty block over the text end: it is
// far more often "the blank line the user just made" than a coincidentally-adjacent unrelated one.
// Walks up through ancestors (a text node's block may itself be nested, e.g. text directly in a
// `<li>`) so this isn't fooled by one extra level of wrapping.
function nextEmptyBlockSibling(
  from: Node,
  editor: HTMLElement,
): HTMLElement | null {
  let el: Element | null =
    from.nodeType === Node.TEXT_NODE ? from.parentElement : (from as Element)
  while (el && el !== editor) {
    const next = el.nextElementSibling
    if (next instanceof HTMLElement && isEmptyGapParagraph(next)) return next
    el = el.parentElement
  }
  return null
}

// Character offset → {node, offset}, walking text nodes depth-first and clamping to the end.
// Ported from caret-preserve.ts's setCaretOffset — the fresh-DOM counterpart to its caretOffset().
//
// SKIPS zero-length text nodes (task 445): `Range.insertNode` on a Text boundary (Vditor's own
// undo-snapshot wbr marker, patchUndoCaretSplitRestore) splits it into two siblings, and removing
// the inserted node afterward does NOT merge them back — an empty leftover can sit right where
// `remaining` hits 0. `node.data.length(0) >= remaining(0)` is true, so without this skip the walk
// happily lands ON that empty node: a collapsed Range there is exactly task 439's unpaintable
// caret, reproduced structurally by a completely different call path this time. Only matters when
// `remaining === 0` (an empty node can never satisfy `length >= remaining` for remaining > 0
// anyway), so this changes nothing for the non-empty-node-landing case.
function resolveTextOffset(editor: HTMLElement, offset: number): Target | null {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    if (node.data.length === 0) continue
    last = node
    if (node.data.length >= remaining) {
      // Landing exactly at this text's end is the ambiguous case (see the comment above) — mid-text
      // landings (remaining < length) are unambiguous and skip the empty-block check entirely.
      if (remaining === node.data.length) {
        const empty = nextEmptyBlockSibling(node, editor)
        if (empty) return { node: empty, offset: 0 }
      }
      return { node, offset: Math.max(0, remaining) }
    }
    remaining -= node.data.length
  }
  if (!last) return null
  const empty = nextEmptyBlockSibling(last, editor)
  return empty
    ? { node: empty, offset: 0 }
    : { node: last, offset: last.data.length }
}

// {blockIndex, offsetInBlock} → {node, offset}. Task 487 — the unambiguous counterpart to
// resolveTextOffset above; see the CaretIntent variant's comment for why a flat offset can't do this.
// Both coordinates CLAMP rather than fail: the DOM may legitimately have settled differently between
// capture and restore (Vditor re-spins blocks), and the caret authority treats null as a miss it will
// retry — silently retrying forever is worse than landing one block early, which the next real
// gesture invalidates anyway.
function resolveBlockOffset(
  editor: HTMLElement,
  blockPath: number[],
  offsetInBlock: number,
  breaksBefore = 0,
): Target | null {
  if (editor.children.length === 0) return null
  let block: Element = editor
  for (const index of blockPath) {
    const kids = block.children
    if (kids.length === 0) break // the DOM re-spun shallower than at capture — stop where it ends.
    block = kids[clamp(index, 0, kids.length - 1)]
  }
  if (block === editor) return null
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(offsetInBlock, 0)
  let last: Text | null = null
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    // Zero-length leftovers of the wbr split are never a paintable landing spot (task 445).
    if (node.data.length === 0) continue
    last = node
    if (node.data.length >= remaining)
      return afterBreaks(block, { node, offset: remaining }, breaksBefore)
    remaining -= node.data.length
  }
  // No text in the block at all: THE empty-line case this variant exists for — the block element
  // itself at offset 0 is the caret position, and it is paintable because the block is a real
  // laid-out element (unlike the zero-height collapsed Range on an empty container from task 439).
  const landing = last
    ? { node: last, offset: last.data.length }
    : { node: block, offset: 0 }
  return afterBreaks(block, landing, breaksBefore)
}

// A character offset cannot say "after the break": if the landing spot has fewer `<br>`s before it than
// the caret had, move to just after the Nth break of the block.
function afterBreaks(block: Element, landing: Target, wanted: number): Target {
  if (wanted <= 0) return landing
  const brs = block.querySelectorAll('br')
  if (brs.length < wanted) return landing
  const pre = document.createRange()
  pre.selectNodeContents(block)
  pre.setEnd(landing.node, landing.offset)
  if (pre.cloneContents().querySelectorAll('br').length >= wanted)
    return landing
  const br = brs[wanted - 1]
  const parent = br.parentNode as Node
  return {
    node: parent,
    offset: Array.prototype.indexOf.call(parent.childNodes, br) + 1,
  }
}

// Resolve a declarative intent to a concrete DOM position against the CURRENT DOM. Pure (never
// touches the selection), which is what makes the state machine below unit-testable without a real
// Range/layout — see resolveCaretIntent.test.ts.
export function resolveCaretIntent(
  intent: CaretIntent,
  editor: HTMLElement,
): Target | null {
  if (intent === 'document-start') {
    const block = editor.firstElementChild as HTMLElement | null
    if (!block) return null // should not happen — the leading invariant guarantees one; fail open.
    const text = firstTextNode(block)
    return text
      ? { node: text, offset: text.data.length }
      : { node: block, offset: 0 }
  }
  if (intent === 'document-end') {
    const sel = window.getSelection()
    const caret = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null
    return trailingCaretTarget(editor, caret)
  }
  if ('blockPath' in intent)
    return resolveBlockOffset(
      editor,
      intent.blockPath,
      intent.offsetInBlock,
      intent.breaksBefore,
    )
  if ('textOffset' in intent)
    return resolveTextOffset(editor, intent.textOffset)
  // {node, offset}: only valid while the node is still part of THIS editor — a rebuild that threw
  // the node away makes the intent unresolvable, which is a miss (see tick()), not a crash.
  return editor.contains(intent.node) ? intent : null
}

interface LiveIntent {
  intent: CaretIntent
  misses: number // consecutive resolve-or-paint failures — bounds the retry loop (fail open).
  ticks: number // TOTAL ticks since arming, hit or miss — the hard backstop, see MAX_TOTAL_TICKS.
  // The editor this intent was armed against — null only until the FIRST tick sees one at all
  // (defensive; in production an editor already exists by the time requestCaret is ever called).
  // Once non-null, LOCKED for the intent's lifetime: see the mismatch check in tick().
  editor: HTMLElement | null
}

// ~1.5s at 60fps: long enough to outlast a lazy block/re-spin (439's actual failure mode), short
// enough that an intent whose target is gone for good does not spin forever (decision 3).
const MAX_MISSES = 90

// Adversarial-review finding 2 — hard backstop on the loop's TOTAL lifetime, regardless of the
// hit/miss pattern. MAX_MISSES alone only bounds CONSECUTIVE failures; a pathological alternating
// painted/unpainted signal would reset it every other frame and never trip it. ~5s (300 frames) is
// generous — every measured drop-and-recover in this codebase (439's lazy block: tens of ms; 445's
// undo debounce: ~800ms) resolves in under 1s, and nothing legitimate needs ACTIVE re-assertion
// longer than that once a position has been placed at all. Retiring an intent does NOT un-place the
// caret — the Range stays exactly where the last successful write left it; this only stops the
// background re-polling (ADR-0007's Cost section calls the machine "cheap" — this is what keeps
// that claim true instead of aspirational).
const MAX_TOTAL_TICKS = 300

let live: LiveIntent | null = null
let rafId = 0

function currentEditor(): HTMLElement | null {
  const v = (window as unknown as { vditor?: unknown }).vditor
  return v ? activeModeElement(v) : null
}

// Resolve + write once against the intent's BOUND editor (never re-fetches the "current" one — see
// tick()'s identity check, which is what decides whether boundEditor is still valid to use at all).
// Returns whether a target was found, and whether it is currently paintable — the two questions 439
// conflated into one ("the Range exists") and got wrong.
function tryPlace(
  intent: CaretIntent,
  boundEditor: HTMLElement | null,
): { placed: boolean; painted: boolean } {
  if (!boundEditor) return { placed: false, painted: false }
  const target = resolveCaretIntent(intent, boundEditor)
  if (!target) return { placed: false, painted: false }
  try {
    const sel = window.getSelection()
    const live = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    // Absorbs what used to be focus-restore.ts's own "re-assert only if focusing actually
    // disturbed it" guard: a redundant removeAllRanges()/addRange() at the position it's already
    // at is a pointless selectionchange for every downstream observer (editor-caret.ts's tracker,
    // gap-paragraph.ts's cleanup, …) — every caller gets this for free now, not just that one.
    const already =
      !!live &&
      live.collapsed &&
      live.startContainer === target.node &&
      live.startOffset === target.offset
    const range = already ? live! : document.createRange()
    if (!already) {
      range.setStart(target.node, target.offset)
      range.collapse(true)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    return { placed: true, painted: isPaintable(range) }
  } catch {
    // A stale offset (node mutated between resolve and write) — treat like an unresolved target
    // rather than throwing out of a rAF callback.
    return { placed: false, painted: false }
  }
}

/**
 * Task 522 — would a Selection write into `editor` pull focus away from whatever the user is using?
 * True iff the document HAS focus and the editor does NOT own it. Inside an already-focused
 * document, `Selection.addRange` into a contenteditable FOCUSES it (measured in the real webview),
 * so a write here would steal focus from e.g. VS Code's host find box: Electron's findInFrame gives
 * the webview frame a brief real focus (activeElement === BODY) on every find keystroke. When the
 * document has no focus at all (the e2e harness, a blurred webview) the write moves no focus, so it
 * stays allowed — caret-on-open depends on that.
 */
export function wouldStealFocus(
  editor: HTMLElement,
  doc: Document = document,
): boolean {
  if (!doc.hasFocus()) return false
  const active = doc.activeElement
  return !(active && editor.contains(active))
}

function schedule(): void {
  if (rafId || !live) return
  rafId = requestAnimationFrame(tick)
}

function tick(): void {
  rafId = 0
  const l = live
  if (!l) return

  l.ticks++
  if (l.ticks > MAX_TOTAL_TICKS) {
    live = null // see MAX_TOTAL_TICKS's comment — the hard backstop, independent of hit/miss.
    return
  }

  // Adversarial-review finding 1 (CONFIRMED, demonstrated): a full re-init (`initVditor` does
  // `window.vditor = null; window.vditor = new Vditor(...)`, e.g. from a constructor-only config
  // change) or a mode switch (IR/WYSIWYG/SV each have their OWN `.element`) can swap out the editor
  // an intent was armed against with NO user gesture involved — nothing in installCaretInvalidation
  // observes either path, and 'document-start'/'document-end' are identity-free (they resolve
  // against WHATEVER editor they're handed), so a stale intent would silently write into a totally
  // different document. That is "the caret moved with no gesture behind it" — exactly what decision
  // 3 exists to prevent, regardless of what the specific trigger was. Checked before every
  // resolve-or-write, not just relied on the gesture listeners: this is what makes the defence hold
  // even for a FUTURE re-init path that forgets to invalidate.
  const editorNow = currentEditor()
  if (l.editor && editorNow !== l.editor) {
    live = null // fails OPEN — drop immediately, not a miss (this isn't "still trying to resolve",
    return // it's definitively no longer applicable to a document that no longer exists here).
  }
  if (!l.editor && editorNow) l.editor = editorNow // lock in the first editor ever seen (see the
  // LiveIntent.editor doc comment) — only reachable when requestCaret armed before any editor
  // existed at all, which production never does but a defensive caller might.

  // Task 522: the loop's RE-assertions must not steal focus. The user typing in the HOST find box
  // never produces keydown/pointerdown/beforeinput in the webview, so the intent is never
  // invalidated and the loop keeps re-writing the caret; the first write after find's momentary
  // focus of the frame moved focus into the editor and the user's keystrokes landed in the
  // document. Skip (not a miss — it is not a placement failure), stay armed; the tick budget still
  // bounds the loop. requestCaret()'s own first placement is deliberately NOT gated.
  // Also skip outright while the host says its find widget is open (host-find.ts): the timing/
  // focus heuristic alone did not stop the theft in a real VS Code. Same semantics — stay armed.
  if (isHostFindOpen() || (l.editor && wouldStealFocus(l.editor))) {
    schedule()
    return
  }

  const { painted } = tryPlace(l.intent, l.editor)
  if (painted) {
    // Placed AND visible right now. STAY armed — a later rebuild can still knock it out, and
    // re-asserting across exactly that is the whole point of this module (ADR-0007 decision 1) —
    // but reset the miss counter: only CONSECUTIVE failures should give up. MAX_TOTAL_TICKS above
    // still bounds how long "stay armed" actually means.
    l.misses = 0
  } else {
    l.misses++
    if (l.misses > MAX_MISSES) {
      live = null // fails OPEN (decision 3): give up rather than spin on an intent that can never
      return // resolve, e.g. a {node, offset} target that was permanently removed.
    }
  }
  schedule()
}

/**
 * Declare that the caret belongs at `intent`. Replaces any previously-live intent — only one thing
 * owns "where the caret should be" at a time (decision 2). Resolves and writes IMMEDIATELY (so a
 * caller can synchronously check the result, matching the one-shot writers this replaces) and then
 * stays armed — re-resolving on every animation frame — until a real user gesture invalidates it
 * (installCaretInvalidation, below), the bound editor is swapped out from under it (tick()'s
 * identity check), or MAX_MISSES / MAX_TOTAL_TICKS give up on it.
 *
 * BINDS the intent to whatever editor is current RIGHT NOW — every later tick checks the editor is
 * still THIS one before touching it, so an intent can never resolve/write against a DIFFERENT
 * editor than the one it was armed against, no matter what swapped it out or whether that path
 * remembered to call invalidateCaret().
 *
 * Returns true iff the intent resolved to SOME DOM position and was written — not necessarily yet
 * PAINTABLE (a lazily-created block may need another frame; that is exactly the case this module
 * keeps retrying on, see the file header). Callers that need "is it visible right now" should not
 * rely on the return value; nothing in this codebase currently needs that synchronously.
 */
export function requestCaret(intent: CaretIntent): boolean {
  const editor = currentEditor()
  live = { intent, misses: 0, ticks: 0, editor }
  const { placed, painted } = tryPlace(intent, editor)
  live.misses = placed && painted ? 0 : 1
  schedule()
  return placed
}

/** Drop the live intent without writing anything — a real user gesture always wins (decision 3). */
export function invalidateCaret(): void {
  live = null
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
}

/**
 * Install the "a real user gesture wins" listeners (decision 3): keydown, pointerdown, beforeinput,
 * and compositionstart ALWAYS drop the live intent, unconditionally — invalidation fails open, so
 * there is no attempt to distinguish "a key that would move the caret anyway" from one that would
 * not. compositionstart covers IME composition (e.g. typing CJK text): Chromium fires `beforeinput`
 * for composition-driven insertions too, so this is likely redundant with it in practice, but
 * that's UNVERIFIED — no IME is available in this project's test harness to confirm — so it's kept
 * as an explicit, essentially-free second trigger rather than assumed covered. (Recorded, not just
 * assumed: see the adversarial-review response this comment is part of.)
 *
 * ORDERING IS LOAD-BEARING. Same-target capture-phase listeners fire in registration order, and
 * gap-nav.ts / gap-paragraph.ts's trailing-nav set a FRESH intent from inside their OWN keydown
 * handlers (they pre-empt the native move). If this listener were registered AFTER theirs, it would
 * clear the fresh intent they just set, in the same event, immediately after they set it. Registered
 * BEFORE them (main.ts calls this first), it clears any STALE intent before those handlers run, so
 * their new intent — set later in the same dispatch — survives untouched. See main.ts's wiring
 * comment.
 */
export function installCaretInvalidation(): () => void {
  const onGesture = () => invalidateCaret()
  document.addEventListener('keydown', onGesture, true)
  document.addEventListener('pointerdown', onGesture, true)
  document.addEventListener('beforeinput', onGesture, true)
  document.addEventListener('compositionstart', onGesture, true)
  return () => {
    document.removeEventListener('keydown', onGesture, true)
    document.removeEventListener('pointerdown', onGesture, true)
    document.removeEventListener('beforeinput', onGesture, true)
    document.removeEventListener('compositionstart', onGesture, true)
  }
}

declare global {
  interface Window {
    // Bridge for PATCHED VENDORED Vditor source (media-src/esbuild-shared.mjs's
    // patchUndoCaretSplitRestore, task 445) to reach the caret authority. Vendored files aren't
    // part of the webview's own TS module graph (ADR-0004), so they call this global instead of
    // importing requestCaret directly — same pattern as __vmarkdShouldOpenLink / __vmarkdMorphPreview.
    __vmarkdRequestCaret?: (intent: CaretIntent) => boolean
  }
}

/** Install the window bridge patched Vditor source calls into (task 445). Idempotent; call once
 *  from main.ts, same lifecycle as installCaretInvalidation. */
export function installCaretWindowBridge(): void {
  window.__vmarkdRequestCaret = requestCaret
}

// Test-only: peek at the live intent (or its absence) without reaching into module state directly.
export function liveCaretIntentForTests(): CaretIntent | null {
  return live?.intent ?? null
}

// Test-only: reset all module state between tests (mirrors initial-caret.ts's
// resetInitialCaretForTests / editor-session-state.ts's equivalents).
export function resetCaretAuthorityForTests(): void {
  live = null
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  resetCaretPaintabilityProbeForTests()
}
