import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// SPIKE (diagnostic) — isolated mermaid.render() is ~55ms, but edit→appears is ~450-500ms.
// Where does the rest go? Break the editor pipeline into phases after the last keystroke:
//   t0=keystroke → tOldGone (old svg removed by the settle re-spin; ≈ QUIET_MS + spin start)
//                → tNew    (new svg present; the render+insert)
// Tells us whether the lever is the QUIET window, the spin re-dispatch, or the reveal — NOT the
// mermaid render itself (already proven cheap).
const FIXTURE = path.join(__dirname, 'fixtures', 'render-cost-spike.md')

test('SPIKE: mermaid edit→appear pipeline breakdown', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // mark the current mermaid svg + place caret at end of its source
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  await frame.locator('body').evaluate(() => {
    document
      .querySelector('.language-mermaid svg')
      ?.setAttribute('data-bd-mark', '1')
    const node = Array.from(
      document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
    ).find((n) => n.querySelector('code.language-mermaid')) as
      | HTMLElement
      | undefined
    const code = node?.querySelector('.vditor-ir__marker--pre code') as
      | HTMLElement
      | undefined
    if (!code) return
    const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = w.nextNode() as Text | null
    while (n) {
      last = n
      n = w.nextNode() as Text | null
    }
    const tn: Node = last ?? code
    const r = document.createRange()
    r.setStart(tn, tn.nodeType === 3 ? (tn.textContent ?? '').length : 0)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    node?.focus()
  })

  // start the fine-grained timeline poll, THEN type (poll runs concurrently)
  const poll = frame.locator('body').evaluate(async () => {
    const start = performance.now()
    let tOldGone = -1
    let tNew = -1
    let waited = 0
    while (waited < 6000) {
      await new Promise((r) => setTimeout(r, 10))
      waited += 10
      if (tOldGone < 0 && !document.querySelector('svg[data-bd-mark="1"]')) {
        tOldGone = Math.round(performance.now() - start)
      }
      const fresh = Array.from(
        document.querySelectorAll('.language-mermaid svg'),
      ).find(
        (s) =>
          !s.closest('.vmarkd-stale-overlay') &&
          !s.hasAttribute('data-bd-mark'),
      )
      if (tOldGone >= 0 && fresh) {
        tNew = Math.round(performance.now() - start)
        break
      }
    }
    return { tOldGone, tNew }
  })
  await new Promise((r) => setTimeout(r, 30))
  await workbox.keyboard.type('Z', { delay: 0 })
  const r = (await poll) as { tOldGone: number; tNew: number }

  // eslint-disable-next-line no-console
  console.log(
    `[mermaid-pipeline-breakdown] keystroke→oldSvgGone≈${r.tOldGone}ms (quiet+spin start) ` +
      `→newSvg≈${r.tNew}ms | render-phase(oldGone→new)≈${r.tNew - r.tOldGone}ms ` +
      `| isolated mermaid.render≈55ms`,
  )
  expect(r.tNew).toBeGreaterThan(0)
})
