import { stickySelection, wf } from './webview-helpers'
// Task 218 in the REAL editor: pasting a block of spreadsheet cells builds a markdown table.
//
// Both halves in ONE boot, and the second half is the one that matters most: a paste INSIDE a code
// fence must stay literal (the task-191 P0-9 contract). The conversion rides the same pre-Vditor
// hook as task 242's ANSI strip, which runs BEFORE vditor's own code-element branch exists — so the
// code context is computed at the hook site, and if that wiring is wrong this spec is the only
// thing that catches it. A unit test cannot: it has no vditor and no real caret.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'paste-table.md')
const TSV = 'name\tqty\napple\t3\npear\t5'

test('a pasted TSV block becomes a table in prose and stays literal in a fence', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.env.clipboard.writeText(args[0])
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[1]),
        'vmarkd.editor',
      )
    },
    [TSV, FIXTURE] as [string, string],
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  const value = () =>
    frame
      .locator('body')
      .evaluate(
        () =>
          (
            window as unknown as { vditor?: { getValue(): string } }
          ).vditor?.getValue() ?? '',
      )

  // Caret immediately after `needle`, wherever it lives (prose paragraph or code line).
  const place = (needle: string) =>
    stickySelection(
      frame,
      (_el, n) => {
        const root = document.querySelector('.vditor-ir')
        if (!root) throw new Error('no editor')
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const i = (t.textContent ?? '').indexOf(n as string)
          if (i < 0) continue
          const r = document.createRange()
          r.setStart(t as Text, i + (n as string).length)
          r.collapse(true)
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          ;(t.parentElement as HTMLElement)?.focus()
          return
        }
        throw new Error(`anchor ${n} not found`)
      },
      needle,
    )

  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await place('CARET')
  await workbox.keyboard.press('Control+v')

  // Lute re-serialises the table with the columns padded to a common width (`| name  | qty |`), so
  // assert on the collapsed form — pinning exact spacing would be pinning Lute's formatter, not the
  // behaviour under test.
  const flat = async () => (await value()).replace(/[ \t]+/g, ' ')
  await expect
    .poll(async () => (await flat()).includes('| name | qty |'), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)
  const afterProse = await flat()
  expect(afterProse, 'a header separator row was emitted').toMatch(
    /\|\s*-+\s*\|\s*-+\s*\|/,
  )
  expect(afterProse, 'every data row landed').toContain('| pear | 5 |')
  expect(
    await value(),
    'the raw tabs are gone from the prose paste',
  ).not.toMatch(/CARET[^\n]*\tqty/)

  // Now the fence. The literal tab text must survive; no table may appear inside it.
  await place('FENCE')
  await workbox.keyboard.press('Control+v')
  await expect
    .poll(async () => (await value()).includes('FENCEname\tqty'), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)
  const afterFence = await value()
  // Exactly the one table from the prose paste — the fence paste added none.
  expect(
    (afterFence.match(/\|\s*-+\s*\|\s*-+\s*\|/g) ?? []).length,
    'the fence paste did not build a second table',
  ).toBe(1)
})
