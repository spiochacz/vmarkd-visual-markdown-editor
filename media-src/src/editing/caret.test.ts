// @vitest-environment jsdom
//
// ADR-0007 / task 446 — the caret authority's state machine is pure logic (resolve a declarative
// intent against the DOM, decide whether to re-try), so it is exhaustively covered here without a
// webview. Paintability itself (jsdom has no layout engine — Range.getBoundingClientRect doesn't
// even exist there) and the animation-frame loop are both driven through injectable seams:
// setCaretPaintabilityProbeForTests and a stubbed requestAnimationFrame/cancelAnimationFrame (the
// same deterministic-rAF pattern as observe-coalesce.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setHostFindClosed, setHostFindOpen } from './host-find'
import {
  installCaretInvalidation,
  invalidateCaret,
  liveCaretIntentForTests,
  requestCaret,
  resetCaretAuthorityForTests,
  resolveCaretIntent,
  setCaretPaintabilityProbeForTests,
  wouldStealFocus,
} from './caret'

// Deterministic rAF: capture callbacks, fire them explicitly as "the next frame" instead of
// waiting on a real timer.
let frameCallbacks: FrameRequestCallback[]
function fireFrame() {
  const cbs = frameCallbacks
  frameCallbacks = []
  for (const cb of cbs) cb(0)
}
function fireFrames(n: number) {
  for (let i = 0; i < n; i++) fireFrame()
}

function mountEditor(html: string): HTMLElement {
  document.body.innerHTML = `<div id="ed" contenteditable="true">${html}</div>`
  const editor = document.getElementById('ed') as HTMLElement
  ;(window as unknown as Record<string, unknown>).vditor = {
    vditor: { currentMode: 'ir', ir: { element: editor } },
  }
  return editor
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  ;(window as unknown as Record<string, unknown>).vditor = undefined
  resetCaretAuthorityForTests()
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb)
    return frameCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    // Mark the slot cancelled so a later flush of frameCallbacks can't
    // re-invoke a callback the code under test already cancelled.
    frameCallbacks[id - 1] = () => {
      /* cancelled */
    }
  })
})
afterEach(() => {
  resetCaretAuthorityForTests() // also resets the paintability probe (see caret.ts)
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------------------
describe('resolveCaretIntent — pure resolution, never touches the selection', () => {
  it('document-start: lands after the first text node when one exists', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    const target = resolveCaretIntent('document-start', editor)
    expect(target?.node).toBe(editor.firstElementChild!.firstChild)
    expect(target?.offset).toBe(5) // end of "hello" — see initial-caret's former behaviour
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0) // pure — no write
  })

  it('document-start: falls back to (block, 0) when the first block has no text node', () => {
    const editor = mountEditor('<p data-block="0"><br></p>')
    const target = resolveCaretIntent('document-start', editor)
    expect(target?.node).toBe(editor.firstElementChild)
    expect(target?.offset).toBe(0)
  })

  it('document-start: null when the editor has no first block at all (fails open)', () => {
    const editor = mountEditor('')
    expect(resolveCaretIntent('document-start', editor)).toBeNull()
  })

  it('document-end: resolves into a freshly-created trailing paragraph', () => {
    const editor = mountEditor(
      '<blockquote data-block="0"><p>a quote</p></blockquote>',
    )
    const target = resolveCaretIntent('document-end', editor)
    const trailing = editor.lastElementChild as HTMLElement
    expect(trailing.hasAttribute('data-vmarkd-trailing')).toBe(true)
    expect(target?.node).toBe(trailing.firstChild)
  })

  it('document-end: null when no trailing paragraph is possible', () => {
    const editor = mountEditor('<p data-block="0">just text</p>')
    expect(resolveCaretIntent('document-end', editor)).toBeNull()
  })

  it('{node, offset}: passes through unchanged when the node is inside the editor', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    const node = editor.firstElementChild!.firstChild!
    const target = resolveCaretIntent({ node, offset: 2 }, editor)
    expect(target).toEqual({ node, offset: 2 })
  })

  it('{node, offset}: null when the node is NOT (or no longer) inside the editor — a rebuild ate it', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    const detached = document.createTextNode('gone')
    expect(resolveCaretIntent({ node: detached, offset: 0 }, editor)).toBeNull()
  })

  // Task 487 — the structural intent exists BECAUSE {textOffset} cannot address an empty block; the
  // first test here is the one a character offset provably cannot pass (see the CaretIntent comment).
  it('{blockPath, offsetInBlock}: lands INSIDE an empty block — the blank line an Enter just made', () => {
    const editor = mountEditor(
      '<p data-block="0">foo</p><p data-block="0"></p>',
    )
    const target = resolveCaretIntent(
      { blockPath: [1], offsetInBlock: 0 },
      editor,
    )
    expect(target).toEqual({ node: editor.children[1], offset: 0 })
    // The same caret position as a character offset is indistinguishable from "end of foo" — proving
    // the two intents genuinely differ rather than the new one just restating the old one.
    expect(resolveCaretIntent({ textOffset: 3 }, editor)?.node).not.toBe(
      editor.children[1].firstChild,
    )
  })

  it('{blockPath, offsetInBlock}: counts characters WITHIN the named block only', () => {
    const editor = mountEditor(
      '<p data-block="0">foo</p><p data-block="0">bar</p>',
    )
    const target = resolveCaretIntent(
      { blockPath: [1], offsetInBlock: 1 },
      editor,
    )
    expect(target?.node).toBe(editor.children[1].firstChild)
    expect(target?.offset).toBe(1)
  })

  // Task 530 — a hard break (`<br>`) has no characters, so "after the break" and "before the break"
  // are one character offset; the undo checkpoint used to put the caret back BEFORE the break ~800 ms
  // after Shift+Enter, and the next typed character lost the break.
  it('{blockPath, offsetInBlock, breaksBefore}: lands AFTER a hard break, not before it', () => {
    const editor = mountEditor(
      '<p data-block="0">first<br data-marker="\\"><br></p>',
    )
    const p = editor.children[0]
    const before = resolveCaretIntent(
      { blockPath: [0], offsetInBlock: 5 },
      editor,
    )
    expect(before).toEqual({ node: p.firstChild, offset: 5 }) // the ambiguity: same number
    const after = resolveCaretIntent(
      { blockPath: [0], offsetInBlock: 5, breaksBefore: 1 },
      editor,
    )
    expect(after).toEqual({ node: p, offset: 2 }) // between the marked break and the placeholder
  })

  it('{breaksBefore}: counts breaks in order, and is a no-op at 0 / when the DOM has fewer', () => {
    const editor = mountEditor('<p data-block="0">a<br>b<br>c</p>')
    const p = editor.children[0]
    expect(
      resolveCaretIntent(
        { blockPath: [0], offsetInBlock: 2, breaksBefore: 2 },
        editor,
      ),
    ).toEqual({ node: p, offset: 4 })
    expect(
      resolveCaretIntent(
        { blockPath: [0], offsetInBlock: 1, breaksBefore: 0 },
        editor,
      ),
    ).toEqual({ node: p.firstChild, offset: 1 })
    expect(
      resolveCaretIntent(
        { blockPath: [0], offsetInBlock: 1, breaksBefore: 9 },
        editor,
      ),
    ).toEqual({ node: p.firstChild, offset: 1 })
  })

  it('{blockPath, offsetInBlock}: follows the path INTO a list item, not just the top-level <ul>', () => {
    const editor = mountEditor(
      '<ul data-block="0"><li>one</li><li>two</li></ul>',
    )
    const target = resolveCaretIntent(
      { blockPath: [0, 1], offsetInBlock: 2 },
      editor,
    )
    expect(target?.node).toBe(editor.querySelectorAll('li')[1].firstChild)
    expect(target?.offset).toBe(2)
  })

  // The regression that forced the path: with a single top-level index the <ul> was the block, so an
  // empty <li> shared one character space with its siblings and resolved back onto the previous item
  // — the original snap-back bug, reproduced one level down. Measured in the real webview.
  it('{blockPath, offsetInBlock}: lands in an EMPTY list item rather than the end of the one before', () => {
    const editor = mountEditor('<ul data-block="0"><li>one</li><li></li></ul>')
    const target = resolveCaretIntent(
      { blockPath: [0, 1], offsetInBlock: 0 },
      editor,
    )
    expect(target).toEqual({
      node: editor.querySelectorAll('li')[1],
      offset: 0,
    })
  })

  it('{blockPath, offsetInBlock}: clamps a block index past the end instead of missing forever', () => {
    const editor = mountEditor('<p data-block="0">foo</p>')
    const target = resolveCaretIntent(
      { blockPath: [9], offsetInBlock: 0 },
      editor,
    )
    expect(target?.node).toBe(editor.children[0].firstChild)
  })

  it('{blockPath, offsetInBlock}: clamps an offset past the block’s text to its end', () => {
    const editor = mountEditor('<p data-block="0">foo</p>')
    const target = resolveCaretIntent(
      { blockPath: [0], offsetInBlock: 99 },
      editor,
    )
    expect(target).toEqual({ node: editor.children[0].firstChild, offset: 3 })
  })

  it('{blockPath, offsetInBlock}: null on an editor with no blocks at all', () => {
    const editor = mountEditor('')
    expect(
      resolveCaretIntent({ blockPath: [0], offsetInBlock: 0 }, editor),
    ).toBeNull()
  })

  it('{textOffset}: walks text nodes depth-first and lands at the right one', () => {
    const editor = mountEditor(
      '<p data-block="0">foo</p><p data-block="0">bar</p>',
    )
    // "foo" (3 chars) + "bar" — offset 4 is 1 char into "bar".
    const target = resolveCaretIntent({ textOffset: 4 }, editor)
    expect(target?.node).toBe(editor.children[1].firstChild)
    expect(target?.offset).toBe(1)
  })

  it('{textOffset}: clamps beyond the end to the last text node’s end', () => {
    const editor = mountEditor('<p data-block="0">foo</p>')
    const target = resolveCaretIntent({ textOffset: 999 }, editor)
    expect(target?.node).toBe(editor.firstElementChild!.firstChild)
    expect(target?.offset).toBe(3)
  })

  it('{textOffset}: null when the editor has no text nodes at all', () => {
    const editor = mountEditor('<p data-block="0"><br></p>')
    expect(resolveCaretIntent({ textOffset: 0 }, editor)).toBeNull()
  })

  // Task 445: Range.insertNode splitting a Text boundary (Vditor's undo-snapshot wbr marker) can
  // leave an EMPTY leftover text node exactly where a captured offset of 0 lands — reproduced live
  // by patchUndoCaretSplitRestore's e2e (caret-click-during-init.spec.ts). Without the skip, offset
  // 0 lands ON the empty node (a caret nothing can paint); with it, offset 0 lands at the START of
  // the next REAL text, which is the position the split was supposed to preserve.
  it('{textOffset}: skips an empty leftover text node at the target offset (the split-marker case)', () => {
    const editor = mountEditor('')
    const p = document.createElement('p')
    p.setAttribute('data-block', '0')
    // Exact shape insertNode + remove() leaves behind: an empty text node where the split
    // happened, followed by the real content that was "after" the split point.
    p.appendChild(document.createTextNode(''))
    p.appendChild(document.createTextNode('real content'))
    editor.appendChild(p)

    const target = resolveCaretIntent({ textOffset: 0 }, editor)
    expect(target?.node).toBe(p.childNodes[1]) // the REAL text node, not the empty leftover
    expect(target?.offset).toBe(0)
  })

  it('{textOffset}: an editor with ONLY empty text nodes still resolves null, not onto one of them', () => {
    const editor = mountEditor('')
    const p = document.createElement('p')
    p.setAttribute('data-block', '0')
    p.appendChild(document.createTextNode(''))
    p.appendChild(document.createTextNode(''))
    editor.appendChild(p)
    expect(resolveCaretIntent({ textOffset: 0 }, editor)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------
describe('requestCaret — resolve, write, and the "skip a redundant write" optimisation', () => {
  it('writes a collapsed Range at the resolved position and returns true', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    expect(requestCaret('document-start')).toBe(true)
    const range = window.getSelection()!.getRangeAt(0)
    expect(range.collapsed).toBe(true)
    expect(range.startContainer).toBe(editor.firstElementChild!.firstChild)
    expect(range.startOffset).toBe(5)
  })

  it('returns false and touches nothing when the intent cannot be resolved', () => {
    mountEditor('') // no first block, no leading invariant run — resolution fails
    expect(requestCaret('document-start')).toBe(false)
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  it('returns false when there is no active editor at all', () => {
    ;(window as unknown as Record<string, unknown>).vditor = undefined
    expect(requestCaret('document-start')).toBe(false)
  })

  it('a stale offset that makes the Range write throw is treated as a miss, not an uncaught error', () => {
    // A {node, offset} intent resolved against a node that mutated between resolve and write (e.g.
    // a concurrent edit shortened the text) — range.setStart throws IndexSizeError; must degrade to
    // "unresolved" rather than escape a rAF callback uncaught.
    mountEditor('<p data-block="0">hi</p>')
    const node = document.querySelector('p')!.firstChild!
    expect(() => requestCaret({ node, offset: 999 })).not.toThrow()
    expect(requestCaret({ node, offset: 999 })).toBe(false)
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  it('does not re-write the selection when the Range is already exactly at the target', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    requestCaret('document-start')
    const before = window.getSelection()!.getRangeAt(0)
    // Spy on the Selection instance actually used, not a fresh window.getSelection() call.
    const sel = window.getSelection()!
    const addSpy = vi.spyOn(sel, 'addRange')
    const removeSpy = vi.spyOn(sel, 'removeAllRanges')
    expect(requestCaret('document-start')).toBe(true) // same intent, same resolved target
    expect(addSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
    expect(window.getSelection()!.getRangeAt(0)).toBe(before) // literally the same Range object
    void editor
  })

  it('a new request REPLACES the previously-live intent', () => {
    mountEditor('<p data-block="0">hello</p><p data-block="0">world</p>')
    requestCaret('document-start')
    expect(liveCaretIntentForTests()).toBe('document-start')
    requestCaret('document-end')
    expect(liveCaretIntentForTests()).toBe('document-end')
  })
})

// ---------------------------------------------------------------------------------------
describe('the re-assert loop — armed until painted, consumed, or given up on', () => {
  it('re-tries on the next frame while unpaintable, and resets the miss counter once painted', () => {
    mountEditor('<p data-block="0">hello</p>')
    setCaretPaintabilityProbeForTests(() => false)
    requestCaret('document-start')
    expect(frameCallbacks.length).toBe(1) // armed for a retry

    fireFrame()
    expect(liveCaretIntentForTests()).toBe('document-start') // still armed
    expect(frameCallbacks.length).toBe(1) // re-scheduled for the next frame

    setCaretPaintabilityProbeForTests(() => true)
    fireFrame()
    expect(liveCaretIntentForTests()).toBe('document-start') // stays armed even once painted…
    expect(frameCallbacks.length).toBe(1) // …the whole point being it can survive a LATER rebuild
  })

  it('reproduces 439 structurally: unresolvable at first (no first block yet), then a block appears', () => {
    // The exact shape of the 439 bug: an empty editor has ZERO element children at first (Vditor
    // creates the placeholder lazily) — 'document-start' has nothing to resolve to YET.
    const editor = mountEditor('')
    setCaretPaintabilityProbeForTests(() => true)
    expect(requestCaret('document-start')).toBe(false) // nothing to resolve to, this frame
    expect(liveCaretIntentForTests()).toBe('document-start') // stays armed rather than giving up

    // The lazy placeholder shows up (simulating Vditor's own splice, or gap-paragraph.ts's
    // leading invariant running on a later mutation pass).
    const p = document.createElement('p')
    p.setAttribute('data-block', '0')
    p.textContent = 'x'
    editor.appendChild(p)

    fireFrame()
    const range = window.getSelection()!.getRangeAt(0)
    expect(range.startContainer).toBe(p.firstChild) // resolved and painted once it existed
    expect(liveCaretIntentForTests()).toBe('document-start')
  })

  it('gives up after MAX_MISSES consecutive failures instead of retrying forever (fails open)', () => {
    mountEditor('') // never resolves — no first block ever appears
    requestCaret('document-start')
    expect(liveCaretIntentForTests()).toBe('document-start')
    fireFrames(200) // MAX_MISSES (90) plus headroom
    expect(liveCaretIntentForTests()).toBeNull()
    expect(frameCallbacks.length).toBe(0) // no more frames scheduled
  })
})

// ---------------------------------------------------------------------------------------
// Adversarial-review finding 1 (CONFIRMED, demonstrated): installCaretInvalidation only observes
// keydown/pointerdown/beforeinput/compositionstart on THIS webview's document. A full re-init
// (`initVditor`'s `window.vditor = null; window.vditor = new Vditor(...)`, e.g. from a
// constructor-only config change) or a mode switch (IR/WYSIWYG/SV each have their own `.element`)
// swaps out the editor an intent was armed against with NO gesture involved, and neither path is
// observed by those listeners — decision 3 says a stale intent must never win regardless, so the
// defence has to live where the WRITE happens (tick()'s identity check), not depend on every
// present-or-future re-init path remembering to call invalidateCaret().
describe('editor-instance binding — a stale intent never resolves against a swapped editor', () => {
  function mountSecondEditor(html: string): HTMLElement {
    const div = document.createElement('div')
    div.id = 'ed2'
    div.setAttribute('contenteditable', 'true')
    div.innerHTML = html
    document.body.appendChild(div)
    return div
  }

  it('a full re-init (window.vditor swapped) with ZERO gestures drops the intent instead of writing into the new editor', () => {
    const editorA = mountEditor('<p data-block="0">hello</p>')
    requestCaret('document-start') // arms against editorA
    expect(liveCaretIntentForTests()).toBe('document-start')

    // initVditor's own shape: `window.vditor = null; window.vditor = new Vditor(...)` — a brand
    // new instance and DOM, no keydown/pointerdown/beforeinput/compositionstart anywhere.
    const editorB = mountSecondEditor('<p data-block="0">world</p>')
    ;(window as unknown as Record<string, unknown>).vditor = undefined
    ;(window as unknown as Record<string, unknown>).vditor = {
      vditor: { currentMode: 'ir', ir: { element: editorB } },
    }

    fireFrame() // the pending tick from requestCaret's own schedule() call
    expect(
      liveCaretIntentForTests(),
      'the stale intent was dropped, not carried over to the new editor',
    ).toBeNull()
    // The ORIGINAL write (into editorA, from requestCaret's own synchronous call before the swap)
    // is still sitting in the single global Selection — that write is not undone, and is not the
    // thing under test here. What matters is that NOTHING was subsequently written into editor B.
    const sel = window.getSelection()!
    const stillInB =
      sel.rangeCount > 0 && editorB.contains(sel.getRangeAt(0).startContainer)
    expect(stillInB, 'editor B was never written into').toBe(false)
    void editorA
  })

  it('a mode switch (same vditor instance, a DIFFERENT .element) is caught the same way', () => {
    const editorIr = mountEditor('<p data-block="0">hello</p>')
    requestCaret('document-start')
    expect(liveCaretIntentForTests()).toBe('document-start')

    // Same window.vditor OBJECT, but currentMode/element now point at a different DOM tree — the
    // shape a real IR→WYSIWYG switch produces (each mode owns its own `.element`).
    const editorWysiwyg = mountSecondEditor('<p data-block="0">hello</p>')
    const v = (
      window as unknown as { vditor: { vditor: Record<string, unknown> } }
    ).vditor
    v.vditor.currentMode = 'wysiwyg'
    v.vditor.wysiwyg = { element: editorWysiwyg }

    fireFrame()
    expect(liveCaretIntentForTests()).toBeNull()
    const sel = window.getSelection()!
    const stillInWysiwyg =
      sel.rangeCount > 0 &&
      editorWysiwyg.contains(sel.getRangeAt(0).startContainer)
    expect(stillInWysiwyg, 'the wysiwyg editor was never written into').toBe(
      false,
    )
    void editorIr
  })

  it('locks in the first editor seen when armed before any editor existed, THEN still catches a later swap', () => {
    // requestCaret with no window.vditor at all — the defensive "editor: null until first seen"
    // path (production never actually hits this; a future caller might).
    ;(window as unknown as Record<string, unknown>).vditor = undefined
    setCaretPaintabilityProbeForTests(() => true)
    expect(requestCaret('document-start')).toBe(false)
    expect(liveCaretIntentForTests()).toBe('document-start') // stays armed, nothing to bind yet

    const editorA = mountEditor('<p data-block="0">hello</p>')
    fireFrame() // locks in editorA as the bound editor and resolves against it
    expect(window.getSelection()!.getRangeAt(0).startContainer).toBe(
      editorA.firstElementChild!.firstChild,
    )

    // NOW swap it out — the lock-in must hold from here just like the normal case.
    const editorB = mountSecondEditor('<p data-block="0">world</p>')
    ;(window as unknown as Record<string, unknown>).vditor = {
      vditor: { currentMode: 'ir', ir: { element: editorB } },
    }
    fireFrame()
    expect(liveCaretIntentForTests()).toBeNull()
  })

  it('does NOT interfere with the normal case: the same editor across many ticks resolves every time', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    setCaretPaintabilityProbeForTests(() => true)
    requestCaret('document-start')
    fireFrames(10)
    expect(liveCaretIntentForTests()).toBe('document-start')
    expect(window.getSelection()!.getRangeAt(0).startContainer).toBe(
      editor.firstElementChild!.firstChild,
    )
  })
})

// ---------------------------------------------------------------------------------------
// Adversarial-review finding 2: tick() rescheduled unconditionally on every successful paint, so a
// live intent left alone (arrow-nav to EOF, then nothing — scrolling is not an invalidation
// trigger) drove a PERPETUAL 60fps loop for the rest of the webview's life, contradicting ADR-0007's
// Cost section calling the machine "cheap". MAX_TOTAL_TICKS bounds the loop's TOTAL lifetime.
describe('MAX_TOTAL_TICKS — the loop is bounded, not perpetual (adversarial-review finding 2)', () => {
  it('a continuously-painted intent retires after MAX_TOTAL_TICKS frames instead of polling forever', () => {
    const editor = mountEditor('<p data-block="0">hello</p>')
    setCaretPaintabilityProbeForTests(() => true)
    requestCaret('document-start')
    fireFrames(320) // MAX_TOTAL_TICKS (300) plus headroom, matching the MAX_MISSES test's style
    expect(liveCaretIntentForTests()).toBeNull()
    expect(frameCallbacks.length).toBe(0) // no more frames scheduled — the loop actually stopped
    // Retiring is NOT un-placing: the Range this module already wrote stays exactly where it is.
    expect(window.getSelection()!.getRangeAt(0).startContainer).toBe(
      editor.firstElementChild!.firstChild,
    )
  })

  it('an intent alternating painted/unpainted every frame ALSO retires — MAX_MISSES alone cannot catch this', () => {
    // Neither counter this alternation resets to 0 ever crosses ITS OWN threshold: `misses` is
    // cleared by every painted frame, `stableFrames`-style bookkeeping would be cleared by every
    // unpainted one. Only a TOTAL, unconditional counter closes this loophole.
    const editor = mountEditor('<p data-block="0">hello</p>')
    let painted = true
    setCaretPaintabilityProbeForTests(() => {
      painted = !painted
      return painted
    })
    requestCaret('document-start')
    fireFrames(320)
    expect(liveCaretIntentForTests()).toBeNull()
    expect(frameCallbacks.length).toBe(0)
    void editor
  })
})

// ---------------------------------------------------------------------------------------
describe('installCaretInvalidation — a real user gesture always wins (decision 3)', () => {
  it('keydown drops the live intent unconditionally', () => {
    mountEditor('<p data-block="0">hello</p>')
    const dispose = installCaretInvalidation()
    requestCaret('document-start')
    expect(liveCaretIntentForTests()).toBe('document-start')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(liveCaretIntentForTests()).toBeNull()
    dispose()
  })

  it('pointerdown drops the live intent unconditionally', () => {
    mountEditor('<p data-block="0">hello</p>')
    const dispose = installCaretInvalidation()
    requestCaret('document-start')
    document.dispatchEvent(new Event('pointerdown'))
    expect(liveCaretIntentForTests()).toBeNull()
    dispose()
  })

  it('beforeinput drops the live intent unconditionally', () => {
    mountEditor('<p data-block="0">hello</p>')
    const dispose = installCaretInvalidation()
    requestCaret('document-start')
    document.dispatchEvent(new Event('beforeinput'))
    expect(liveCaretIntentForTests()).toBeNull()
    dispose()
  })

  // IME composition (e.g. CJK input) — see installCaretInvalidation's doc comment: Chromium fires
  // beforeinput for composition too, so this is likely redundant with it, but that is UNVERIFIED
  // (no IME in this project's test harness) — kept as an explicit second trigger rather than
  // assumed covered.
  it('compositionstart drops the live intent unconditionally', () => {
    mountEditor('<p data-block="0">hello</p>')
    const dispose = installCaretInvalidation()
    requestCaret('document-start')
    document.dispatchEvent(new Event('compositionstart'))
    expect(liveCaretIntentForTests()).toBeNull()
    dispose()
  })

  it('the disposer stops future invalidation', () => {
    mountEditor('<p data-block="0">hello</p>')
    const dispose = installCaretInvalidation()
    dispose()
    requestCaret('document-start')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(liveCaretIntentForTests()).toBe('document-start') // no listener left to clear it
  })

  // THE ordering guarantee documented on installCaretInvalidation: a keydown handler that sets a
  // FRESH intent (gap-nav.ts / gap-paragraph.ts's trailing-nav shape) must not have that intent
  // wiped out by the SAME keydown's invalidation, as long as invalidation is registered first —
  // same-target capture-phase listeners fire in registration order.
  it('registered FIRST: an intent set by a LATER capture-phase keydown handler survives the same event', () => {
    mountEditor('<p data-block="0">hello</p><p data-block="0">world</p>')
    const disposeAuthority = installCaretInvalidation() // registered first, as main.ts requires
    const onKeydown = () => requestCaret('document-end')
    document.addEventListener('keydown', onKeydown, true) // registered second, e.g. gap-nav.ts

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(liveCaretIntentForTests()).toBe('document-end') // survived — set AFTER invalidation ran

    document.removeEventListener('keydown', onKeydown, true)
    disposeAuthority()
  })

  it('misordered (for contrast): registered SECOND, invalidation wipes the intent the other handler just set', () => {
    mountEditor('<p data-block="0">hello</p><p data-block="0">world</p>')
    const onKeydown = () => requestCaret('document-end') // registered first this time
    document.addEventListener('keydown', onKeydown, true)
    const disposeAuthority = installCaretInvalidation() // registered second — the wrong order

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(liveCaretIntentForTests()).toBeNull() // wiped in the SAME event — the bug ordering avoids

    document.removeEventListener('keydown', onKeydown, true)
    disposeAuthority()
  })

  it('a SUBSEQUENT keydown (a later event) invalidates an intent armed after the first one', () => {
    mountEditor('<p data-block="0">hello</p><p data-block="0">world</p>')
    const dispose = installCaretInvalidation()
    // Only reacts to ArrowDown — matches gap-nav.ts / gap-paragraph.ts's own handlers, which are
    // keyed to specific keys, not every keydown (a handler that armed on EVERY key could never be
    // observed as invalidated, which is not what any real caller does).
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') requestCaret('document-end')
    }
    document.addEventListener('keydown', onKeydown, true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(liveCaretIntentForTests()).toBe('document-end')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' })) // the user types next
    expect(liveCaretIntentForTests()).toBeNull()

    document.removeEventListener('keydown', onKeydown, true)
    dispose()
  })
})

// ---------------------------------------------------------------------------------------
describe('invalidateCaret — direct drop, cancels the pending frame too', () => {
  it('clears the live intent and cancels the scheduled retry', () => {
    mountEditor('<p data-block="0">hello</p>')
    setCaretPaintabilityProbeForTests(() => false) // stays armed → schedules a frame
    requestCaret('document-start')
    expect(frameCallbacks.length).toBe(1)
    invalidateCaret()
    expect(liveCaretIntentForTests()).toBeNull()
    fireFrame() // the cancelled callback is a no-op (observe-coalesce's stub pattern)
    expect(window.getSelection()!.rangeCount).toBeGreaterThanOrEqual(0) // does not throw
  })
})

// ---------------------------------------------------------------------------------------
describe('wouldStealFocus — task 522: never let the re-assert loop pull focus off the user', () => {
  afterEach(() => vi.restoreAllMocks())

  it('false when the document has no focus (harness / blurred webview: the write moves no focus)', () => {
    const editor = mountEditor('<p>hello</p>')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    expect(wouldStealFocus(editor)).toBe(false)
  })

  it('true when the document has focus and the active element is outside the editor', () => {
    const editor = mountEditor('<p>hello</p>')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    expect(wouldStealFocus(editor)).toBe(true)
  })

  it("true when the document has focus and the active element is BODY (find's momentary focus)", () => {
    const editor = mountEditor('<p>hello</p>')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    expect(document.activeElement).toBe(document.body)
    expect(wouldStealFocus(editor)).toBe(true)
  })

  it('false when the editor already owns focus', () => {
    const editor = mountEditor('<p>hello</p>')
    editor.focus()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    expect(wouldStealFocus(editor)).toBe(false)
  })

  it('the loop skips re-assertions while stealing, keeps the intent armed, writes once it is safe', () => {
    const editor = mountEditor('<p>hello</p><p>world</p>')
    setCaretPaintabilityProbeForTests(() => true)
    requestCaret('document-start') // first placement is ungated
    const other = document.createRange()
    other.setStart(editor.lastElementChild!.firstChild!, 2)
    other.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(other)
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    fireFrames(3)
    expect(sel.getRangeAt(0).startContainer).toBe(other.startContainer) // untouched
    expect(liveCaretIntentForTests()).toBe('document-start') // still armed, not given up
    hasFocus.mockReturnValue(false)
    fireFrame()
    expect(sel.getRangeAt(0).startContainer).toBe(
      editor.firstElementChild!.firstChild,
    )
  })
})

describe('the loop while the host find widget is open — task 522', () => {
  afterEach(() => {
    setHostFindClosed()
    vi.restoreAllMocks()
  })

  it('skips re-assertions even when focus heuristics say it is safe, stays armed, resumes on find-close', () => {
    const editor = mountEditor('<p>hello</p><p>world</p>')
    setCaretPaintabilityProbeForTests(() => true)
    requestCaret('document-start')
    const other = document.createRange()
    other.setStart(editor.lastElementChild!.firstChild!, 2)
    other.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(other)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false) // wouldStealFocus() is false here
    setHostFindOpen()
    fireFrames(3)
    expect(sel.getRangeAt(0).startContainer).toBe(other.startContainer)
    expect(liveCaretIntentForTests()).toBe('document-start')
    setHostFindClosed()
    fireFrame()
    expect(sel.getRangeAt(0).startContainer).toBe(
      editor.firstElementChild!.firstChild,
    )
  })
})
