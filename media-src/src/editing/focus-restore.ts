// Task 389 — the caret disappears after leaving the editor and returning to the vMarkd tab.
//
// MEASURED in a real VS Code, because the three defects that look identical to a user have
// different fixes. What actually happens is the FIRST of them — focus is lost, the selection is not:
//
//   before leaving   activeElement=PRE.vditor-reset  rangeCount=1  offset=246  typing lands
//   after returning  activeElement=BODY              rangeCount=1  offset=246  typing goes nowhere
//
// The panel is created with `retainContextWhenHidden`, so the webview DOM — and with it the DOM
// selection — survives the round trip intact. What does not survive is focus: VS Code hands focus
// back to the webview's BODY, not to the contenteditable the caret lives in. A collapsed Range in an
// unfocused document paints no caret and receives no keystrokes, which is exactly the report: the
// caret is gone, and the place is still right underneath it.
//
// The sequence the frame sees across the round trip is `focusout` → `blur` → `focus`, with
// `activeElement === BODY` already set by the time `focus` fires. So `focus` on the window is the
// signal, and the repair is to put focus back on the editable element and keep the Range that is
// already there.
//
// The actual Range re-assert goes through caret.ts's requestCaret (ADR-0007 / task 446) — this
// module is one of the six the ADR names as a former direct writer. The "only re-assert if
// focusing actually disturbed it" guard this used to hand-roll is now requestCaret's own job (see
// caret.ts's tryPlace), so this module only needs to decide WHICH Range to ask for.
//
// Task 445's structural gap (found by reading this file, NOT yet verified as the cause of that
// report — the round-5 reproduction there is a different mechanism, a DOM mutation that zeroes
// caretHeight while activeElement never moves; see tasks/445-first-click-drops-the-caret.md before
// assuming this is a fix for it): the window-`focus` trigger above is blind to an INTRA-document
// focus move — the editable losing focus to a bare BODY while the window itself never blurs (no
// `focus` event on `win` fires at all). `focusout` bubbles, so a document-level listener catches
// that too; the SAME `restoreEditorFocus` policy applies unchanged (NOT_OURS_TO_TAKE still wins).
import { requestCaret } from './caret'
import { restoreEditorCaretIfLost } from './editor-caret'
import { isHostFindOpen } from './host-find'
import { activeModeElement } from '../util/source-map'

// Anything focusable the user could have deliberately put focus on inside the webview. If focus came
// back to one of these, it is not ours to take — only a bare BODY/HTML (VS Code's default target)
// means "nothing is focused".
const NOT_OURS_TO_TAKE =
  'input, textarea, select, button, [contenteditable="true"], [tabindex]'

// Split from restoreEditorFocus only to keep that function under the cognitive-complexity gate.
function restoreEditorFocusNow(win: Window, cameFromEditorBlur: boolean): void {
  const vditor = (win as unknown as { vditor?: unknown }).vditor
  if (!vditor) return
  const editor = activeModeElement(vditor)
  if (!editor) return

  const active = win.document.activeElement as HTMLElement | null
  // Already in the editor — the normal case for every focus event that is not a tab return.
  if (active && editor.contains(active)) return
  // Focus landed on something the user can actually interact with (a toolbar input, a dialog):
  // stealing it would be worse than the bug.
  if (
    active &&
    active !== win.document.body &&
    active.closest(NOT_OURS_TO_TAKE)
  )
    return

  // Task 490 — the selection is anchored somewhere ELSE in this document (the rendered preview pane
  // in split view, a diagram label, the outline). This module repairs focus that went NOWHERE;
  // anchored elsewhere is somewhere, and taking it back is doubly damaging here. It moves the caret
  // out from under what the user is doing, and — because the restore below arms caret.ts's re-assert
  // loop, which keeps rewriting that position on EVERY animation frame for up to 5 s (ADR-0007's
  // MAX_TOTAL_TICKS) — it also destroys the selection the user makes NEXT, one frame after they make
  // it. MEASURED (real VS Code, task 490): click in the sv preview pane → this fires with
  // activeElement=BODY and the anchor inside `.vditor-preview` → 570 ms later a 97-char selection
  // made there is collapsed by tick #35, so Ctrl+C copies the wrong text. That is task 386's
  // user-visible symptom, from a second, independent cause.
  //
  // Deliberately NOT gated on the selection being non-collapsed: a plain click in the preview leaves
  // a COLLAPSED anchor there (measured above), and it is that click's restore that arms the loop
  // which then eats the drag-selection that follows.
  //
  // Scoped to the focusout trigger, which is the only one 490 was measured on. The window-`focus`
  // path is task 389's original case — the user LEFT the webview and came back — and there an anchor
  // outside the editor is stale, not a statement of intent: bailing on it would hand the user back a
  // webview with nothing focused, which is the very symptom this module exists to repair.
  const anchorNode = cameFromEditorBlur
    ? (win.getSelection()?.anchorNode ?? null)
    : null
  const anchorEl =
    anchorNode instanceof Element
      ? anchorNode
      : (anchorNode?.parentElement ?? null)
  if (anchorEl && !editor.contains(anchorEl)) return

  // Snapshot the surviving Range BEFORE focusing: focusing a contenteditable is allowed to move the
  // caret to its start, and landing the user at the top of the document is the damaging variant of
  // this bug, not the fix for it.
  const caretRange = (): Range | null => {
    const sel = win.getSelection()
    const live = sel?.rangeCount ? sel.getRangeAt(0) : null
    return live && editor.contains(live.startContainer)
      ? live.cloneRange()
      : null
  }
  // If no Range survived (a re-created webview rather than a retained one), fall back to the caret
  // snapshot editor-caret.ts keeps on selectionchange for exactly this class of focus loss.
  const saved =
    caretRange() ?? (restoreEditorCaretIfLost() ? caretRange() : null)

  // NOTHING to restore means the caret was never in this editor — the webview's very first focus
  // after open, before the user has clicked anywhere. Taking focus there would be a new behaviour,
  // not a repair: it hands the editor keys the user has not aimed at it yet, and Space/PageDown over
  // a freshly opened document is meant to scroll it (see the prepaint scroll capture). Bail out.
  if (!saved) return

  // preventScroll: the view must stay exactly where the user left it — restoring the caret is not a
  // licence to scroll to it (same rule as the toolbar focus-scroll guard, task 71).
  editor.focus({ preventScroll: true })

  // requestCaret no-ops the write if focusing didn't actually disturb the Range (its own "skip a
  // redundant write" check, caret.ts's tryPlace) — this used to be hand-rolled here.
  requestCaret({ node: saved.startContainer, offset: saved.startOffset })
}

function restoreEditorFocus(win: Window, cameFromEditorBlur: boolean): void {
  // Task 522 — the HOST told us its find widget is open (host-find.ts): any focus churn now is
  // findInFrame's handshake with the find box, never a tab return, and the timing gates around the
  // callers cannot tell them apart reliably in a real VS Code. Gated here (not in the window-`focus`
  // handler) so the focusout path — the editor losing focus to the find box — is covered too.
  if (isHostFindOpen()) return
  restoreEditorFocusNow(win, cameFromEditorBlur)
}

// Task 522 — how long the window `focus` handler waits for a find-handshake `blur` (measured at
// ~4 ms after the focus when idle, later under load). 60 ms is ~15x the idle gap yet still below
// what a user perceives as a lagging caret after returning to the tab.
const SETTLE_MS = 60

/**
 * Put focus (and therefore the caret) back on the editable surface whenever the webview regains
 * focus with nothing focused inside it. Called once from main.ts; the listeners are on the window /
 * document, so they outlive every re-init.
 */
export function installFocusRestore(win: Window): void {
  // Task 522 — counts window `blur` events so the `focus` handler can tell whether the focus it saw
  // was taken straight back (see SETTLE_MS below).
  let blurCount = 0
  win.addEventListener('blur', () => {
    blurCount++
  })
  win.addEventListener('focus', (e) => {
    const blursAtFocus = blurCount
    // Settle window instead of one frame. VS Code sets `activeElement` to BODY as part of handing
    // focus back, so a synchronous restore can be undone by that handover — and, task 522 (MEASURED
    // in a real webview, captured stack `restoreEditorFocus ← this callback`), a single frame is
    // also too short to tell a find-widget handshake from a real tab return: Electron's findInFrame
    // gives the frame a `focus` and takes it back with a `blur` a few ms later on EVERY find
    // keystroke, and under load that `blur` sometimes lands AFTER the one animation frame this used
    // to wait, so `hasFocus()` was still true, the restore ran and pulled focus out of the find box.
    // Waiting SETTLE_MS and bailing if any `blur` arrived since the `focus` makes the handshake
    // (always blurs back) distinguishable from a tab return (does not). A synthetic `focus` (the
    // harness / caret-on-open.spec.ts) is never followed by a blur, so it still restores.
    setTimeout(
      () =>
        win.requestAnimationFrame(() => {
          if (blurCount !== blursAtFocus) return
          // Task 514 — Ctrl+F, then typing a query that MATCHES: the find box loses focus and the rest
          // of the keystrokes land in the document. MEASURED in a real VS Code (the recorder in
          // find-widget-focus.spec.ts): activating a match makes Chromium hand the webview FRAME window
          // a `focus` event (VS Code's webview find widget runs Electron's `findInFrame` against this
          // frame), which the frame gives straight back — the host's find INPUT is what the user is
          // typing into. The measured sequence is focus(t) → blur(t+4ms) → our rAF(t+9ms). Without this
          // gate the rAF fires `editor.focus()` into that gap, which pulls focus out of the find box and
          // ALSO arms caret.ts's re-assert loop, so the caret keeps stealing it back for seconds after.
          //
          // `hasFocus()` alone is the discriminator — a real tab return (task 389, this module's whole
          // reason to exist) still has it true a frame later, a find-match activation does not. Gated on
          // `isTrusted` because the harness dispatches a SYNTHETIC `window.dispatchEvent(new
          // Event('focus'))` to work around never granting a freshly-opened editor real OS focus
          // (caret-on-open.spec.ts) — there `hasFocus()` never flips true, so an ungated check would
          // silently disable this module in every spec that drives it that way.
          if (e.isTrusted && !win.document.hasFocus()) return
          restoreEditorFocus(win, false)
        }),
      SETTLE_MS,
    )
  })
  win.document.addEventListener('focusout', (e) => {
    const vditor = (win as unknown as { vditor?: unknown }).vditor
    if (!vditor) return
    const editor = activeModeElement(vditor)
    // Only react when the EDITABLE ITSELF is what's losing focus — a toolbar button or dialog
    // field blurring is not our concern, and without this filter every focus change anywhere in
    // the webview would call restoreEditorFocus (harmless per its own guards, but it would also
    // widen the policy to "any focus-to-nowhere anywhere refocuses the editor", which is a bigger
    // behaviour change than this gap needs — task 389/445 are both specifically about the EDITOR's
    // own caret going missing).
    if (!editor || !(e.target instanceof Node) || !editor.contains(e.target))
      return
    // Same deferral as the window `focus` listener: a real click that blurs-then-refocuses the
    // SAME element (or Vditor's own expandMarker re-asserting it) settles within a frame, and a
    // synchronous check here would misread that transient blur as focus actually being lost.
    win.requestAnimationFrame(() => {
      // A regression this addendum first shipped, caught by re-running caret-empty-typing.spec.ts
      // (not by this file's own suite — that gap is covered by focus-restore.test.ts's own
      // "does NOT attempt a restore when the webview itself has lost OS focus" case now): a
      // focusout ALSO fires when the user switches AWAY from this document entirely (a different
      // tab/webview taking OS focus) — a real DOM focus loss is a real DOM focus loss, regardless
      // of WHY. Without this check the restore would try to steal focus BACK into a webview the
      // user just left, fighting VS Code's own tab switch instead of repairing anything. The
      // window-`focus` listener above does NOT need this same check: that event's own semantics
      // (only fires once this webview has regained focus) already imply it — checking hasFocus()
      // there too would be redundant in production and actively wrong under this harness, which
      // dispatches a SYNTHETIC `focus` event to work around never granting a freshly-opened editor
      // real OS focus (see caret-on-open.spec.ts's header comment) — hasFocus() never flips true
      // there, so gating on it would silently break that whole path.
      if (!win.document.hasFocus()) return
      restoreEditorFocus(win, true)
    })
  })
}
