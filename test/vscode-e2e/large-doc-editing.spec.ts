import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, stickySelection, wf } from './webview-helpers'

// Journey D9 (tasks/516-qa-journey-coverage-plan.md, Phase 4) — `stream-large-file.spec.ts` proves
// a >700k-char document STREAMS in and comes back editable; it never types into one. This proves
// the other half: type, undo, save on a large streamed document still works correctly once the
// editor is live. Reuses stream-large-file.spec.ts's fixture-building approach and threshold.

const SECTIONS = 1200
// ~620 chars per section × 1200 ≈ 744k chars — safely over the 700k streaming threshold (same
// budget as stream-large-file.spec.ts).
function buildLargeMarkdown(): string {
  const parts: string[] = ['# Large-doc editing fixture\n\n']
  parts.push(
    'CARET-ANCHOR paragraph the test edits after the doc streams in.\n\n',
  )
  for (let i = 0; i < SECTIONS; i++) {
    // No trailing space before the paragraph's closing newline — Lute's markdown serializer
    // (getValue() round-trips through it) trims trailing whitespace on re-serialize, which made a
    // byte-for-byte equality check against a `.repeat(50)` fixture with a trailing space fail on
    // ALL 1200 sections even before any edit — a fixture artifact, not a real undo/save bug.
    parts.push(
      `## Section ${i}\n\n${Array(50).fill('lorem ipsum').join(' ')}\n\n`,
    )
  }
  // Single trailing newline at EOF — Lute's serializer (getValue()) normalizes a trailing BLANK
  // line away on every round-trip (not undo/save-specific), so a fixture ending in `\n\n` fails a
  // byte-equality check against the re-serialized doc even with no edit involved.
  return `${parts.join('').trimEnd()}\n`
}

const MARKER = 'LARGEDOCEDITMARKER'

test('type, undo, and save on a >700k-char streamed document', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // VS Code boot + a 1200-block streamed render both take a while — well over the 90s default.
  test.setTimeout(300_000)
  const original = buildLargeMarkdown()
  const file = path.join(os.tmpdir(), `vmarkd-large-doc-edit-${process.pid}.md`)
  fs.writeFileSync(file, original, 'utf8')

  try {
    await evaluateInVSCode(
      async (vscode, [uri]) => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vmarkd.editor',
        )
      },
      [file] as [string],
    )

    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })

    // Wait for the FULL stream, exactly as stream-large-file.spec.ts does — every section heading
    // must land AND the editor must release its read-only streaming lock before we type into it.
    await expect
      .poll(() => frame.locator('.vditor-ir h2').count(), {
        timeout: 150_000,
        intervals: [2_000],
      })
      .toBe(SECTIONS)
    await expect
      .poll(
        () =>
          frame
            .locator('.vditor-ir .vditor-reset')
            .first()
            .getAttribute('contenteditable'),
        { timeout: 30_000, intervals: [1_000] },
      )
      .toBe('true')
    expect(await frame.locator('#vmarkd-stream-spinner').count()).toBe(0)
    await settle(frame, 1000)

    // Type a marker into the CARET-ANCHOR paragraph, near the top of a 744k-char document.
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
    await workbox.keyboard.type(MARKER, { delay: 30 })

    const docText = () =>
      evaluateInVSCode(
        async (vscode: typeof import('vscode'), args: string[]) =>
          vscode.workspace.textDocuments
            .find((d) => d.uri.fsPath === args[0])
            ?.getText() ?? '',
        [file] as [string],
      ) as Promise<string>

    await expect
      .poll(async () => (await docText()).includes(MARKER), {
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .toBe(true)

    // Undo must remove exactly the typed marker and nothing else in a 744k-char buffer.
    await workbox.keyboard.press('Control+z')
    await expect
      .poll(async () => (await docText()).includes(MARKER), {
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .toBe(false)
    const afterUndo = await docText()
    expect(
      afterUndo,
      'undo on a large doc must restore the ORIGINAL content exactly, not just remove the marker text',
    ).toBe(original)

    // Redo, then save — the final on-disk bytes must match the edited document exactly.
    await workbox.keyboard.press('Control+y')
    await expect
      .poll(async () => (await docText()).includes(MARKER), {
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .toBe(true)
    const editedText = await docText()

    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await expect
      .poll(
        async () =>
          evaluateInVSCode(
            async (vscode: typeof import('vscode'), args: string[]) =>
              vscode.workspace.textDocuments.find(
                (d) => d.uri.fsPath === args[0],
              )?.isDirty ?? null,
            [file] as [string],
          ),
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toBe(false)

    const onDisk = fs.readFileSync(file, 'utf8')
    expect(
      onDisk,
      'saved bytes must match the edited (undo-then-redo) document',
    ).toBe(editedText)
    expect(onDisk).toContain(MARKER)
  } finally {
    fs.rmSync(file, { force: true })
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })
  }
})
