import { stickySelection, wf } from './webview-helpers'
// Task 242 in the REAL editor: pasted terminal/log text must not leak raw ANSI escape bytes into
// the saved markdown.
//
// This has to be an L3 test with the real clipboard and a real keystroke. A synthetic ClipboardEvent
// changes getValue without driving Vditor's paste pipeline at all (task 191's L2-vs-L3 lesson), and
// the fix lives INSIDE that pipeline — an esbuild patch rewriting `textPlain` at the one point
// vditor reads it. The pre-fix probe measured 4 escape bytes reaching the document this way.
//
// Asserted on the DOCUMENT, not the editor DOM: the whole complaint is about bytes that reach disk.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'paste-behaviour.md')
const ESC = '\x1b'

test('a pasted log line loses its ANSI escapes but keeps its text', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

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
    [
      `${ESC}[32mINFO${ESC}[0m started and ${ESC}[1;31mERROR${ESC}[0m failed`,
      FIXTURE,
    ] as [string, string],
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  // Caret at the end of the CARET paragraph, then a real Ctrl+V.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-ir p')].find((x) =>
        x.textContent?.includes('CARET'),
      ) as HTMLElement | undefined
      if (!p) throw new Error('anchor paragraph not found')
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf('CARET')
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i + 'CARET'.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        p.focus()
        return
      }
      throw new Error('anchor text node not found')
    },
    null,
  )
  await workbox.keyboard.press('Control+v')

  const value = () =>
    frame
      .locator('body')
      .evaluate(
        () =>
          (
            window as unknown as { vditor?: { getValue(): string } }
          ).vditor?.getValue() ?? '',
      )

  // Poll for the paste to land — the text arriving is the precondition for the escape assertion,
  // and asserting "no escapes" before the paste has landed would pass vacuously.
  await expect
    .poll(async () => (await value()).includes('INFO started'), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)

  const v = await value()
  expect(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: counting escape bytes in the document IS the assertion
    (v.match(/\x1b/g) ?? []).length,
    'no escape bytes survived into the document',
  ).toBe(0)
  // The repair must be surgical: only the control bytes go, the words stay and stay in order.
  expect(v).toContain('CARETINFO started and ERROR failed')
})
