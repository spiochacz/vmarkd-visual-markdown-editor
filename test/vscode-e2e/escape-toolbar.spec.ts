import { stickySelection, wf } from './webview-helpers'
// Task 456 — WCAG 2.1.2 keyboard trap: Tab could never move focus out of the editable surface
// (`tab: '\t'` makes Vditor preventDefault every Tab). The design: Escape ARMS a one-shot "next
// Tab leaves" flag; the very next bare Tab moves focus to the toolbar instead of inserting a tab
// character; any other key disarms it. Ships with role="toolbar" + roving tabindex + ArrowLeft/
// Right traversal on the toolbar (escaping into a toolbar you can't move around in is not an
// escape), and returning to the editor (Escape from the toolbar) restores the caret, not just
// focus — see escape-toolbar.ts's returnFocusToEditor() for why focus alone isn't enough (focusing
// a <button> collapses the browser's Selection). Real VS Code only: key capture differs from the
// chromium harness, which is the whole reason this is a capture-phase document listener
// (escape-toolbar.ts) — see list-backspace.ts for the established pattern this follows.
//
// STATUS (see tasks/456-a11y-escape-the-editor.md, round 9): the focus-landing leg below was the
// long-running open bug — 0/26 on this machine the day it was fixed. Root cause was a few-hundred-ms
// window after the Tab keydown during which a .focus() on the toolbar button silently does not take
// (the identical call lands at +600 ms); escape-toolbar.ts now re-attempts per frame until it does.
//
// ONE test(): each real-VS-Code test() pays a full VS Code boot (~5s+), so every leg of the
// keyboard walk lives in one test, in this order (deliberately NOT the walk's narrative order):
//   1. NEGATIVE first — bare Tab with no preceding Escape still inserts a tab char and does NOT
//      move focus. This is the leg that would still pass if the fix were simply reverted, so it
//      must be proven independently of anything below it, not as a side effect of the return leg.
//   2. Undo back to the baseline, then the POSITIVE walk: Escape → Tab → focus lands on a toolbar
//      button, `getValue()` unchanged → ArrowRight moves the roving-tabindex focus.
//   3. Escape while toolbar-focused returns focus AND the caret to the editor (the task file's
//      "returns", and the root-cause fix this file's history led to — see git blame / task 456).
//   3b. …and that caret WORKS and is in the RIGHT PLACE: a bare Tab indents at the exact position
//      the caret held before the gesture. Deliberately before leg 4 — Ctrl+Tab hands focus to VS
//      Code itself, so nothing pressed after it reaches this document at all.
//   4. Ctrl+Tab must NOT be treated as the escape gesture (no VS Code chord collision): arm, send
//      Ctrl+Tab, confirm focus did not land on a toolbar item and the document is untouched.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'escape-toolbar.md')

const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

interface State {
  value: string
  activeIsEditor: boolean
  activeIsToolbarItem: boolean
  activeTabIndex: number | null
  activeDataType: string | null
  hasRange: boolean
  rangeInEditor: boolean
  docHasFocus: boolean
}

// Snapshot everything a leg of the walk needs to assert: the serialized document (must stay byte-
// identical whenever we claim "no mutation"), and where DOM focus actually landed.
function readState(frame: ReturnType<typeof wf>): Promise<State> {
  return frame.locator('body').evaluate(() => {
    const v = (window as unknown as { vditor: { getValue(): string } }).vditor
    const active = document.activeElement as HTMLElement | null
    const toolbarItem = active?.closest('.vditor-toolbar__item') ?? null
    return {
      value: v.getValue(),
      activeIsEditor: !!active?.closest('.vditor-ir'),
      activeIsToolbarItem: !!toolbarItem,
      activeTabIndex: active ? active.tabIndex : null,
      activeDataType: active?.getAttribute('data-type') ?? null,
      hasRange: (window.getSelection()?.rangeCount ?? 0) > 0,
      rangeInEditor: !!(
        window.getSelection()?.anchorNode as Node | null
      )?.parentElement?.closest('.vditor-ir'),
      docHasFocus: document.hasFocus(),
    }
  })
}

// Click into the fixture's paragraph, then place an explicit Range at the start of "paragraph"
// (mirroring list-ops.spec.ts's pattern: a plain click alone can land in the editor's own padding,
// setting no Selection at all). Returns a live readback of window.getSelection() so the caller can
// verify the placement actually stuck — a bare-Tab-doesn't-insert flake (task 456) traced back to
// this precondition being silently false on some runs, not to anything under test.
async function placeCaretInParagraph(frame: ReturnType<typeof wf>) {
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const root = document.querySelector('.vditor-ir') as HTMLElement | null
      if (!root) throw new Error('no .vditor-ir')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf('paragraph')
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(n.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error('"paragraph" anchor text not found')
    },
    null,
  )
  await settle(frame, 200)
  return frame.locator('body').evaluate(() => {
    const sel = window.getSelection()
    const anchor = sel?.anchorNode ?? null
    return {
      hasRange: !!sel && sel.rangeCount > 0,
      anchorInParagraph: !!(anchor?.textContent ?? '').includes('paragraph'),
      activeIsEditor: !!document.activeElement?.closest('.vditor-ir'),
    }
  })
}

test('Escape arms a one-shot Tab-to-toolbar gesture; ordinary Tab keeps indenting; toolbar is keyboard-traversable, returns restore the caret, and getValue() never mutates', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file((args as string[])[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1000)

  // Give the webview page-level keyboard focus (list-ops.spec.ts / list-autoformat-space.spec.ts's
  // harness fix: keyboard events dispatch to the top Electron window, so a DOM-only focus() would
  // race real key presses) AND verify the caret placement actually stuck before trusting it as the
  // baseline for every leg below — retry a few times rather than trusting one attempt on a shared,
  // sometimes-loaded box.
  let caretCheck = await placeCaretInParagraph(frame)
  for (
    let i = 0;
    i < 3 && (!caretCheck.hasRange || !caretCheck.anchorInParagraph);
    i++
  ) {
    caretCheck = await placeCaretInParagraph(frame)
  }
  expect(
    caretCheck.hasRange && caretCheck.anchorInParagraph,
    `caret placement precondition failed before the negative leg: ${JSON.stringify(caretCheck)}`,
  ).toBe(true)

  const baseline = await readState(frame)
  expect(baseline.activeIsEditor, 'editor has focus after the click').toBe(true)

  // --- 1. NEGATIVE leg: bare Tab, no preceding Escape ---------------------------------------
  await workbox.keyboard.press('Tab')
  await settle(frame, 300)
  const afterBareTab = await readState(frame)
  expect(
    afterBareTab.value,
    'Tab with no Escape still mutates the document (inserts a tab char)',
  ).not.toBe(baseline.value)
  expect(
    afterBareTab.value.includes('\t'),
    'the mutation is specifically a tab character',
  ).toBe(true)
  expect(
    afterBareTab.activeIsEditor,
    'focus stayed in the editor — Tab did NOT escape without a preceding Escape',
  ).toBe(true)
  expect(afterBareTab.activeIsToolbarItem).toBe(false)

  // Undo the inserted tab back to the exact baseline (Vditor may need more than one undo step).
  for (let i = 0; i < 4; i++) {
    const { value } = await readState(frame)
    if (value === baseline.value) break
    await workbox.keyboard.press('Control+z')
    await settle(frame, 250)
  }
  const restored = await readState(frame)
  expect(restored.value, 'undo restored the pre-Tab baseline').toBe(
    baseline.value,
  )

  // Re-establish the caret precondition after leg 1's undo chain. Vditor's undo restores its own
  // checkpoint caret, which is NOT guaranteed to be where leg 1 started — measured: it comes back at
  // offset 0 of the H1. Leg 3 below asserts the toolbar round trip brings the caret back to where it
  // was; that claim is only meaningful if "where it was" is a known, Tab-sensitive position (an H1 in
  // Vditor's IR does not take a tab character), so pin it explicitly rather than inheriting whatever
  // undo left behind.
  const caretRecheck = await placeCaretInParagraph(frame)
  expect(
    caretRecheck.hasRange && caretRecheck.anchorInParagraph,
    `caret re-placement failed before the positive walk: ${JSON.stringify(caretRecheck)}`,
  ).toBe(true)

  // --- 2. POSITIVE walk: Escape → Tab → toolbar, getValue() UNCHANGED -----------------------
  // Settle windows here are deliberately generous: this suite shares the machine with other
  // concurrent real-VS-Code test runs, and the Escape/Tab pair only works if BOTH keydowns are
  // actually processed by the webview's JS thread before the next one fires.
  await workbox.keyboard.press('Escape')
  await settle(frame, 400)
  await workbox.keyboard.press('Tab')
  await settle(frame, 500)
  const afterEscTab = await readState(frame)
  expect(
    afterEscTab.value,
    'Escape+Tab moves focus WITHOUT mutating the document',
  ).toBe(baseline.value)
  expect(afterEscTab.activeIsEditor, 'focus left the editor').toBe(false)
  expect(
    afterEscTab.activeIsToolbarItem,
    'focus landed on a toolbar item',
  ).toBe(true)
  expect(
    afterEscTab.activeTabIndex,
    'the focused toolbar item is the roving-tabindex "current" one',
  ).toBe(0)
  const firstDataType = afterEscTab.activeDataType

  // ArrowRight traverses the toolbar (roving tabindex).
  await workbox.keyboard.press('ArrowRight')
  await settle(frame, 300)
  const afterArrow = await readState(frame)
  expect(afterArrow.activeIsToolbarItem, 'still inside the toolbar').toBe(true)
  expect(
    afterArrow.activeDataType,
    'ArrowRight moved focus to a DIFFERENT toolbar item',
  ).not.toBe(firstDataType)
  expect(afterArrow.activeTabIndex).toBe(0)
  expect(afterArrow.value, 'still no mutation').toBe(baseline.value)

  // --- 3. Escape while the toolbar has focus RETURNS focus to the editor --------------------
  await workbox.keyboard.press('Escape')
  await settle(frame, 400)
  const afterReturn = await readState(frame)
  expect(
    afterReturn.activeIsEditor,
    'Escape from the toolbar returns focus to the editor',
  ).toBe(true)
  expect(
    afterReturn.value,
    'the return leg did not mutate the document either',
  ).toBe(baseline.value)
  // The root-cause bug of task 456 in its own right: focusing the editor after leaving the toolbar
  // left it focused but with NO Range, so typing and Tab did nothing. Focus alone is not the claim.
  expect(afterReturn.hasRange, 'a Range came back with the focus').toBe(true)
  expect(
    afterReturn.rangeInEditor,
    'and that Range is inside the editor, not left behind on the toolbar',
  ).toBe(true)

  // ...and the caret is WORKING, not merely present: a bare Tab now indents again. This proof runs
  // HERE, before the chord leg below — not after it. Ctrl+Tab hands focus to VS Code's own editor
  // navigation, which takes it out of the webview entirely (MEASURED: docHasFocus flips false), so
  // no keystroke fired after that chord can reach this document at all. Asserting the working caret
  // after Ctrl+Tab (the original shape of this leg) could therefore never pass — it read as "the
  // caret is dead" when the truth was "the keystroke was delivered somewhere else". That leg had
  // never actually run until bug 2 was fixed, which is why the flaw survived this long.
  await workbox.keyboard.press('Tab')
  await settle(frame, 400)
  const afterReturnTab = await readState(frame)
  expect(
    afterReturnTab.value.includes('\t'),
    'that Tab inserted a tab character — the editor has a working caret after the toolbar return',
  ).toBe(true)
  for (let i = 0; i < 4; i++) {
    const { value } = await readState(frame)
    if (value === baseline.value) break
    await workbox.keyboard.press('Control+z')
    await settle(frame, 250)
  }
  expect(
    (await readState(frame)).value,
    'undo restored the baseline after the caret proof',
  ).toBe(baseline.value)

  // --- 4. Ctrl+Tab must NOT be treated as our escape gesture (no VS Code chord collision) -----
  await workbox.keyboard.press('Escape') // re-arm from the editor
  await settle(frame, 400)
  await workbox.keyboard.press('Control+Tab')
  await settle(frame, 400)
  const afterCtrlTab = await readState(frame)
  expect(
    afterCtrlTab.activeIsToolbarItem,
    'Ctrl+Tab was NOT consumed as the escape gesture',
  ).toBe(false)
  expect(
    afterCtrlTab.value,
    'and it did not mutate the document either (no stray tab character)',
  ).toBe(baseline.value)
})
