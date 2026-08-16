import { type EvaluateInVSCode, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 175 SAFETY — the fence-spin defer (default ON) must never corrupt the document. Its core safety
// property: the typed char lands in the live source text node (native contenteditable) and getMarkdown
// serialises from that node, so the SAVE stays byte-correct even with the spin skipped; structural
// keystrokes (Enter, backtick) fall through to the real spin. This drives a real mermaid edit and asserts
// the host TextDocument round-trips correctly through both the skip path and an escape-hatch (Enter).
const FIXTURE = path.join(__dirname, 'fixtures', 'mermaid-label-edit.md')

const readDoc = (evaluateInVSCode: EvaluateInVSCode) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === uri,
      )
      return doc ? doc.getText() : ''
    },
    [FIXTURE] as [string],
  ) as Promise<string>

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  // Give the nested webview iframe PAGE-LEVEL keyboard focus before typing (click the editor's
  // top-left margin, clear of the diagram). caretAfterDoIt() only does a DOM-level source.focus();
  // keyboard.type() dispatches to the top Electron window, so without this the keystrokes race the
  // focus and drop non-deterministically. Harness focus fix, not product behaviour.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  return frame
}

// caret right after "Do it" in the mermaid source
async function caretAfterDoIt(frame: ReturnType<typeof wf>): Promise<boolean> {
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  return frame.locator('body').evaluate(() => {
    const node = document
      .querySelector('.language-mermaid')
      ?.closest('.vditor-ir__node') as HTMLElement | null
    if (!node) return false
    node.classList.add('vditor-ir__node--expand')
    const source = node.querySelector('.vditor-ir__marker--pre') as HTMLElement
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
    let target: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      if (n.textContent?.includes('Do it')) {
        target = n
        break
      }
      n = walker.nextNode() as Text | null
    }
    if (!target) return false
    const idx = (target.textContent ?? '').indexOf('Do it') + 'Do it'.length
    const r = document.createRange()
    r.setStart(target, idx)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    source.focus()
    return true
  })
}

test('skip path: typing plain chars round-trips byte-correct to the host doc', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  expect(await caretAfterDoIt(frame), 'caret').toBe(true)
  await workbox.keyboard.type('ssssss', { delay: 50 })
  // let the settle re-spin + serialize land
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[175-safety] after plain typing: ${text.includes('Do itssssss')}`,
  )
  expect(text).toContain('C[Do itssssss]') // the skipped keystrokes saved correctly
  expect(text).toContain('B{Decision}') // rest of the diagram intact
})

test('escape hatch: Enter inside the source falls through and saves a real newline', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  expect(await caretAfterDoIt(frame), 'caret').toBe(true)
  // type a node id, then Enter (escape hatch → real spin), then another mermaid line
  await workbox.keyboard.type('x', { delay: 50 })
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('  F[Extra]', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const text = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[175-safety] escape-hatch tail: ${JSON.stringify(text.slice(-80))}`,
  )
  // the Enter produced a real new source line (structural keystroke went through the normal spin)
  expect(text).toContain('F[Extra]')
  expect(text).toContain('```mermaid') // the fence is intact (not broken by the edits)
})
