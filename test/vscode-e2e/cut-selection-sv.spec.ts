import { docText, ev, settle, stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 387's sv regression pin, in its own file. Measured during investigation: sv's cut was
// NEVER broken (unlike IR/WYSIWYG) — proven correct against both a minimal fixture and the full
// torture.md fixture. Kept in its own file because the identical selection+cut sequence
// mysteriously no-ops when it runs as a later test inside a multi-test file (a harness isolation
// quirk under investigation elsewhere, not the sv behaviour itself, which is what this pins).
const SRC = path.join(__dirname, 'fixtures', 'torture.md')

test('sv: cutting a selected multi-line paragraph was never broken (regression pin)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), `${process.pid}-387sv.md`)
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    tmp,
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="sv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-sv').first().waitFor({ timeout: 30_000 })
  await settle(frame, 2000)

  await frame
    .locator('.vditor-sv')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page selection-range construction across the SV source-pane node/offset combinations; pre-existing (task 469 baseline)
    () => {
      const root = document.querySelector('.vditor-sv') as HTMLElement
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let startNode: Text | null = null
      let startOffset = 0
      let endNode: Text | null = null
      let endOffset = 0
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        if (!startNode) {
          const i = text.indexOf('A paragraph with')
          if (i >= 0) {
            startNode = n as Text
            startOffset = i
          }
        }
        const j = text.indexOf('second sentence.')
        if (j >= 0) {
          endNode = n as Text
          endOffset = j + 'second sentence.'.length
        }
      }
      if (!startNode || !endNode) throw new Error('span not found')
      const r = document.createRange()
      r.setStart(startNode, startOffset)
      r.setEnd(endNode, endOffset)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
    },
    null,
  )
  await workbox.keyboard.press('Control+x')
  await settle(frame, 2500)

  const after = await docText(evaluateInVSCode, tmp)
  expect(after, 'the whole paragraph is gone').not.toContain('A paragraph with')
  expect(after, 'the rest of the document survives').toContain(
    'Anchor line ZULU',
  )

  rmSync(tmp, { force: true })
})
