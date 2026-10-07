// Tasks 428/525 — list-item Backspace, Tab and typed markers behave like a real editor.
//
// Vditor's own `fixList` (fixBrowserBehavior.ts) handles Backspace-at-start for a TOP-LEVEL first
// item (→ paragraph) and for an EMPTY item (→ align to previous). Two cases are missing/wrong:
//   1. A NON-first item WITH text falls through to the browser default, which MERGES the item's
//      text into the previous item — measured "1. otwo" + Backspace → "1. ooneotwo", and a nested
//      child glued onto its parent ("- nparentnchildone") (task 428 probe, 2026-07-30).
//   2. A NESTED item — first-in-its-sublist or not — used to fall into fixList's "top-level first
//      item → paragraph" branch too, because that branch was gated only on
//      `!previousElementSibling`, not on top-level-ness. For a nested item that branch inserts the
//      lifted content as a stray `<p>` SIBLING inside the PARENT `<li>` (ahead of the remaining
//      sublist) rather than promoting it — corrupting a still `data-tight="true"` list exactly the
//      way task 391 (`list-tight.ts`) originally measured. RE-MEASURED 2026-07-31 (tasks 461/462,
//      `media-src/e2e/list.spec.ts`): pressing Backspace on a nested FIRST item against UNMODIFIED
//      Vditor reproduces list-tight.test.ts's `CORRUPTED` fixture byte-for-byte (a finding recorded
//      in tasks/461 and tasks/462, no longer directly reproducible from a patched build — see that
//      spec's own header). `patchFixListOutdent` (esbuild-shared.mjs) gates that branch to top-level-only
//      so every nested item, first included, falls through to this module instead — which is why
//      list-tight.ts's repair observer could be retired (task 461): the corruption it existed to
//      repair no longer has a path to occur.
//
// Task 525 widened the seam: it now fires at the TOP of fixList's `if (liElement)` block, ahead of its
// empty-item handling (in Vditor <= 3.11.2 that was an "empty item → align to previous" branch which
// appended the TEXT "\n\n" to the previous <li>, after its sublist — the root cause of the
// loose-list / dead-key / wrong-caret findings; Vditor 3.11.3 removed that branch and replaced it with
// `exitEmptyListItem`, which only runs for what this seam declines) and handles Tab too, so `__vmarkdListKeydown` owns
// Backspace-on-empty-item, Backspace-at-start, and Tab / Shift+Tab anywhere in the item. A separate
// `beforeinput` listener converts a typed list marker in an empty item (Space never reaches fixList).
//
// This module used to be a document CAPTURE-phase keydown listener (Vditor binds its own keydown on
// the editor element in bubble phase, so capturing ran first and stopping propagation there kept
// Vditor's merge from running). Task 462 moved it into a `fixList`-internal branch instead: an
// override left Vditor's wrong branches in place plus a second listener racing them (ADR-0004's
// argument, transposed from CSS to behaviour) — a Vditor bump that changed those branches' guard
// conditions would make the interceptor silently stop matching, or keep blocking a branch Vditor had
// since fixed, with nothing to catch the drift. The patch's anchor-assert now fails the build loudly
// instead. `handleListKeydown` is called directly from `fixList`'s own key chain
// via the `window.__vmarkdListKeydown` seam `patchFixListOutdent` inserts (matching this
// codebase's ~20 other `window.__vmarkd*` bridges — the patched Vditor source cannot import from our
// bundle, and a global keeps the patch itself down to one branch). Because the caller is `fixList`
// itself, this function needs none of the independent re-derivation the old document-listener did
// (locating the live Vditor instance, re-filtering Ctrl/Alt/Shift/Enter/Tab) — `fixList` has already
// done all of that before reaching the seam call.

import {
  execAfterRender,
  listIndent,
  listOutdent,
} from 'vditor/src/ts/util/fixBrowserBehavior'
import { hasClosestByMatchTag } from 'vditor/src/ts/util/hasClosest'
import {
  getSelectPosition,
  setSelectionFocus,
} from 'vditor/src/ts/util/selection'
import {
  findEnclosingListRoot,
  respinListAtRange,
  spinFor,
} from './list-normalize'
import { ZWSP } from './trailing-paragraph'

interface VditorLike {
  currentMode: string
  lute: {
    SpinVditorIRDOM: (html: string) => string
    SpinVditorDOM: (html: string) => string
  }
  [mode: string]: unknown
}

const MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])$/
const BLOCK_SCOPE =
  'li, pre, table, blockquote, [data-type="code-block"], [data-type="math-block"], [data-type="html-block"]'

const isBlank = (text: string): boolean => text.replace(ZWSP, '').trim() === ''

// Text nodes that belong to `li` itself — everything except text inside a NESTED list.
function ownTextNodes(li: HTMLElement): Text[] {
  const walker = document.createTreeWalker(
    li,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (n) =>
        n.nodeType === Node.TEXT_NODE
          ? NodeFilter.FILTER_ACCEPT
          : (n as Element).matches('ul, ol')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP,
    },
  )
  const out: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

/**
 * The "previous visible line" an empty item's Backspace should land on: the deepest last descendant
 * of the previous sibling item, else (nested first item) the parent item, else null (a top-level
 * FIRST item — fixList's own "→ empty paragraph" branch handles that one).
 */
export function previousVisibleLine(li: HTMLElement): HTMLElement | null {
  let target = li.previousElementSibling
  if (target?.tagName === 'LI') {
    for (;;) {
      const sub = target.lastElementChild
      const last = sub?.matches('ul, ol') ? sub.lastElementChild : null
      if (!last) break
      target = last
    }
    return target as HTMLElement
  }
  const parentLi = li.parentElement?.closest<HTMLElement>('li') ?? null
  return parentLi
}

// Caret at the end of `target`'s OWN text (never inside its sublist); after the checkbox for a text-less
// task item; at the start of the item otherwise.
function placeCaretAtEndOfOwnText(target: HTMLElement, range: Range): void {
  const last = ownTextNodes(target)
    .filter((t) => !isBlank(t.data))
    .pop()
  if (last) {
    range.setStart(last, last.data.replace(/\s+$/, '').length)
  } else {
    const box = target.querySelector(':scope > input')
    if (box) range.setStartAfter(box)
    else range.setStart(target, 0)
  }
  range.collapse(true)
}

// Backspace on an EMPTY item. Replaces Vditor <= 3.11.2's fixList "\n\n" branch, which appended literal text to the
// previous <li> AFTER its sublist (caret mapped back to the parent's own text, next edit went loose).
function removeEmptyItem(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
): boolean {
  const target = previousVisibleLine(li)
  if (!target) return false
  const list = li.parentElement
  li.remove()
  if (list && list.children.length === 0) list.remove()
  placeCaretAtEndOfOwnText(target, range)
  respinListAtRange(
    vditor,
    findEnclosingListRoot(target, editor),
    range,
    editor,
  )
  return true
}

// Lift a TOP-LEVEL list item out of its list into a plain paragraph, splitting the list around it:
// items before stay a list, this item becomes a `<p>`, items after become a fresh list of the same
// type. Lute re-serialises so ordered lists renumber and the markdown is clean.
function liftTopLevelItemToParagraph(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
): void {
  const list = li.parentElement
  if (!list) return
  const tag = list.tagName.toLowerCase()
  // Preserve the list's own opening tag (an ordered list carries `start=`, class, data-* etc.).
  const openTag = list.outerHTML.slice(0, list.outerHTML.indexOf('>') + 1)
  const before: string[] = []
  const after: string[] = []
  let seen = false
  for (const child of Array.from(list.children)) {
    if (child === li) {
      seen = true
      continue
    }
    ;(seen ? after : before).push(child.outerHTML)
  }
  const wrap = (items: string[]) =>
    items.length ? `${openTag}${items.join('')}</${tag}>` : ''
  // A checklist item lifted to a paragraph drops its checkbox — otherwise Lute serialises the leftover
  // `<input>` as literal "[ ]" text at the start of the paragraph.
  const inner = document.createElement('div')
  inner.innerHTML = li.innerHTML
  for (const box of Array.from(inner.querySelectorAll('input'))) box.remove()
  const para = `<p data-block="0">${inner.innerHTML}</p>`
  const html = `${wrap(before)}${para}${wrap(after)}`
  // LUTE BUG (task 525 #1, measured): a caret marker (<wbr>) at the very START of a paragraph that
  // directly follows a list ending in a nested list makes SpinVditorIRDOM/SpinVditorDOM glue the
  // paragraph into the last sub-item and DROP every later item
  // (`Md2VditorIRDOM("1. one\n   - aaa\n\n‸two\n\n1. three\n")` loses "1. three"). So spin WITHOUT the
  // marker and put the caret on the new <p> by position instead.
  const prev = list.previousElementSibling
  const parent = list.parentElement as HTMLElement
  list.outerHTML = spinFor(vditor)(html)
  const first = prev ? prev.nextElementSibling : parent.firstElementChild
  const p = [first, first?.nextElementSibling].find((e) => e?.tagName === 'P')
  if (p) placeCaretAtParagraphStart(p, range)
  execAfterRender(vditor as never)
}

function placeCaretAtParagraphStart(p: Element, range: Range): void {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('[class*="__marker"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const text = walker.nextNode()
  if (text) range.setStart(text, 0)
  else range.setStart(p, 0)
  range.collapse(true)
  setSelectionFocus(range)
}

/**
 * Whether this module's Backspace handling applies to `li` — and if so, whether it's nested (→
 * outdent) or top-level (→ lift to a paragraph). A pure decision, no DOM mutation, split out from
 * `backspaceInItem` so the guard logic (the part that changed shape in the move to
 * a `fixList`-internal seam, task 462) is unit-testable without a working Vditor/Lute instance — see
 * list-backspace.test.ts's header for why the DOM-mutating half isn't.
 */
export function backspaceOutdentTarget(
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
): 'nested' | 'top-level' | null {
  // `hasClosestByMatchTag` itself treats a falsy element as "no match" (returns `false`) — guard
  // here only to satisfy strictNullChecks, same behaviour as calling it with a null element.
  const parentLi = li.parentElement
    ? (hasClosestByMatchTag(li.parentElement, 'LI') as HTMLElement | false)
    : false
  // A TOP-LEVEL first item is `fixList`'s own "→ paragraph" branch (now gated to top-level-only by
  // `patchFixListOutdent`) — leave it. A NESTED first item is NOT (that branch would corrupt a tight
  // list — see module header), so we still handle that by outdenting.
  if (!li.previousElementSibling && !parentLi) return null
  // An EMPTY item is handled by `removeEmptyItem` — not an outdent/lift.
  if (isBlank(li.textContent ?? '')) return null
  // Only at the very start of the item's text (a "delete the marker" gesture, not a mid-text
  // Backspace). A task item counts the checkbox as one leading position, so 1 is its start.
  const isTask = li.classList.contains('vditor-task')
  const pos = getSelectPosition(li, editor, range).start
  if (pos !== 0 && !(isTask && pos <= 1)) return null
  return parentLi ? 'nested' : 'top-level'
}

function backspaceInItem(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
): boolean {
  if (isBlank(li.textContent ?? ''))
    return removeEmptyItem(vditor, li, range, editor)
  const target = backspaceOutdentTarget(li, range, editor)
  if (!target) return false
  if (target === 'nested') {
    // Outdent one level, exactly like Shift+Tab (fixList's own Tab branch uses this call).
    listOutdent(vditor as never, li, range, li.parentElement as HTMLElement)
  } else {
    liftTopLevelItemToParagraph(vditor, li, range)
  }
  return true
}

/**
 * Tab / Shift+Tab are ours only when the caret's nearest block scope is THIS item — inside a code
 * block, table or quote within the item Tab must keep its normal meaning there.
 */
export function caretOwnedByItem(li: HTMLElement, range: Range): boolean {
  const node = range.startContainer
  const start = node instanceof Element ? node : node.parentElement
  return start?.closest(BLOCK_SCOPE) === li
}

/**
 * Whether `range` is a caret, collapsing it if so. The live selection in this editor is often EMPTY
 * but not `collapsed` — anchor at a text node's end, focus on the element boundary right after it
 * (measured in the real webview, task 525: after End + a pause, and while typing fast). Testing
 * `collapsed` made Tab escape the editor and the typed-marker conversion miss; Vditor's own branches
 * test `toString()` for the same reason. Collapsing keeps listIndent/listOutdent from reading it as
 * a multi-item selection.
 */
function asCaret(range: Range): boolean {
  if (range.toString() !== '') return false
  range.collapse(true)
  return true
}

function tabInItem(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  shiftKey: boolean,
): boolean {
  if (!caretOwnedByItem(li, range)) return false
  if (!shiftKey) listIndent(vditor as never, li, range)
  else if (hasClosestByMatchTag(li.parentElement as HTMLElement, 'LI'))
    listOutdent(vditor as never, li, range, li.parentElement as HTMLElement)
  // Handled even when nothing can move (first item / top level), like Vditor's own Tab branch, so
  // the keystroke never escapes the editor.
  return true
}

/**
 * The sub-list a caret-at-end-of-own-text Enter should open a new first item in: `li`'s direct-child
 * UL/OL, but only when the caret sits after non-blank own text with nothing but blanks following.
 * Anywhere else (mid-text, empty item, no sub-list) Enter keeps Vditor's own behaviour. A pure
 * decision, no DOM mutation.
 */
export function enterSubListTarget(
  li: HTMLElement,
  range: Range,
): HTMLElement | null {
  const sub = li.querySelector<HTMLElement>(':scope > ul, :scope > ol')
  if (!sub || !caretOwnedByItem(li, range)) return null
  const { before, after } = splitOwnText(li, range)
  return isBlank(before) || !isBlank(after) ? null : sub
}

// Outliner-style Enter: a NEW EMPTY first item at the top of the item's sub-list (the sub-list stays
// with its parent), caret inside it. Built from the current first sub-item so it carries the same
// marker and, for a checklist, an UNCHECKED checkbox; the respin renumbers an ordered sub-list and
// records ONE undo step. (Vditor's own Enter splits the item and hands the sub-list to the new
// sibling — Google-Docs style — which the user rejected for items with children.)
function addFirstSubItem(
  vditor: VditorLike,
  sub: HTMLElement,
  range: Range,
  editor: HTMLElement,
): void {
  const first = sub.firstElementChild as HTMLElement
  const item = document.createElement('li')
  for (const attr of ['data-marker', 'class']) {
    const value = first.getAttribute(attr)
    if (value !== null) item.setAttribute(attr, value)
  }
  sub.prepend(item)
  if (item.classList.contains('vditor-task')) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    item.append(box)
    range.setStartAfter(box)
  } else {
    range.setStart(item, 0)
  }
  range.collapse(true)
  respinListAtRange(vditor, findEnclosingListRoot(sub, editor), range, editor)
}

/**
 * Task 528: Enter in an EMPTY NESTED item (no text at all, no sub-list of its own, an ancestor LI).
 * Vditor 3.11.3 turned this into "exit to a paragraph inside the parent item" (vditor#939), which
 * makes the list loose and loses the next number; we keep the old outliner behaviour, i.e. exactly
 * Shift+Tab. A pure decision, no DOM mutation. An empty TOP-LEVEL item stays Vditor's (exits the list).
 */
export function isEmptyNestedItem(li: HTMLElement): boolean {
  return (
    isBlank(li.textContent ?? '') &&
    li.parentElement !== null &&
    !!hasClosestByMatchTag(li.parentElement, 'LI')
  )
}

function enterInItem(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
  event: KeyboardEvent,
): boolean {
  if (event.shiftKey || !asCaret(range)) return false
  if (isEmptyNestedItem(li)) {
    listOutdent(vditor as never, li, range, li.parentElement as HTMLElement)
    return true
  }
  const sub = enterSubListTarget(li, range)
  if (!sub) return false
  addFirstSubItem(vditor, sub, range, editor)
  return true
}

/**
 * Entry point of the `window.__vmarkdListKeydown` seam `patchFixListOutdent` inserts into `fixList`
 * (at the top of its `liElement` block). Returns whether it handled the key, so the caller can
 * `preventDefault` and stop, or fall through to Vditor's own branches.
 */
function handleListKeydown(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
  event: KeyboardEvent,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key === 'Enter')
    return enterInItem(vditor, li, range, editor, event)
  const backspace = event.key === 'Backspace' && !event.shiftKey
  // A real (non-empty) selection stays with Vditor's own branches.
  if (!(backspace || event.key === 'Tab') || !asCaret(range)) return false
  return backspace
    ? backspaceInItem(vditor, li, range, editor)
    : tabInItem(vditor, li, range, event.shiftKey)
}

interface TypedMarker {
  marker: string
  ordered: boolean
  node: Text
  offset: number
}

interface OwnTextSplit {
  before: string
  after: string
  beforeNodes: Text[]
}

// Own text of `li` split at the caret (text of a nested sub-list excluded), plus the text nodes that
// hold the "before" half. Shared by the typed-marker conversion and Enter-at-end-of-item.
function splitOwnText(li: HTMLElement, range: Range): OwnTextSplit {
  let before = ''
  let after = ''
  const beforeNodes: Text[] = []
  for (const node of ownTextNodes(li)) {
    const atStart = range.comparePoint(node, 0)
    const atEnd = range.comparePoint(node, node.length)
    if (range.startContainer === node) {
      before += node.data.slice(0, range.startOffset)
      after += node.data.slice(range.startOffset)
      beforeNodes.push(node)
    } else if (atEnd === -1 || (atEnd === 0 && atStart !== 0)) {
      before += node.data
      beforeNodes.push(node)
    } else {
      after += node.data
    }
  }
  return { before, after, beforeNodes }
}

// The typed marker is valid only when it is ALL the text before the caret (single text node) and
// nothing but blanks follows.
export function typedMarkerBeforeCaret(
  li: HTMLElement,
  range: Range,
): TypedMarker | null {
  const { before, after, beforeNodes } = splitOwnText(li, range)
  const marker = before.replace(ZWSP, '')
  if (!MARKER_RE.test(marker) || !isBlank(after)) return null
  const holders = beforeNodes.filter(
    (n) =>
      !isBlank(
        n.data.slice(
          0,
          n === range.startContainer ? range.startOffset : n.length,
        ),
      ),
  )
  if (holders.length !== 1) return null
  const node = holders[0]
  return {
    marker,
    ordered: /^\d/.test(marker),
    node,
    offset: node.data.indexOf(marker),
  }
}

// Remove the typed marker text and leave the caret where it was.
function eraseTypedMarker(typed: TypedMarker, range: Range): void {
  const { node, marker, offset } = typed
  node.data =
    node.data.slice(0, offset) + node.data.slice(offset + marker.length)
  range.setStart(node, offset)
  range.collapse(true)
}

// Move `li` into a NEW list of the typed marker's kind, splitting its current list around it: items
// before keep the original list (and its opening tag), items after go into a clone of it.
function splitListAround(li: HTMLElement, typed: TypedMarker): void {
  const list = li.parentElement as HTMLElement
  const next = document.createElement(typed.ordered ? 'ol' : 'ul')
  next.setAttribute('data-block', '0')
  next.setAttribute('data-marker', typed.marker)
  const tight = list.getAttribute('data-tight')
  if (tight !== null) next.setAttribute('data-tight', tight)
  li.setAttribute('data-marker', typed.marker)
  const following: Element[] = []
  for (let s = li.nextElementSibling; s; s = s.nextElementSibling)
    following.push(s)
  next.append(li)
  list.after(next)
  if (following.length) {
    const rest = list.cloneNode(false) as HTMLElement
    rest.removeAttribute('start')
    rest.append(...following)
    next.after(rest)
  }
  if (list.children.length === 0) list.remove()
}

function convertTypedMarker(
  vditor: VditorLike,
  li: HTMLElement,
  range: Range,
  editor: HTMLElement,
  typed: TypedMarker,
): void {
  const list = li.parentElement
  const sameKind = list?.tagName === (typed.ordered ? 'OL' : 'UL')
  eraseTypedMarker(typed, range)
  if (sameKind) {
    setSelectionFocus(range)
    execAfterRender(vditor as never)
    return
  }
  splitListAround(li, typed)
  // Moving `li` detached the range's container; re-anchor the caret where the marker was.
  range.setStart(typed.node, typed.offset)
  range.collapse(true)
  respinListAtRange(vditor, findEnclosingListRoot(li, editor), range, editor)
}

function onBeforeInput(e: Event, getVditor: () => unknown): void {
  const ev = e as InputEvent
  if (ev.inputType !== 'insertText' || ev.data !== ' ' || ev.isComposing) return
  const vditor = getVditor() as VditorLike | null
  if (
    !vditor ||
    (vditor.currentMode !== 'ir' && vditor.currentMode !== 'wysiwyg')
  )
    return
  const editor = (vditor[vditor.currentMode] as { element?: HTMLElement })
    ?.element
  const sel = window.getSelection()
  if (!editor || !sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!asCaret(range) || !editor.contains(range.startContainer)) return
  const li = hasClosestByMatchTag(range.startContainer, 'LI') as
    | HTMLElement
    | false
  if (!li || !caretOwnedByItem(li, range)) return
  const typed = typedMarkerBeforeCaret(li, range)
  if (!typed) return
  ev.preventDefault()
  convertTypedMarker(vditor, li, range, editor, typed)
}

/**
 * Install the `window.__vmarkdListKeydown` seam `patchFixListOutdent` calls into from inside
 * `fixList`, plus the `beforeinput` listener that turns a typed list marker + Space in an item into
 * that list kind (Space never reaches `fixList`). `getVditor` returns the live inner Vditor. The
 * disposer removes both.
 */
export function installListBackspace(getVditor: () => unknown): () => void {
  const w = window as unknown as {
    __vmarkdListKeydown?: typeof handleListKeydown
  }
  w.__vmarkdListKeydown = handleListKeydown
  const listener = (e: Event) => onBeforeInput(e, getVditor)
  document.addEventListener('beforeinput', listener, true)
  return () => {
    delete w.__vmarkdListKeydown
    document.removeEventListener('beforeinput', listener, true)
  }
}
