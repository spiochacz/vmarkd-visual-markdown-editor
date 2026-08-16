import { stickySelection, wf } from './webview-helpers'
// Task 428 gap #1 — Enter at the START of a non-empty list item.
//
// This is a NET, not a fix's proof. The task's probe matrix recorded this as a GAP ("inserts a
// blank line / breaks the list in two"), a capture-phase Enter handler was written for it, and then
// deleted: measured directly with the handler OFF, stock Vditor already produces the real-editor
// result (`- uapple` / `-` / `- ubanana`), ordered lists included. Something between that probe and
// now closed it. Shipping the handler anyway would have added a listener racing Vditor's own for no
// behaviour change, and a stopPropagation in capture can starve unrelated handlers.
//
// Kept because this fork patches Vditor's list handling heavily (tasks 428 Backspace, 441
// autoformat, 255/284 renumbering) and this is behaviour we depend on but do not own. Its honest
// limit: it cannot be proven red by reverting anything of ours, because there is nothing of ours to
// revert.
//
// Real VS Code rather than the harness: list editing here runs through the real key pipeline, and
// key capture is precisely what differs in the real webview (AGENTS.md).
//
// Three cases in ONE boot (task 450 — extra test() blocks are the expensive unit): unordered,
// ORDERED (which must renumber), and the empty-item case that exits the list.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'list-probe.md')

test('Enter at the start of a list item pushes the text down instead of breaking the list', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
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

  // Caret at offset 0 of the list item whose text starts with `needle`.
  const caretAtStartOf = (needle: string) =>
    stickySelection(
      frame,
      (_el, n) => {
        const li = [...document.querySelectorAll('.vditor-ir li')].find((x) =>
          x.textContent?.trim().startsWith(n as string),
        ) as HTMLElement | undefined
        if (!li) throw new Error(`item ${n} not found`)
        const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
        for (let t = w.nextNode(); t; t = w.nextNode()) {
          const i = (t.textContent ?? '').indexOf(n as string)
          if (i < 0) continue
          const r = document.createRange()
          r.setStart(t as Text, i)
          r.collapse(true)
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          li.focus()
          return
        }
        throw new Error(`text node for ${n} not found`)
      },
      needle,
    )

  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  // ── Unordered ────────────────────────────────────────────────────────────────────────────────
  await caretAtStartOf('ubanana')
  await workbox.keyboard.press('Enter')
  await expect
    .poll(async () => /- uapple\n-\s*\n- ubanana/.test(await value()), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)
  const afterU = await value()
  // The list must still be ONE list: no blank line splitting it, and ucherry still below.
  expect(afterU, 'the list was not broken in two').toMatch(
    /- uapple\n-\s*\n- ubanana\n- ucherry/,
  )

  // ── Ordered — the inserted item shifts every number below it ─────────────────────────────────
  await caretAtStartOf('otwo')
  await workbox.keyboard.press('Enter')
  await expect
    .poll(async () => /1\. oone\n\d+\.\s*\n\d+\. otwo/.test(await value()), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)
  const afterO = await value()
  // Renumbering must come out of Lute's re-serialisation, not a second hand-rolled numbering path
  // (tasks 255/284 own that engine) — so othree must have moved to 4.
  expect(afterO, 'the ordered list renumbered').toMatch(/4\. othree/)

  // ── Enter on an EMPTY item exits the list ───────────────────────────────────────────────────
  await caretAtStartOf('ebeta')
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.press('Enter')
  await expect
    .poll(
      async () => {
        const v = await value()
        // ebeta's list ends and a plain paragraph (or nothing) follows — no third empty bullet.
        return !/- ebeta\n-\s*\n-\s*/.test(v)
      },
      { timeout: 30_000, intervals: [300, 500, 1000] },
    )
    .toBe(true)
})
