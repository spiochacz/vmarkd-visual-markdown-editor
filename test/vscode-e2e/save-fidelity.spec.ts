import { stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 190 P0) — the save pipeline on the REAL wire: a prose edit followed by a save
// must land the typed text on disk WITHOUT reflowing or corrupting any other block. This
// exercises the whole chain the unit tests only cover in pieces (edit-sync serialize →
// host writeback-controller minimal-diff → WorkspaceEdit → save → disk). undo-dirty-probe
// proves undo-to-disk; this proves edit-to-disk fidelity. Belongs in the PR smoke battery.
//
// Works on a COPY in the OS temp dir (never the committed fixture), so a failing run can't
// dirty the working tree.
const SRC = path.join(__dirname, 'fixtures', 'save-fidelity.md')
const TMP = path.join(tmpdir(), 'vmarkd-save-fidelity.md')
const INSERT = 'INSERTEDXYZ'
// Blocks the user never touched — must survive the save byte-for-byte.
const UNTOUCHED = [
  'Intro paragraph that stays byte-for-byte unchanged.',
  '## Section B',
  '- Second item',
  '| Alpha | 1 |',
  'const answer = 42',
  'Closing paragraph unchanged.',
]

test('typing prose then saving preserves every other block on disk', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const before = readFileSync(SRC, 'utf8')
  writeFileSync(TMP, before)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [TMP] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // PAGE-LEVEL keyboard focus into the nested webview iframe first — `p.focus()` below is DOM-level
  // INSIDE the iframe, while `workbox.keyboard` dispatches to the top Electron window; without this
  // click the typed marker races that focus and never reaches the document (the poll then times out).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  // Caret at the end of the "Edit here…" paragraph, then type the marker.
  await stickySelection(
    frame,
    () => {
      const p = Array.from(
        document.querySelectorAll('.vditor-ir p, .vditor-ir li, .vditor-ir h1'),
      ).find((x) => x.textContent?.includes('Edit here')) as
        | HTMLElement
        | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('edit target not found')
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
  await workbox.keyboard.type(INSERT, { delay: 40 })
  // Poll until the debounced edit (250 ms) + host writeback have landed in the TextDocument —
  // deterministic, no fixed sleep, so the smoke-gate spec can't flake under load.
  await expect
    .poll(
      async () =>
        (await evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) =>
            vscode.workspace.textDocuments
              .find((d) => d.uri.fsPath === args[0])
              ?.getText()
              .includes(args[1]) ?? false,
          [TMP, INSERT] as [string, string],
        )) as boolean,
      { timeout: 10_000, intervals: [200, 300, 500, 800] },
    )
    .toBe(true)

  // Save through the real command, then read the bytes back off disk.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    },
    [] as [],
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  const after = readFileSync(TMP, 'utf8')
  // eslint-disable-next-line no-console
  console.log(
    `[save-fidelity] beforeLen=${before.length} afterLen=${after.length} ` +
      `delta=${after.length - before.length} hasInsert=${after.includes(INSERT)}`,
  )
  rmSync(TMP, { force: true })

  // The typed text reached disk…
  expect(after, 'the edit must land on disk').not.toBe(before)
  expect(after.includes(INSERT), 'typed text must be saved').toBe(true)
  // …and every untouched block is preserved verbatim (no reflow / corruption).
  for (const anchor of UNTOUCHED) {
    expect(after.includes(anchor), `untouched block preserved: ${anchor}`).toBe(
      true,
    )
  }
  // A pure insertion: the file grew only by the marker (±2 for a possible trailing-newline
  // normalization) — not reflowed or duplicated.
  expect(
    Math.abs(after.length - before.length - INSERT.length),
    'save must be a minimal insertion, not a reflow',
  ).toBeLessThanOrEqual(2)
})
