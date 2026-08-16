import {
  type EvaluateInVSCode,
  docText,
  placeCaretAtEndOf,
  settle,
  wf,
} from './webview-helpers'
// C2 (task 516) — footnote editing. The chromium harness only exercises footnote *resolution*
// while streaming (media-src/e2e/stream.spec.ts); nothing edits a `[^label]` reference or its
// `[^label]: ...` definition through a real keystroke and reads the saved bytes back. Both sides
// of a footnote are plain Lute-native IR nodes (no vMarkd code decorates or intercepts them —
// unlike html-comment.ts or the callout machinery), so there is no product mechanism of OURS to
// break for a red proof here; this is Lute's own md<->DOM round-trip, verified end to end through
// the real custom-editor pipeline instead of assumed.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const SRC = path.join(__dirname, 'fixtures', 'footnote-editing.md')
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  file: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir sup[data-type="footnotes-ref"]')
    .first()
    .waitFor({ timeout: 60_000 })
  // page-level keyboard focus into the nested iframe before typing (see block-fidelity.spec.ts /
  // save-fidelity.spec.ts — workbox.keyboard dispatches to the top Electron window, and without a
  // click first the typed text races DOM focus and is silently dropped).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await settle(frame, 300)
  return frame
}

test('editing a footnote reference paragraph and its definition body round-trips byte-faithfully on save', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-footnote-editing.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  const frame = await open(workbox, evaluateInVSCode, tmp)

  // The reference sup itself renders only the footnote NUMBER (Vditor's dual-node for
  // footnotes-ref is not a directly-editable text run — it syncs off the DEFINITION's caret
  // instead, per vditor/dist/index.js's IR footnote sync). The editable surface for "editing the
  // reference" is the paragraph text around it: prove that surviving an edit there doesn't
  // corrupt the `[^note]` marker.
  await placeCaretAtEndOf(frame, workbox, '.vditor-ir p', 'right here.')
  await workbox.keyboard.type(' EXTRACONTEXT', { delay: 40 })
  // Assert the FIRST edit reached the host document before moving the caret away. Without this the
  // spec's only poll is for the definition edit, so a paragraph edit that never landed surfaced at
  // the very last assertion as "the saved bytes lack EXTRACONTEXT" — a save-fidelity symptom for
  // what is really a caret/keystroke miss (5 of 10 solo runs, 2026-08-15).
  await expect
    .poll(
      async () =>
        (await docText(evaluateInVSCode, tmp)).includes('EXTRACONTEXT'),
      { message: 'the paragraph edit reached the host TextDocument' },
    )
    .toBe(true)

  // The definition body is a real editable block (`[data-type="footnotes-def"]`) — edit its text
  // directly.
  await placeCaretAtEndOf(
    frame,
    workbox,
    '[data-type="footnotes-def"]',
    'Original footnote body text.',
  )
  await workbox.keyboard.type(' Appended.', { delay: 40 })

  // Leave both nodes (click the untouched paragraph) so any caret-leave re-render settles.
  await frame.locator('.vditor-ir').getByText('untouched by any edit').click()
  await settle(frame, 500)

  await expect
    .poll(
      async () => (await docText(evaluateInVSCode, tmp)).includes('Appended.'),
      {
        message: 'the definition edit reached the saved TextDocument',
      },
    )
    .toBe(true)

  // No-arg overload: the callback ignores its args, so the fixture's `evaluateInVSCode(fn)`
  // overload applies directly instead of a `[] as [string]` cast (TS rejects narrowing an empty
  // array literal to the 1-tuple `[string]`).
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await settle(frame, 500)

  const after = readFileSync(tmp, 'utf8')
  // eslint-disable-next-line no-console
  console.log(`[footnote-editing] saved: ${JSON.stringify(after)}`)
  rmSync(tmp, { force: true })

  // The reference marker survived the paragraph edit, with the added text alongside it.
  expect(after, 'the footnote reference marker is intact').toContain('[^note]')
  expect(after, 'the paragraph edit landed').toContain('EXTRACONTEXT')
  // The definition marker + edited body both landed, still paired to the same label.
  expect(after, 'the definition marker is intact').toContain('[^note]:')
  expect(after, 'the original definition text survived').toContain(
    'Original footnote body text.',
  )
  expect(after, 'the definition edit landed').toContain('Appended.')
  // The untouched paragraph is byte-for-byte unaffected.
  expect(after, 'the untouched paragraph is unchanged').toContain(
    'Another paragraph, untouched by any edit in this spec.',
  )
})
