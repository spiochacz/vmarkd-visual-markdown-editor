import {
  type EvaluateInVSCode,
  docText,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Journey A4 (tasks/516-qa-journey-coverage-plan.md, Phase 1) — external change while the
// buffer is DIRTY, pinned from external-change-while-dirty-probe.spec.ts's measurement. That
// probe (kept as the documented evidence, incl. the exact toast text) found the journey SAFE:
//
//   - An external `fs.writeFileSync` to the same path while the webview holds an unsaved edit
//     does NOT silently reach the TextDocument or the webview — VS Code does not auto-reload a
//     DIRTY document. The user's edit is untouched.
//   - Attempting to SAVE afterwards does NOT silently overwrite the external content: VS Code's
//     own save-conflict detection (ETag/mtime) rejects the write, the document STAYS dirty, the
//     user's edit stays in the buffer, and disk keeps the external bytes. A real toast fires:
//     "Failed to save '<file>': The content of the file is newer. Please compare your version
//     with the file contents or overwrite the content of the file with your changes." — this is
//     entirely VS Code CORE behaviour (the save command operates on the real TextDocument through
//     VS Code's own file service, never through our WritebackController), so there is no product
//     mechanism of OURS to break for a red-green-red proof of the disk/dirty-flag half — see the
//     first test's own comment.
//   - `workbench.action.files.revert` on the dirty buffer discards the user's edit, adopts the
//     on-disk (external) content, clears the dirty flag, and the WEBVIEW follows — THIS half IS
//     ours (`editor-session.ts`'s onDidChangeTextDocument listener → `docSync.schedulePostUpdate`
//     → the webview's `update` handler), so the second test carries a real red-green-red proof.
const SRC = path.join(__dirname, 'fixtures', 'doc-sync.md')
const WEBVIEW_MARKER = 'WEBVIEWDIRTYXYZ'
const EXTERNAL_MARKER = 'rewritten from outside while dirty XYZ'

type Vs = typeof import('vscode')
// Reuses the shared type from webview-helpers.ts (see its comment) instead of a second
// hand-copied literal that pinned the arg as mandatory.
type EvalInVSCode = EvaluateInVSCode

async function openVmarkd(evaluateInVSCode: EvalInVSCode, tmp: string) {
  await evaluateInVSCode(
    async (vscode: Vs, args: [string]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
}

/** Type `marker` at the end of the CARET-ANCHOR paragraph — an UNSAVED webview edit. */
async function typeWebviewEdit(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  marker: string,
) {
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = Array.from(document.querySelectorAll('.vditor-ir p')).find(
        (x) => x.textContent?.includes('CARET-ANCHOR'),
      ) as HTMLElement | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('CARET-ANCHOR paragraph not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )
  await workbox.keyboard.type(marker, { delay: 40 })
}

/** Rewrite the EXTERNAL-TARGET line, straight to disk, bypassing every VS Code API. */
function externalWrite(tmp: string, original: string) {
  const rewritten = original.replace(
    /EXTERNAL-TARGET paragraph near the bottom that an out-of-webview edit will rewrite\./,
    `EXTERNAL-TARGET ${EXTERNAL_MARKER}`,
  )
  writeFileSync(tmp, rewritten)
  return rewritten
}

async function hostState(evaluateInVSCode: EvalInVSCode, tmp: string) {
  return evaluateInVSCode(
    async (vscode: Vs, args: [string]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return {
        isDirty: doc?.isDirty ?? null,
        text: doc?.getText() ?? null,
      }
    },
    [tmp] as [string],
  ) as Promise<{ isDirty: boolean | null; text: string | null }>
}

// UNPROVEN by design (task 516, same terms as A2's precedent): this test guards VS Code CORE
// save-conflict behaviour reached through our custom editor, not a mechanism of OURS — there is
// no product-source lever in this repo to break for a red-green-red proof, and none should be
// manufactured. See the header comment above for the full reasoning.
test('an external write while the buffer is dirty is not silently lost: save is rejected, both the external content and the unsaved edit survive', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-external-dirty-save-net.md')
  writeFileSync(tmp, original)

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    await typeWebviewEdit(workbox, frame, WEBVIEW_MARKER)
    await expect
      .poll(async () => (await hostState(evaluateInVSCode, tmp)).isDirty, {
        timeout: 15_000,
      })
      .toBe(true)

    const externalBytes = externalWrite(tmp, original)
    await settle(frame, 3000)

    await evaluateInVSCode(
      async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      },
      [] as unknown as [string],
    )
    await settle(frame, 2000)

    const after = await hostState(evaluateInVSCode, tmp)
    const diskAfter = readFileSync(tmp, 'utf8')
    const toastText = await workbox.evaluate(
      () =>
        document
          .querySelector('.notifications-toasts')
          ?.textContent?.trim()
          .slice(0, 300) ?? null,
    )
    console.log(
      `[external-dirty-save-net] toastText=${JSON.stringify(toastText)}`,
    )

    // Disk keeps the EXTERNAL bytes — our save must NOT silently overwrite someone else's write.
    expect(
      diskAfter,
      'disk keeps the external content, not the webview edit',
    ).toBe(externalBytes)
    // The document stays dirty — the save was REJECTED, not silently discarded.
    expect(after.isDirty, 'the buffer stays dirty after a rejected save').toBe(
      true,
    )
    // The user's edit is still in the (unsaved) buffer — not lost.
    expect(
      after.text?.includes(WEBVIEW_MARKER),
      'the unsaved edit survives in the TextDocument',
    ).toBe(true)
    // VS Code's own conflict machinery visibly engaged (not a silent no-op for an unrelated
    // reason) — the exact wording is VS Code's, checked loosely for "newer content" phrasing.
    expect(
      toastText?.toLowerCase().includes('newer'),
      'a conflict notification names the newer-on-disk content',
    ).toBe(true)
  } finally {
    rmSync(tmp, { force: true })
  }
})

test('reverting a dirty buffer that was externally overwritten discards the unsaved edit and the webview follows the on-disk content', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-external-dirty-revert-net.md')
  writeFileSync(tmp, original)

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    await typeWebviewEdit(workbox, frame, WEBVIEW_MARKER)
    await expect
      .poll(async () => (await hostState(evaluateInVSCode, tmp)).isDirty, {
        timeout: 15_000,
      })
      .toBe(true)

    const externalBytes = externalWrite(tmp, original)
    await settle(frame, 3000)

    await evaluateInVSCode(
      async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.revert')
      },
      [] as unknown as [string],
    )
    await settle(frame, 2000)

    const after = await hostState(evaluateInVSCode, tmp)
    expect(after.isDirty, 'revert clears the dirty flag').toBe(false)
    expect(
      after.text,
      'the TextDocument adopts the external (on-disk) content exactly',
    ).toBe(externalBytes)

    // The WEBVIEW must follow — this is OUR mechanism (doc-sync's push), not VS Code core.
    await expect
      .poll(
        () =>
          frame
            .locator('body')
            .evaluate(
              (_el, marker) =>
                document.body.innerText.includes(marker as string),
              EXTERNAL_MARKER,
            ),
        { timeout: 15_000, intervals: [300, 500, 800, 1200] },
      )
      .toBe(true)
    const webviewHasStaleEdit = await frame
      .locator('body')
      .evaluate(
        (_el, marker) => document.body.innerText.includes(marker as string),
        WEBVIEW_MARKER,
      )
    expect(
      webviewHasStaleEdit,
      'the webview must NOT still show the discarded unsaved edit',
    ).toBe(false)

    // docText() helper (used across this suite) agrees with the direct host read.
    expect(await docText(evaluateInVSCode, tmp)).toBe(externalBytes)
  } finally {
    rmSync(tmp, { force: true })
  }
})
