// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installEditorCaretTracking } from './editor-caret'
import { installFocusRestore } from './focus-restore'

/**
 * A minimal stand-in for the live editor: `activeModeElement` reads
 * `vditor.vditor[currentMode].element`, so that is all the shape this needs.
 */
function mountEditor(html = '<p id="para">hello world</p>'): HTMLElement {
  document.body.innerHTML = `<div class="vditor-ir"><pre id="ed" contenteditable="true">${html}</pre></div>`
  const editor = document.getElementById('ed') as HTMLElement
  ;(window as unknown as Record<string, unknown>).vditor = {
    vditor: { currentMode: 'ir', ir: { element: editor } },
  }
  return editor
}

/** Collapsed caret at `offset` in the first text node under `el`. */
function caretIn(el: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const text = walker.nextNode() as Text
  const range = document.createRange()
  range.setStart(text, offset)
  range.collapse(true)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Fire the window focus event and let the rAF the handler defers on run. jsdom implements
 * requestAnimationFrame as a timer, so awaiting two macrotasks is enough.
 */
async function refocusWindow() {
  window.dispatchEvent(new Event('focus'))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 20))
}

// Every test in this file exercises "the webview HAS OS focus, and something inside it went
// wrong" (task 389/445's own premise) — restoreEditorFocus now gates on document.hasFocus() (task
// 445's addendum: without this, the focusout listener would try to steal focus back into a webview
// the user just switched AWAY from). jsdom's hasFocus() defaults to false and only flips true once
// something in THIS document is genuinely focused, which none of these tests' setups guarantee
// before the code under test runs — so it's stubbed true file-wide, restored after.
const originalHasFocus = document.hasFocus
beforeEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  ;(window as unknown as Record<string, unknown>).vditor = undefined
  document.hasFocus = () => true
})
afterEach(() => {
  document.hasFocus = originalHasFocus
})

describe('installFocusRestore', () => {
  it('gives focus back to the editor when it returns to a bare BODY', async () => {
    const editor = mountEditor()
    caretIn(editor, 5)
    installFocusRestore(window)
    // The measured post-return state: the selection survived, focus did not.
    ;(document.body as HTMLElement).focus()
    expect(document.activeElement).not.toBe(editor)

    await refocusWindow()
    expect(document.activeElement).toBe(editor)
  })

  it('keeps the surviving caret where it is instead of resetting it to the start', async () => {
    const editor = mountEditor()
    caretIn(editor, 5)
    installFocusRestore(window)
    ;(document.body as HTMLElement).focus()

    await refocusWindow()
    const range = window.getSelection()!.getRangeAt(0)
    expect(range.startOffset).toBe(5)
    expect(range.collapsed).toBe(true)
  })

  it('does nothing when focus is already inside the editor', async () => {
    const editor = mountEditor()
    installFocusRestore(window)
    // Focus FIRST, then place the caret: focusing a contenteditable collapses the selection to its
    // start (jsdom does, and Chromium is allowed to) — which is precisely why the restore snapshots
    // the Range before it calls focus().
    editor.focus()
    caretIn(editor, 3)

    await refocusWindow()
    expect(document.activeElement).toBe(editor)
    expect(window.getSelection()!.getRangeAt(0).startOffset).toBe(3)
  })

  // Task 514 — VS Code's webview find widget. Activating a match hands the frame window a real
  // `focus` event which the frame gives straight back (measured in a real VS Code: focus at t,
  // blur at t+4ms, this module's rAF at t+9ms), because the find INPUT — host UI, outside this
  // document — is what the user is typing into. Restoring into that gap takes the find box's focus
  // away and sends the rest of the query into the document.
  it('does NOT restore on a TRUSTED window focus the document no longer holds (find widget)', async () => {
    const editor = mountEditor()
    caretIn(editor, 5)
    // A stand-in window whose `focus` handler this test calls directly: jsdom defines `isTrusted`
    // as a NON-configurable own property of every event it dispatches, so a browser-originated
    // focus cannot be forged through `dispatchEvent`. `installFocusRestore` already takes the
    // window as a parameter, so handing it a stub is the seam that exists for this.
    let onFocus: ((e: { isTrusted: boolean }) => void) | undefined
    installFocusRestore({
      addEventListener: (
        type: string,
        h: (e: { isTrusted: boolean }) => void,
      ) => {
        if (type === 'focus') onFocus = h
      },
      requestAnimationFrame: (cb: FrameRequestCallback) =>
        window.requestAnimationFrame(cb),
      document,
      getSelection: () => window.getSelection(),
      get vditor() {
        return (window as unknown as Record<string, unknown>).vditor
      },
    } as unknown as Window)
    ;(document.body as HTMLElement).focus()
    // The state one frame after the find widget's transient frame-focus: the event fired, but the
    // document does not have focus any more.
    document.hasFocus = () => false

    onFocus?.({ isTrusted: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).not.toBe(editor)
  })

  it('still restores on an UNTRUSTED window focus with no OS focus (the e2e harness path)', async () => {
    // caret-on-open.spec.ts dispatches a synthetic `window.dispatchEvent(new Event('focus'))`
    // because the harness never grants a freshly-opened editor real OS focus — `hasFocus()` never
    // flips true there. Gating the check on `isTrusted` is what keeps that path alive.
    const editor = mountEditor()
    caretIn(editor, 5)
    installFocusRestore(window)
    ;(document.body as HTMLElement).focus()
    document.hasFocus = () => false

    await refocusWindow()
    expect(document.activeElement).toBe(editor)
  })

  it('does NOT steal focus from another focusable element in the webview', async () => {
    // A toolbar input, a dialog field: focus is there because the user put it there. Restoring the
    // caret must never be a reason to take it away.
    const editor = mountEditor()
    caretIn(editor, 2)
    const input = document.createElement('input')
    document.body.appendChild(input)
    installFocusRestore(window)
    input.focus()

    await refocusWindow()
    expect(document.activeElement).toBe(input)
  })

  it('falls back to the tracked caret when no Range survived at all', async () => {
    // The webview was re-created rather than retained (or focus was never in the editor), so there
    // is nothing to snapshot. editor-caret.ts keeps the last in-editor caret for exactly this case.
    const editor = mountEditor()
    installEditorCaretTracking()
    caretIn(editor, 7)
    document.dispatchEvent(new Event('selectionchange'))
    installFocusRestore(window)

    window.getSelection()!.removeAllRanges()
    ;(document.body as HTMLElement).focus()

    await refocusWindow()
    expect(document.activeElement).toBe(editor)
    const sel = window.getSelection()!
    expect(sel.rangeCount, 'a caret was put back').toBe(1)
    expect(sel.getRangeAt(0).startOffset).toBe(7)
  })

  it('does NOT grab focus at open, when the caret was never in the editor', async () => {
    // The handler also runs on the webview's FIRST focus after open. Taking focus there would be a
    // new behaviour rather than a repair — the user has not aimed any keys at the editor yet, and
    // Space/PageDown over a freshly opened document is meant to scroll it.
    mountEditor()
    installFocusRestore(window)
    ;(document.body as HTMLElement).focus()

    await refocusWindow()
    expect(document.activeElement).toBe(document.body)
  })

  it('is inert when no editor is mounted', async () => {
    document.body.innerHTML = '<div>no vditor here</div>'
    installFocusRestore(window)
    await expect(refocusWindow()).resolves.toBeUndefined()
  })
})

// Task 445's structural gap: the window-`focus` listener above is blind to an INTRA-document focus
// move (the editable losing focus to a bare BODY while the window itself never blurs — no `focus`
// event on `window` fires at all in that case). `focusout` bubbles, so a document-level listener
// catches it too. NOT a claim that this fixes 445 — the round-5 reproduction there is a DIFFERENT
// mechanism (a DOM mutation zeroing caretHeight while activeElement never moves at all); this only
// closes the separate gap found by reading this file. See tasks/445-first-click-drops-the-caret.md.
describe('installFocusRestore — the focusout gap (task 445)', () => {
  /** Two macrotasks, same timing as refocusWindow's rAF wait — no window `focus` event needed here,
   *  jsdom dispatches `focusout` natively as part of `.focus()` moving focus away from an element. */
  async function settle() {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 20))
  }

  it('repairs an intra-document focus loss (editor → body) with NO window focus event at all', async () => {
    const editor = mountEditor()
    // jsdom quirk, not real-browser behaviour: `.blur()` on a contenteditable CLEARS
    // window.getSelection() outright (task 389's own measured table at the top of this file shows
    // the Range SURVIVING a real focus loss in VS Code — rangeCount stays 1). Seed the
    // editor-caret.ts snapshot fallback so this test exercises the same "no live Range, fall back
    // to the tracked one" path as the pre-existing "falls back to the tracked caret" case above,
    // instead of asserting something jsdom cannot model faithfully.
    installEditorCaretTracking()
    installFocusRestore(window)
    editor.focus()
    caretIn(editor, 5) // after focus, per the same ordering note as the window-focus tests above
    document.dispatchEvent(new Event('selectionchange')) // snapshot it before blur clears it

    // jsdom's `document.body.focus()` is a no-op once something else is focused (body isn't
    // explicitly focusable there) — `editor.blur()` is what actually lands on a bare BODY, same as
    // a real browser's "focus left to nowhere" (verified: `.blur()` moves activeElement to BODY;
    // `document.body.focus()` from a focused element does not).
    editor.blur() // editor -> body; the window itself never blurs
    expect(document.activeElement).not.toBe(editor)

    await settle()
    expect(document.activeElement).toBe(editor)
    expect(window.getSelection()!.getRangeAt(0).startOffset).toBe(5)
  })

  it('does NOT steal focus when it moved from the editor to another focusable element', async () => {
    // Same NOT_OURS_TO_TAKE policy as the window-focus path — a deliberate move (toolbar input,
    // dialog field) is never ours to take back, regardless of which trigger noticed the focus loss.
    const editor = mountEditor()
    installFocusRestore(window)
    editor.focus()
    caretIn(editor, 2)
    const input = document.createElement('input')
    document.body.appendChild(input)

    input.focus() // editor -> input, a deliberate move
    await settle()
    expect(document.activeElement).toBe(input)
  })

  it('ignores a focusout whose target is OUTSIDE the editor (an unrelated control blurring)', async () => {
    // Scoped to "the editable itself lost focus" — an unrelated toolbar control blurring to a bare
    // BODY must not yank focus into the editor; that would be a materially bigger behaviour change
    // ("any focus-to-nowhere anywhere refocuses the editor") than this gap needs.
    const editor = mountEditor()
    installFocusRestore(window)
    caretIn(editor, 3) // a caret exists, but the editable itself never had DOM focus
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    button.blur() // -> body; the focusout's target is the BUTTON, not the editor
    await settle()
    expect(document.activeElement).toBe(document.body)
  })

  // The regression a first cut of this addendum shipped (caught by re-running
  // caret-empty-typing.spec.ts, not by this suite — that test's own coverage is added here): a
  // focusout ALSO fires when the user switches AWAY from this document entirely (a different
  // tab/webview taking OS focus), and without a hasFocus() guard the deferred restore would try to
  // steal focus BACK into a webview the user just left — fighting the tab switch instead of
  // repairing anything.
  it('does NOT attempt a restore when the webview itself has lost OS focus (switched to a different tab)', async () => {
    const editor = mountEditor()
    installFocusRestore(window)
    editor.focus()
    caretIn(editor, 4)

    document.hasFocus = () => false // simulates the webview itself losing OS focus
    editor.blur() // -> body, same DOM shape as the intra-document case
    await settle()
    // No steal-back attempt: focus stays wherever it landed (body here — jsdom has nowhere else
    // for it to go — the real-world equivalent is a DIFFERENT webview now holding it).
    expect(document.activeElement).toBe(document.body)
  })

  it('does NOT restore when the selection is anchored OUTSIDE the editor (task 490)', async () => {
    // Clicking the rendered preview pane in split view moves the selection there and leaves
    // activeElement on a bare BODY — which looked exactly like the focus-went-nowhere case above.
    // It did not: it went to the preview. Restoring here would move the caret out from under the
    // user AND arm caret.ts's re-assert loop, which then collapses the selection they make next.
    // Measured on the focusout trigger (real VS Code, task 490), which is why the guard is scoped
    // to it — the window-`focus` path is task 389's "the user left and came back", where an anchor
    // outside the editor is stale rather than deliberate.
    const editor = mountEditor()
    // The editor DID hold the caret earlier and the tracker remembers it — without that this test
    // would pass for the wrong reason (nothing to restore), not because the guard held.
    installEditorCaretTracking()
    installFocusRestore(window)
    editor.focus()
    caretIn(editor, 2)
    document.dispatchEvent(new Event('selectionchange'))

    const preview = document.createElement('div')
    preview.className = 'vditor-preview'
    preview.innerHTML = '<p>rendered output</p>'
    document.body.appendChild(preview)
    editor.blur() // editor -> body, exactly as the preview click does
    caretIn(preview, 4) // ...and the click's own selection lands in the preview

    await settle()
    expect(document.activeElement, 'focus was not taken back').not.toBe(editor)
    const sel = window.getSelection()!
    expect(
      preview.contains(sel.anchorNode),
      'the selection stayed in the preview',
    ).toBe(true)
  })
})
