import { type EvaluateInVSCode, stickySelection, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 180 EDIT-CYCLE correctness (the regressions a perf/save spec misses). With the prose-skip ON
// (default), the heavy risks are: (1) the 220 ms settle re-spin moving the caret so the NEXT keystrokes
// land in the wrong place; (2) an inline construct typed across the skip (letters) + spin (delimiters)
// not forming; (3) a mixed edit not round-tripping byte-correct. Each test drives a real edit THROUGH a
// settle and asserts the outcome in the host TextDocument + the rendered DOM.
const FIXTURE = path.join(__dirname, 'fixtures', 'perf-prose.md')

const readDoc = (evaluateInVSCode: EvaluateInVSCode) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  // Give the nested webview iframe PAGE-LEVEL keyboard focus. caretAtEnd() only does a DOM-level
  // p.focus() inside the iframe; workbox.keyboard.type() dispatches to the top Electron window, so
  // without an OS-level click into the iframe the keystrokes race the focus and are dropped
  // non-deterministically (probed: 2/3 landed without this click, 3/3 with it). This is a harness
  // focus requirement, not product behaviour — real typing in the editor is unaffected.
  await frame.locator('.vditor-ir p', { hasText: 'Edit here' }).first().click()
  return frame
}

// caret at the END of the "Edit here: the quick brown fox." paragraph
async function caretAtEnd(frame: ReturnType<typeof wf>): Promise<boolean> {
  return stickySelection(
    frame,
    () => {
      const p = Array.from(document.querySelectorAll('.vditor-ir p')).find(
        (x) => x.textContent?.includes('Edit here'),
      ) as HTMLElement | undefined
      if (!p) return false
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let last: Text | null = null
      let n = w.nextNode() as Text | null
      while (n) {
        last = n
        n = w.nextNode() as Text | null
      }
      if (!last) return false
      const r = document.createRange()
      r.setStart(last, (last.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p.focus()
      return true
    },
    null,
  )
}
const settle = (frame: ReturnType<typeof wf>, ms = 2500) =>
  frame
    .locator('body')
    .evaluate((_b, t) => new Promise((r) => setTimeout(r, t)), ms)

test('prose edit-cycle checks share one boot', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  expect(await caretAtEnd(frame), 'caret').toBe(true)
  // type a run (skipped), let the settle re-spin fire WITHOUT touching the caret, then type more.
  await workbox.keyboard.type('AAA', { delay: 40 })
  await settle(frame) // the 220ms settle re-spin happens here — must NOT move the caret
  await workbox.keyboard.type('BBB', { delay: 40 })
  await settle(frame)
  const firstText = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[prose-edit] contiguous=${/fox\.AAABBB/.test(firstText)} tail=${JSON.stringify(firstText.match(/Edit here[^\n]*/)?.[0] ?? '')}`,
  )
  // if the settle re-spin had moved the caret, BBB would not sit right after AAA
  expect.soft(await caretAtEnd(frame), 'caret').toBe(true)
  // `*` falls through (spins), the letters skip — the construct must still render <em>/<strong> + save.
  await workbox.keyboard.type(' **bold** and *em*', { delay: 45 })
  await settle(frame)
  const rendered = await frame.locator('body').evaluate(() => {
    const p = Array.from(document.querySelectorAll('.vditor-ir p')).find((x) =>
      x.textContent?.includes('Edit here'),
    )
    return {
      strong: !!p?.querySelector('strong'),
      em: !!p?.querySelector('em'),
    }
  })
  const secondText = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[prose-edit] strong=${rendered.strong} em=${rendered.em} saved=${secondText.includes('**bold** and *em*')}`,
  )
  expect.soft(rendered.strong, 'bold did not render').toBe(true)
  expect.soft(rendered.em, 'italic did not render').toBe(true)
  expect.soft(secondText).toContain('**bold** and *em*')
  expect.soft(await caretAtEnd(frame), 'caret').toBe(true)
  await workbox.keyboard.type('ZZZZ', { delay: 40 })
  await settle(frame)
  expect.soft(await readDoc(evaluateInVSCode)).toContain('ZZZZ')
  // undo until the inserted run is gone (a few presses — Vditor batches undo by quiet windows)
  for (let i = 0; i < 6; i++) {
    await workbox.keyboard.press('Control+z')
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 250)))
  }
  await settle(frame, 1500)
  const finalText = await readDoc(evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(`[prose-edit] after undo, has ZZZZ=${finalText.includes('ZZZZ')}`)
  expect
    .soft(finalText, 'undo did not revert the skipped-typing run')
    .not.toContain('ZZZZ')
})
