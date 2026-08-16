import { stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 190 P1) — list editing round-trips to correct markdown (J4, previously uncovered
// end-to-end). Continuing a list with Enter is the common op; asserts the serialized getValue()
// (what actually saves). NOTE: a synthetic checkbox-input .click() collapses getValue() in this
// headless harness (the patchListToggle handler spins without the editor's caret context) — that
// is a test-harness artifact, not a verified product bug; the checkbox path is tracked as a §5
// probe to confirm against a REAL click, so it is intentionally not asserted here.
const SRC = path.join(__dirname, 'fixtures', 'list-ops.md')

test('continuing a bullet list with Enter serializes a new sibling item', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const tmp = path.join(tmpdir(), 'vmarkd-list-ops.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
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
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const getValue = () =>
    frame
      .locator('body')
      .evaluate(() =>
        (
          window as unknown as { vditor: { getValue(): string } }
        ).vditor.getValue(),
      ) as Promise<string>

  // Sanity: the list loaded and serializes on open.
  const initial = await getValue()
  expect(initial, 'task list present on open').toMatch(/- \[ \]\s+task one/)
  expect(initial, 'bullet list present on open').toContain('- bullet B')

  // Give the nested webview iframe PAGE-LEVEL keyboard focus before typing (click the editor's
  // top-left margin). The evaluate below only does a DOM-level li.focus(); keyboard events dispatch to
  // the top Electron window, so without this the Enter+keystrokes race the focus and drop
  // non-deterministically. Harness focus fix, not product behaviour.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  // Caret at the end of "bullet B", Enter to continue the list, type a new item.
  await stickySelection(
    frame,
    () => {
      const li = [...document.querySelectorAll('.vditor-ir li')].find((x) =>
        x.textContent?.includes('bullet B'),
      ) as HTMLElement | undefined
      if (!li) throw new Error('bullet B not found')
      const r = document.createRange()
      r.selectNodeContents(li)
      r.collapse(false)
      const s = getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      li.focus()
    },
    null,
  )
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('bullet NEW', { delay: 40 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const afterEnter = await getValue()
  // eslint-disable-next-line no-console
  console.log(
    `[list-ops] afterEnter tail=${JSON.stringify(afterEnter.slice(-90))}`,
  )
  rmSync(tmp, { force: true })
  // The new text is its own bullet item (a "- " line), and bullet B is preserved.
  expect(afterEnter, 'Enter created a new bullet item').toMatch(/- bullet NEW/)
  expect(afterEnter, 'original bullet B preserved').toContain('- bullet B')
  // The task list above was not disturbed by editing the bullet list below.
  expect(afterEnter, 'task list intact').toMatch(/- \[ \]\s+task one/)
})
