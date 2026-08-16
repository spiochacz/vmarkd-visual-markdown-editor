import { stickySelection, wf } from './webview-helpers'
// Task 287 in the REAL editor: Ctrl+Shift+V pastes WITHOUT the rich-HTML conversion.
//
// This can only be proven here. The chord's whole risk is that something else claims it — a probe
// measured it doing NOTHING before this change — and "does the keybinding reach our command with a
// custom editor focused" is a question about VS Code's keybinding resolution, which no harness
// models. The clipboard read is host-side for the same reason the chord is: a webview cannot read
// the system clipboard synchronously from a keydown.
//
// Both chords in ONE boot, because the assertion is a CONTRAST: the same clipboard text must come
// out differently under Ctrl+V and Ctrl+Shift+V, or the new chord is doing nothing distinguishable.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'paste-behaviour.md')
// A URL is the cleanest contrast available: Ctrl+V turns it into a markdown link (task 392), so
// plain paste is visible as the ABSENCE of that transformation, with the text still landing.
const URL = 'https://example.com'

test('Ctrl+Shift+V pastes plain where Ctrl+V would convert', async ({
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
    [URL, FIXTURE] as [string, string],
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

  const caretAfter = (needle: string) =>
    stickySelection(
      frame,
      (_el, n) => {
        const root = document.querySelector('.vditor-ir')
        if (!root) throw new Error('no editor')
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let t = w.nextNode(); t; t = w.nextNode()) {
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

  // Baseline: the ordinary chord converts.
  await caretAfter('TARGET')
  await workbox.keyboard.press('Control+v')
  await expect
    .poll(async () => /\[https:\/\/example\.com\]\(/.test(await value()), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)

  // The plain chord: the text lands, but NOT as a link.
  await caretAfter('CARET')
  await workbox.keyboard.press('Control+Shift+v')
  await expect
    .poll(async () => (await value()).includes(`CARET${URL}`), {
      timeout: 30_000,
      intervals: [300, 500, 1000],
    })
    .toBe(true)

  const v = await value()
  const caretLine = v.split('\n').find((l) => l.includes('CARET')) ?? ''
  expect(caretLine, 'the plain paste inserted the literal text').toContain(
    `CARET${URL}`,
  )
  expect(
    caretLine,
    'and did NOT wrap it as a link the way Ctrl+V does',
  ).not.toMatch(/\[https:\/\/example\.com\]\(/)
})
