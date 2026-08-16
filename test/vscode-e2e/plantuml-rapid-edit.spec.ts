import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 349 — rapid-edit backlog regression (real VS Code, headless). Editing a slow PlantUML diagram
// (C4, ~2.2 s render) used to queue ONE full render per typing pause; because each pause's Lute re-spin
// detaches the previous render target, the queued renders targeted dead nodes, each waited the 5 s
// fallback, and the serialised queue clogged — so the diagram fell tens of seconds behind. The fix
// (plantuml-render.ts) skips a render whose target is detached (at dequeue AND mid-render). This grows a
// visible label with EDITS spaced keystrokes and asserts the diagram CONVERGES to the final label in
// bounded time; under the old backlog the correct final render arrived far too late for this window.
const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-rapid-edit.md')
// 7 spaced edits: with the fix the stale renders are skipped so convergence is ~one C4 render (~3-5 s);
// without it each of the ~7 stale renders holds the queue for its 5 s fallback (~30 s), blowing the bound.
const EDITS = 7
const CONVERGE_MS = 12_000
const FINAL_LABEL = `EDITME${'x'.repeat(EDITS)}`

// Place the caret in the LAST plantuml source, right after the first occurrence of `label`.
async function caretAfterLabel(frame: ReturnType<typeof wf>, label: string) {
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  return frame.locator('body').evaluate((_b, lbl) => {
    const src = Array.from(
      document.querySelectorAll(
        '.vditor-ir__marker--pre code.language-plantuml',
      ),
    ).pop() as HTMLElement | undefined
    if (!src) return false
    const walker = document.createTreeWalker(src, NodeFilter.SHOW_TEXT)
    let node: Node | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard TreeWalker loop
    while ((node = walker.nextNode())) {
      const i = (node.textContent ?? '').indexOf(lbl)
      if (i >= 0) {
        src.focus()
        const sel = window.getSelection()
        const range = document.createRange()
        range.setStart(node, i + lbl.length)
        range.collapse(true)
        sel?.removeAllRanges()
        sel?.addRange(range)
        return true
      }
    }
    return false
  }, label)
}

function svgText(frame: ReturnType<typeof wf>) {
  return frame
    .locator('.vditor-ir__preview .language-plantuml')
    .last()
    .evaluate((el) => {
      const svg = el.querySelector('svg')
      return svg
        ? Array.from(svg.querySelectorAll('text'))
            .map((t) => t.textContent ?? '')
            .join(' ')
        : ''
    })
}

test('rapid edits to a slow C4 diagram converge to the final label in bounded time (task 349)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file((args as [string])[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Wait for the initial C4 render (the editable label present).
  await expect
    .poll(() => svgText(frame).catch(() => ''), { timeout: 90_000 })
    .toContain('EDITME')

  // Grow the label with EDITS spaced keystrokes (each gap > the 220 ms settle → its own render).
  for (let i = 0; i < EDITS; i++) {
    const placed = await caretAfterLabel(frame, 'EDITME')
    expect(placed, `caret placed before keystroke ${i}`).toBe(true)
    await workbox.keyboard.type('x')
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 300)))
  }

  // The diagram must converge to the FINAL label within a bound the pre-fix backlog (≈ EDITS × up-to-5 s
  // stale renders) blows through.
  await expect
    .poll(() => svgText(frame).catch(() => ''), { timeout: CONVERGE_MS })
    .toContain(FINAL_LABEL)

  const finalText = await svgText(frame)
  expect(finalText).toContain(FINAL_LABEL)
  expect(finalText).not.toMatch(
    /Assumed diagram type|Syntax Error|Fatal parsing/i,
  )
})
