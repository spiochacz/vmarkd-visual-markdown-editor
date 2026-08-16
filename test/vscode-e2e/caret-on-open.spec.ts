import { type EvaluateInVSCode, wf } from './webview-helpers'
// Task 439 — scope (revised): place the caret ONLY when a document opens genuinely EMPTY, in the
// real webview (caret/focus only reproduces there — see the probe spec and
// [[webview-focus-scroll-not-in-harness]]). A document with any content must be left exactly at
// the measured pre-fix baseline (rangeCount === 0, nothing focused) — the user does not want
// caret/focus behaviour touching real documents. This is the FIX verification: the probe
// (caret-on-open-probe.spec.ts) measured that baseline for BOTH fixtures and stays as the
// committed baseline record; this spec asserts placeInitialCaret's actual behaviour differs by
// fixture — empty gets a caret + (via the focus-restore handoff) focus and a real keystroke lands
// at the start; the with-text fixture gets nothing at all, proven by re-measuring the same
// baseline after open.
//
// This xvfb/Playwright/Electron harness does NOT grant a freshly opened editor real OS focus
// (measured: document.hasFocus() stays false for seconds after open, even though this is the
// only/active editor — every other real-keyboard spec in this suite clicks first for the same
// reason). placeInitialCaret is gated on document.hasFocus() precisely so it never steals focus
// from a background tab, so under this harness it correctly sets the selection WITHOUT focusing.
// Rather than fake real OS focus (which a raw `.click()` would also disturb the very caret
// position under test), the empty-doc case dispatches the `window` focus event focus-restore.ts
// listens for — exactly what happens the moment a real webview regains OS focus — and asserts the
// caret survives that handoff untouched, proving the documented placeInitialCaret ↔ focus-restore
// interplay end to end before typing.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

/** Selection/focus state for the default IR editable, read inside the webview iframe. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page probe reading caret/focus/selection state across the editable-element-present/absent branches; pre-existing (task 469 baseline)
function measure(_body: Element) {
  const editor = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  const active = document.activeElement
  const sel = window.getSelection()
  const rangeCount = sel?.rangeCount ?? 0
  let collapsed = false
  let startOffset = -1
  let blockIndex = -1
  if (rangeCount > 0 && sel && editor) {
    const r = sel.getRangeAt(0)
    collapsed = r.collapsed
    startOffset = r.startOffset
    if (r.startContainer === editor && editor.childElementCount === 0) {
      // A genuinely empty document's editable has ZERO element children right after open —
      // measured: Vditor only creates its placeholder paragraph lazily, on the first click/edit,
      // not at open. Collapsing directly onto the (empty) editable container is the correct "first
      // block" placement for this case, so count it as block 0 rather than "no block found".
      blockIndex = 0
    } else {
      let el: Element | null =
        r.startContainer.nodeType === Node.ELEMENT_NODE
          ? (r.startContainer as Element)
          : r.startContainer.parentElement
      while (el && el.parentElement !== editor && el !== editor) {
        el = el.parentElement
      }
      if (el && el.parentElement === editor) {
        blockIndex = Array.from(editor.children).indexOf(el)
      }
    }
  }
  // THE assertion this spec was missing when it passed against a broken build: a Range can exist,
  // be collapsed, and sit at the right offset — and still be impossible to draw a caret at. A
  // collapsed Range reports a zero-WIDTH but non-zero HEIGHT rect wherever a caret can be painted;
  // in an EMPTY container it reports height 0, which is exactly the shipped bug ("the caret flashed
  // and disappeared"). Measure the height, not just the position.
  let caretHeight = -1
  if (rangeCount > 0 && sel) {
    caretHeight = Math.round(sel.getRangeAt(0).getBoundingClientRect().height)
  }
  return {
    activeIsEditor: !!(editor && active && editor.contains(active)),
    rangeCount,
    collapsed,
    startOffset,
    blockIndex,
    caretHeight,
  }
}

type Measurement = ReturnType<typeof measure>

async function openFixture(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
) {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [fixture] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Let finish-init (and placeInitialCaret within it) settle — mirrors the probe spec's timing.
  await settle(frame, 500)
  return frame
}

async function currentValue(frame: ReturnType<typeof wf>): Promise<string> {
  // Read the in-memory editor value directly (vditor.getValue()) rather than the on-disk file —
  // the fixture must never be saved/mutated by this test.
  return frame.locator('body').evaluate(() => {
    const v = (window as unknown as { vditor?: { getValue?: () => string } })
      .vditor
    return v?.getValue?.() ?? ''
  })
}

async function dispatchWebviewFocus(frame: ReturnType<typeof wf>) {
  // See the header comment: simulates the webview regaining real OS focus, which is what
  // focus-restore.ts's `window.addEventListener('focus', …)` listens for (it defers to a
  // requestAnimationFrame — settle briefly for that to run, same as focus-restore.test.ts).
  await frame
    .locator('body')
    .evaluate(() => window.dispatchEvent(new Event('focus')))
  await settle(frame, 100)
}

test('empty document: caret at (block 0, offset 0), survives the focus handoff, typed char lands at the very start', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const frame = await openFixture(workbox, evaluateInVSCode, EMPTY_FIXTURE)

  const beforeFocus = (await frame
    .locator('body')
    .evaluate(measure)) as Measurement
  expect(beforeFocus.rangeCount, 'a Range was created on open').toBe(1)
  expect(beforeFocus.collapsed, 'the Range is collapsed').toBe(true)
  expect(
    beforeFocus.blockIndex,
    'caret sits in the first top-level block',
  ).toBe(0)
  // Offset 1 = right after the ZWSP seed of the paragraph placeInitialCaret creates for an empty
  // document (the editable has no children of its own until the user types).
  expect(beforeFocus.startOffset, 'caret is after the seed').toBe(1)
  // The regression that shipped: everything above passed while the caret was invisible.
  expect(
    beforeFocus.caretHeight,
    'the caret has somewhere to be PAINTED (zero height = invisible caret)',
  ).toBeGreaterThan(0)

  await dispatchWebviewFocus(frame)
  const m = (await frame.locator('body').evaluate(measure)) as Measurement
  expect(m.activeIsEditor, 'editor is document.activeElement after focus').toBe(
    true,
  )
  expect(m.rangeCount, 'exactly one Range exists').toBe(1)
  expect(m.collapsed, 'the Range is still collapsed').toBe(true)
  expect(m.blockIndex, 'caret still sits in the first top-level block').toBe(0)
  expect(
    m.startOffset,
    'caret is still after the seed following the focus handoff',
  ).toBe(1)
  expect(
    m.caretHeight,
    'the caret is still paintable after the focus handoff',
  ).toBeGreaterThan(0)

  await workbox.keyboard.type('Q')
  await settle(frame, 300)
  const value = await currentValue(frame)
  // Lute always serialises a trailing newline (every fixture in this suite ends in one too), so
  // the fully-inserted single-character document is "Q\n", not bare "Q".
  expect(value, 'typed char inserted at the very start of the empty doc').toBe(
    'Q\n',
  )
})

test('document with content: opening it does not touch caret/focus at all', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const frame = await openFixture(workbox, evaluateInVSCode, TEXT_FIXTURE)

  // Re-assert the SAME pre-fix baseline the probe spec measured for this fixture: no Range
  // anywhere, nothing focused. placeInitialCaret must be a complete no-op for any document that
  // has content — this is the proof that it is.
  const m = (await frame.locator('body').evaluate(measure)) as Measurement
  expect(m.activeIsEditor, 'editor is NOT document.activeElement').toBe(false)
  expect(m.rangeCount, 'no Range was created').toBe(0)

  // Give the (nonexistent) focus-restore handoff a chance to run too — still nothing, since
  // placeInitialCaret never created a Range for it to pick up on a content document.
  await dispatchWebviewFocus(frame)
  const m2 = (await frame.locator('body').evaluate(measure)) as Measurement
  expect(
    m2.activeIsEditor,
    'still not focused after a simulated focus handoff',
  ).toBe(false)
  expect(m2.rangeCount, 'still no Range after a simulated focus handoff').toBe(
    0,
  )
})
