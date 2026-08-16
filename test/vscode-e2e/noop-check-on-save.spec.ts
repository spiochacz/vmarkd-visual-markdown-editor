import { placeCaretAtEndOf, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 434 — isSemanticNoop's whole-doc check moved OFF the 250ms edit-sync tick (it was the one
// expensive step there — measured 74ms@10KB to 2s+@100KB) onto a separate, longer idle timer
// (WritebackController.NOOP_CHECK_IDLE_MS, 1200ms), with checkNoopOnWillSave as the correctness
// backstop for every SAVE (any trigger), applied atomically via vscode.workspace.onWillSaveTextDocument
// + event.waitUntil. This spec proves BOTH halves independently:
//   1. the deferred idle timer alone (no save) restores the clean baseline once the document settles
//      — undo-dirty-probe.spec.ts already proves this at its own (2000ms) cadence; this spec targets
//      the NEW mechanism's OWN (1200ms) window specifically, unchanged, so a future change to the
//      constant is caught here first.
//   2. saving IMMEDIATELY after a revert-to-baseline (well within the 1200ms idle window, before the
//      deferred timer would have fired on its own) still lands the EXACT baseline bytes on DISK, not
//      the un-corrected (reflowed) intermediate write — proving the willSave backstop, not the timer,
//      is what caught it.
const SRC = path.join(__dirname, 'fixtures', 'undo-dirty.md')

// The text typed and then undone. Undo removes from the END, so any survivor is a PREFIX of this —
// hence the character-class residue check below rather than a whole-string `includes()`, which a
// leftover "x" would slip straight past.
const MARKER = 'xyz123'

type EvalInVSCode = (
  fn: (vscode: typeof import('vscode'), args: string[]) => unknown,
  args: string[],
) => Promise<unknown>

const hostText = async (
  evaluateInVSCode: EvalInVSCode,
  tmp: string,
): Promise<string> =>
  (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [tmp],
  )) as string

// Any surviving fragment of the marker, read off the HOST document (the authority — the webview may
// still be mid-repaint). Anchored to the fixture's own line ending so ordinary document text
// containing an "x" cannot read as residue.
async function markerResidue(
  evaluateInVSCode: EvalInVSCode,
  tmp: string,
): Promise<boolean> {
  const text = await hostText(evaluateInVSCode, tmp)
  return new RegExp(`newline[${MARKER}]`).test(text)
}

// Put the caret at the end of the "Edit here" line, VERIFIED. Extracted so the undo loop can
// RE-establish focus (2026-08-12): under CPU contention the webview can lose keyboard focus
// outright, and then Ctrl+Z goes nowhere no matter how many times it is pressed.
//
// It used to click the editor's top-left corner and then write a `Range` — which is what actually
// made this spec flake (2026-08-15, measured 4 of 10 under 8×`yes` CPU load). Vditor restores its
// own caret asynchronously after that corner click, discarding the synthetic range, so the marker
// was typed into the `# Title` heading instead of the "Edit here" line: the failure surfaced as
// `# xyz123Title` in the final diff, and — because the residue check is anchored to "newline" —
// the undo loop saw no residue, returned without undoing anything, and the deferred-timer poll
// then timed out on a document that had never been reverted. See placeCaretAtEndOf's own comment.
async function focusEditLine(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
) {
  await placeCaretAtEndOf(frame, workbox, '.vditor-ir p', 'Edit here')
}

async function typeAndUndo(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  evaluateInVSCode: EvalInVSCode,
  tmp: string,
) {
  await focusEditLine(workbox, frame)
  await workbox.keyboard.type(MARKER, { delay: 50 })
  // Let the insertion itself land before undoing it (matches undo-dirty-probe's own pacing —
  // reliability of the undo sequence matters more here than speed; the timing race this spec
  // actually cares about is how soon AFTER undo completes the save fires, not how fast the undo
  // itself runs — see waitForUndoToLand, called separately by the save-immediately test).
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  // Undo until the marker is GONE, not a fixed 12 presses (2026-08-12). The fixed loop was
  // load-sensitive and made this file flake in the FAST tier while passing 6/6 solo — reproduced
  // deliberately under CPU load (1 failed / 3 passed, retries off), so this is measured, not
  // guessed. Mechanism: `keyboard.press` resolves when the key is DISPATCHED, not when the webview
  // has processed it, so under contention the undo stream drains slower than the loop's fixed
  // budget and a PREFIX of the marker survives ("…newlinex", "…newlinexy" in the two observed
  // failures). That residue is a genuine semantic edit, so isSemanticNoop correctly refuses to
  // revert it — meaning the poll downstream could never pass, and the failure looked like a
  // deferred-timer bug when it was really an unfinished undo. Checking the HOST document after
  // each press removes the pacing assumption entirely; the downstream 3s poll then measures only
  // what it claims to (the deferred timer), which is what makes its own diagnostic bound honest.
  for (let i = 0; i < 40; i++) {
    if (!(await markerResidue(evaluateInVSCode, tmp))) return
    // Re-focus every 6th press. A lost webview focus is the failure mode that no number of
    // keystrokes recovers from (see focusEditLine), and it is invisible from the host side — the
    // document simply stops changing. Re-asserting focus periodically turns that dead end into a
    // recoverable one without re-clicking on every single press (each click is a real round-trip).
    if (i > 0 && i % 6 === 0) await focusEditLine(workbox, frame)
    await workbox.keyboard.press('Control+z')
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 200)))
  }
  if (await markerResidue(evaluateInVSCode, tmp))
    throw new Error(
      `undo never cleared the "${MARKER}" marker after 40 presses with periodic re-focus — not a pacing or focus issue, look at the undo stack itself`,
    )
}

// Poll the HOST document (not the webview) until the typed marker is gone — a deterministic signal
// that the LAST undo's edit-sync tick has reached WritebackController, instead of a fixed sleep.
// The save-immediately test triggers its save the INSTANT this resolves, so the gap between "the
// tick that armed the deferred timer landed" and "save fires" stays small and reliable regardless
// of how long the undo key-press loop itself took under CI/xvfb load.
async function waitForUndoToLand(
  evaluateInVSCode: EvalInVSCode,
  tmp: string,
): Promise<void> {
  const deadline = Date.now() + 15_000
  for (;;) {
    // Residue check, not `includes(MARKER)` — a leftover PREFIX ("…newlinex") is still an
    // un-undone edit, and the whole-string check used to call that "landed" (2026-08-12).
    if (!(await markerResidue(evaluateInVSCode, tmp))) return
    if (Date.now() > deadline) {
      throw new Error('undo never landed in the host document within 15s')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('the deferred idle timer alone restores the clean baseline within its own ~1200ms window (no save)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const before = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-noop-check-idle.md')
  writeFileSync(tmp, before)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  await typeAndUndo(workbox, frame, evaluateInVSCode, tmp)

  // NOTHING further happens — no save, no more typing. Poll for the document's content to settle
  // back to the exact original bytes WITHOUT us triggering a save — only the deferred idle timer
  // (armed by the last undo's edit-sync tick) can do this.
  await expect
    .poll(
      async () =>
        (await evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) =>
            vscode.workspace.textDocuments
              .find((d) => d.uri.fsPath === args[0])
              ?.getText() ?? '',
          [tmp] as [string],
        )) as string,
      // Comfortably above the 1200ms window (CI/xvfb scheduling slack) but well under
      // undo-dirty-probe's own 2000ms — if this needs to grow past ~2s to pass, the deferred timer
      // isn't what's catching it; something else (or nothing) is, and that's the real finding.
      { timeout: 3_000, intervals: [150, 250, 400] },
    )
    .toBe(before)

  rmSync(tmp, { force: true })
})

test('saving IMMEDIATELY after a revert-to-baseline (before the idle window elapses) still lands the exact baseline bytes on disk', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const before = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-noop-check-save.md')
  writeFileSync(tmp, before)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  await typeAndUndo(workbox, frame, evaluateInVSCode, tmp)
  // Deterministic: wait for the undo to actually REACH the host document, then save IMMEDIATELY —
  // not a fixed sleep racing the undo loop's own (variable, CI-load-sensitive) pacing. The gap
  // between "tick landed" and "save fires" is what has to stay under the 1200ms idle window for
  // this to actually exercise the willSave backstop rather than the deferred timer.
  await waitForUndoToLand(evaluateInVSCode, tmp)
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))

  const after = readFileSync(tmp, 'utf8')
  // eslint-disable-next-line no-console
  console.log(
    `[434] save-immediately-after-revert: beforeLen=${before.length} afterLen=${after.length} identical=${after === before}`,
  )
  rmSync(tmp, { force: true })

  expect(
    after,
    'the save must persist the EXACT clean baseline bytes, not an un-corrected reflow',
  ).toBe(before)

  const isDirty = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments.find((d) => d.uri.fsPath === args[0])
        ?.isDirty ?? true,
    [tmp] as [string],
  )
  expect(isDirty, 'an explicit save must clear the dirty flag').toBe(false)
})
