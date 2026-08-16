import { docText, stickySelection, wf } from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 191 P0-6, incl. the P0-16 undo leg) — paste on the REAL wire: markdown placed on
// the VS Code clipboard, pasted with a real Ctrl+V, must land in the live TextDocument, save
// verbatim to disk, and a SINGLE Ctrl+Z must roll back the WHOLE paste (not one block at a
// time). This is the leg the L2 paste spec could not prove — a synthetic ClipboardEvent
// neither reads the clipboard nor populates Vditor's undo stack; a real Ctrl+V does both.

const DIR = path.join(tmpdir(), 'vmarkd-p06-paste')
const DOC = path.join(DIR, 'note.md')
const PASTED = '# Pasted Head\n\npasted body para\n\n- pasted item'

test('a real Ctrl+V paste reaches the document + disk, and one Ctrl+Z rolls back the whole paste', async ({
  workbox,
  evaluateInVSCode,
}) => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(DOC, '# Doc\n\nAnchor line stays.\n')

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      // Put the markdown on the VS Code clipboard for the webview Ctrl+V to read.
      await vscode.env.clipboard.writeText(args[1])
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [DOC, PASTED] as [string, string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))

  // Caret at the end of the document, then a REAL paste.
  await stickySelection(
    frame,
    () => {
      const inst = (window as any).vditor
      const el = inst.vditor[inst.getCurrentMode()].element as HTMLElement
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
    },
    null,
  )
  // Verify the caret really is in the editable BEFORE sending Ctrl+V. Without this, a setup that
  // silently failed shows up much later as "undo did not roll back the paste" — a product-shaped
  // symptom for what is really "the keys went nowhere". This spec failed exactly that way in a full
  // run (task 516 round 8) and the message named the undo, not the focus.
  await expect
    .poll(
      () =>
        frame.locator('body').evaluate(() => {
          // querySelectorAll, not querySelector with a list: Vditor keeps ALL mode elements in the
          // DOM and only shows one, so the first match is often the hidden `.vditor-ir` while the
          // caret sits in the visible `.vditor-wysiwyg` — the check would then always read false.
          const panes = Array.from(
            document.querySelectorAll(
              '.vditor-ir, .vditor-wysiwyg, .vditor-sv',
            ),
          )
          const sel = window.getSelection()
          if (!sel?.rangeCount) return false
          const node = sel.getRangeAt(0).startContainer as Node
          return panes.some((pane) => pane.contains(node))
        }),
      { message: 'the caret is inside the editable before the paste' },
    )
    .toBe(true)
  await workbox.keyboard.press('Control+v')

  // The paste lands in the live TextDocument (all three blocks)…
  await expect
    .poll(() => docText(evaluateInVSCode, DOC), {
      timeout: 12_000,
      intervals: [200, 400, 800],
    })
    .toContain('Pasted Head')
  const afterPaste = await docText(evaluateInVSCode, DOC)
  expect(afterPaste).toContain('pasted body para')
  expect(afterPaste).toContain('pasted item')
  expect(afterPaste).toContain('Anchor line stays.')

  // …saves verbatim to disk…
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    },
    [] as [],
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))
  expect(readFileSync(DOC, 'utf8')).toContain('Pasted Head')

  // …and a SINGLE Ctrl+Z rolls the whole paste back to the pre-paste document.
  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    ;(inst.vditor[inst.getCurrentMode()].element as HTMLElement).focus()
  })
  await workbox.keyboard.press('Control+z')
  await expect
    .poll(() => docText(evaluateInVSCode, DOC), {
      timeout: 10_000,
      intervals: [200, 400, 800],
    })
    .not.toContain('Pasted Head')
  const afterUndo = await docText(evaluateInVSCode, DOC)
  rmSync(DIR, { recursive: true, force: true })
  expect(afterUndo).not.toContain('pasted body para')
  expect(afterUndo).not.toContain('pasted item')
  expect(afterUndo).toContain('Anchor line stays.')
})
