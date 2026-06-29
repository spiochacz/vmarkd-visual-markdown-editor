// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyCallouts,
  calloutSourceHasAnchor,
  matchCallout,
  observeCallouts,
} from './callouts'

const PREVIEW = '.vmarkd-callout__preview'

// Build a real IR-editor-ish DOM: a contenteditable `.vditor-ir` surface holding a `[!NOTE]` callout
// blockquote and a trailing paragraph the caret can move into. Mirrors what Vditor emits in IR mode.
function buildIrCallout() {
  const ir = document.createElement('div')
  ir.className = 'vditor-ir vditor-reset'
  ir.setAttribute('contenteditable', 'true')
  const bq = document.createElement('blockquote')
  const p = document.createElement('p')
  p.textContent = '[!NOTE]\nbody text of the note'
  bq.appendChild(p)
  const after = document.createElement('p')
  after.textContent = 'after'
  ir.append(bq, after)
  document.body.appendChild(ir)
  return { ir, bq, p, after }
}

function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(node, offset)
  r.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(r)
}

describe('matchCallout', () => {
  it('matches GitHub alert types (case-insensitive)', () => {
    expect(matchCallout('[!NOTE]')).toMatchObject({ type: 'note' })
    expect(matchCallout('[!Tip]')).toMatchObject({ type: 'tip' })
    expect(matchCallout('[!WARNING]')?.type).toBe('warning')
  })

  it('captures an optional title after the marker', () => {
    expect(matchCallout('[!NOTE] Heads up')).toMatchObject({
      type: 'note',
      title: 'Heads up',
    })
    expect(matchCallout('[!note]')?.title).toBe('')
  })

  it("accepts Obsidian's foldable suffixes but ignores them (fold support dropped)", () => {
    expect(matchCallout('[!note]-')).toMatchObject({ type: 'note', title: '' })
    expect(matchCallout('[!note]+ Title')).toMatchObject({
      type: 'note',
      title: 'Title',
    })
    expect(matchCallout('[!note]-')).not.toHaveProperty('foldable')
  })

  it('rejects unknown types — not a callout, stays a plain blockquote', () => {
    expect(matchCallout('[!whatever]')).toBeNull()
    expect(matchCallout('[!TIPs]')).toBeNull() // the reported invalid name (typo of tip)
    expect(matchCallout('[!note]')?.type).toBe('note') // a known type still matches
  })

  it('returns null for normal blockquote text', () => {
    expect(matchCallout('Just a quote.')).toBeNull()
    expect(matchCallout('[not a callout]')).toBeNull()
    expect(matchCallout('')).toBeNull()
  })

  it('tolerates leading whitespace', () => {
    expect(matchCallout('  [!tip] x')?.type).toBe('tip')
  })
})

// Task 179 — typing inside a callout used to eject the caret + blank the text. The fix drives the
// dual-node's expand/collapse off the LIVE selection (not Vditor's keyup timing) and skips rebuilding
// the preview of the callout being typed in. These guard that behaviour so the regression can't return.
describe('calloutSourceHasAnchor (editing-guard predicate)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('is true for a node inside the editable source, false in the injected preview', () => {
    const { ir, bq, p } = buildIrCallout()
    applyCallouts(ir) // injects the non-editable preview
    const preview = bq.querySelector(PREVIEW) as HTMLElement
    expect(calloutSourceHasAnchor(bq, p.firstChild)).toBe(true) // source text node
    expect(calloutSourceHasAnchor(bq, preview)).toBe(false) // inside the preview → not editing
    expect(
      calloutSourceHasAnchor(bq, preview.querySelector('*') ?? preview),
    ).toBe(false)
  })

  it('is false for no anchor or a node outside the callout', () => {
    const { ir, bq, after } = buildIrCallout()
    applyCallouts(ir)
    expect(calloutSourceHasAnchor(bq, null)).toBe(false)
    expect(calloutSourceHasAnchor(bq, undefined)).toBe(false)
    expect(calloutSourceHasAnchor(bq, after.firstChild)).toBe(false) // sibling paragraph
  })
})

describe('callout preview body survives a SPLIT marker/body text run (renamed-type bug)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  // Editing the marker (e.g. [!TIP] → [!NOTE]) makes the IR split the leading run into separate text
  // nodes: `[!NOTE]` + `\nbody`. stripMarkerLine used to look only at p.firstChild (`[!NOTE]`, no `\n`)
  // and drop the WHOLE <p> — so the body vanished from the rendered callout. It must scan child nodes.
  it('strips only the marker line, keeping the body, when the run is split across text nodes', () => {
    const ir = document.createElement('div')
    ir.className = 'vditor-ir vditor-reset'
    ir.setAttribute('contenteditable', 'true')
    const bq = document.createElement('blockquote')
    const p = document.createElement('p')
    p.appendChild(document.createTextNode('[!NOTE]')) // marker in its own text node…
    p.appendChild(document.createTextNode('\nbody text here')) // …body split into a sibling node
    bq.appendChild(p)
    ir.appendChild(bq)
    document.body.appendChild(ir)

    applyCallouts(ir)
    const preview = bq.querySelector(PREVIEW) as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.querySelector('.vmarkd-callout__title')?.textContent).toBe(
      'Note',
    )
    expect(
      preview.querySelector('.vmarkd-callout__body')?.textContent?.trim(),
    ).toBe('body text here') // body PRESERVED (was empty before the fix)
  })

  it('still drops a marker-only first paragraph (no body line)', () => {
    const ir = document.createElement('div')
    ir.className = 'vditor-ir vditor-reset'
    const bq = document.createElement('blockquote')
    const marker = document.createElement('p')
    marker.textContent = '[!NOTE]'
    const bodyP = document.createElement('p')
    bodyP.textContent = 'a second paragraph body'
    bq.append(marker, bodyP)
    ir.appendChild(bq)
    document.body.appendChild(ir)

    applyCallouts(ir)
    const body = bq.querySelector('.vmarkd-callout__body') as HTMLElement
    expect(body.textContent).toContain('a second paragraph body') // body kept
    expect(body.textContent).not.toContain('[!NOTE]') // marker-only <p> dropped
  })
})

describe('applyCallouts editing guard (caret inside the callout source)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('caret outside → collapsed, preview built, not flagged editing', () => {
    const { ir, bq, after } = buildIrCallout()
    placeCaret(after.firstChild as Node, 1)
    applyCallouts(ir)
    expect(bq.querySelector(PREVIEW)).not.toBeNull()
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(false)
    expect(bq.hasAttribute('data-callout-editing')).toBe(false)
  })

  it('caret inside → expanded, flagged editing, preview NOT restructured (caret-safe)', () => {
    const { ir, bq, p } = buildIrCallout()
    applyCallouts(ir) // build the preview first (collapsed state)
    const previewBefore = bq.querySelector(PREVIEW)
    placeCaret(p.firstChild as Node, 1) // caret into the editable source
    applyCallouts(ir) // re-decorate as the per-keystroke observer would
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(true) // source stays visible
    expect(bq.hasAttribute('data-callout-editing')).toBe(true)
    // the node being typed in is never restructured (same preview element → no replaceWith/caret eject)
    expect(bq.querySelector(PREVIEW)).toBe(previewBefore)
  })

  it('does NOT expand for a non-editable surface (Preview pane, no .vditor-ir)', () => {
    const { bq, p } = buildIrCallout()
    const pane = document.createElement('div')
    pane.className = 'vditor-preview' // read-only render, not the IR edit surface
    pane.appendChild(bq.parentElement?.removeChild(bq) ?? bq)
    document.body.appendChild(pane)
    applyCallouts(pane)
    placeCaret(p.firstChild as Node, 1) // a text selection in the preview pane is not "editing"
    applyCallouts(pane)
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(false)
    expect(bq.hasAttribute('data-callout-editing')).toBe(false)
    expect(bq.querySelector(PREVIEW)).not.toBeNull() // still rendered
  })
})

describe('observeCallouts caret-leave re-sync (selectionchange)', () => {
  let dispose: (() => void) | null = null
  afterEach(() => {
    dispose?.()
    dispose = null
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('rebuilds the preview from the final source after the caret leaves the callout', () => {
    const { ir, bq, p, after } = buildIrCallout()
    dispose = observeCallouts(ir)

    // enter + edit: applyCallouts stands in for the synchronous per-keystroke observer (the real
    // MutationObserver is a microtask → not deterministic in a sync test). It flags the callout
    // `data-callout-editing` + keeps the preview skipped while the caret is inside.
    placeCaret(p.firstChild as Node, 1)
    applyCallouts(ir)
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(true)
    expect(bq.hasAttribute('data-callout-editing')).toBe(true)
    ;(p.firstChild as Text).textContent = '[!NOTE]\nedited body now'
    applyCallouts(ir) // caret still inside → preview still skipped, flag stays

    // leave the callout → the selectionchange handler collapses it + re-syncs the preview to the edit
    placeCaret(after.firstChild as Node, 1)
    document.dispatchEvent(new Event('selectionchange'))
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(false)
    expect(bq.hasAttribute('data-callout-editing')).toBe(false)
    const preview = bq.querySelector(PREVIEW) as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.textContent).toContain('edited body now') // rebuilt from the final source
  })

  it('expands the focused IR callout straight off the selection (not Vditor keyup timing)', () => {
    const { ir, bq, p } = buildIrCallout()
    dispose = observeCallouts(ir)
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(false)
    // caret moves into the source + selection change fires → the handler expands it itself, so the
    // source can't flash to display:none between the re-spin and Vditor re-adding `--expand`.
    placeCaret(p.firstChild as Node, 1)
    document.dispatchEvent(new Event('selectionchange'))
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(true)
  })

  it('does NOT re-sync a callout still holding the caret (skips the one being typed in)', () => {
    const { ir, bq, p } = buildIrCallout()
    dispose = observeCallouts(ir)
    placeCaret(p.firstChild as Node, 1)
    applyCallouts(ir) // flag it editing (caret inside)
    expect(bq.hasAttribute('data-callout-editing')).toBe(true)
    // a selection change while the caret is STILL inside must leave the edited callout untouched
    // (the leave path only fires for a flagged callout the caret has left) — no collapse mid-typing.
    document.dispatchEvent(new Event('selectionchange'))
    expect(bq.classList.contains('vditor-ir__node--expand')).toBe(true)
    expect(bq.hasAttribute('data-callout-editing')).toBe(true)
  })
})
