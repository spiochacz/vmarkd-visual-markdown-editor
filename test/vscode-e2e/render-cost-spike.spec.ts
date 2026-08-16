import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// SPIKE (diagnostic) — measure the PER-ENGINE render cost that bounds how responsive a
// live diagram update can be. The perceived "edit → new diagram" latency is
// `QUIET_MS (~220ms) + engine render`. This isolates the engine-render part by editing a
// diagram and timing keystroke → fresh svg, for a heavier mermaid and a d2 (WASM+ELK).
// Floor = render cost ≈ measured − ~220ms. Tells us whether debounce tuning is enough or a
// specific engine (likely d2 WASM) needs its own speedup.
const FIXTURE = path.join(__dirname, 'fixtures', 'render-cost-spike.md')

const QUIET_MS = 220 // the edit-activity quiet window, subtracted to estimate pure render

test('SPIKE: per-engine render cost (mermaid heavy + d2)', async ({
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
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 5000)))

  // Edit one diagram of the given language and time keystroke → fresh (re-rendered) svg.
  const measure = async (lang: string): Promise<number> => {
    // mark the current svg of this lang so we can detect its replacement
    // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
    // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
    // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
    await frame.locator('body').evaluate((_b, l) => {
      const svg = document.querySelector(`.language-${l} svg`)
      svg?.setAttribute('data-cost-mark', '1')
      // place caret at end of this lang's source
      const node = Array.from(
        document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
      ).find((n) => n.querySelector(`code.language-${l}`)) as
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
    }, lang)
    await workbox.keyboard.type(' ', { delay: 0 })
    return (await frame.locator('body').evaluate(async (_b, l) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const start = performance.now()
      let waited = 0
      // re-rendered when the marked svg is gone AND a fresh (non-overlay) svg is present
      while (waited < 12_000) {
        await sleep(25)
        waited += 25
        const marked = document.querySelector(
          `.language-${l} svg[data-cost-mark="1"]`,
        )
        const fresh = Array.from(
          document.querySelectorAll(`.language-${l} svg`),
        ).find((s) => !s.closest('.vmarkd-stale-overlay') && !marked)
        if (!marked && fresh) break
      }
      return Math.round(performance.now() - start)
    }, lang)) as number
  }

  const mermaidMs = await measure('mermaid')
  // small pause so the two measurements don't overlap settle timers
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const d2Ms = await measure('d2')

  // eslint-disable-next-line no-console
  console.log(
    `[render-cost-spike] (edit→fresh svg, incl ~${QUIET_MS}ms quiet window)\n` +
      `  mermaid(heavy): ${mermaidMs}ms  → render≈${mermaidMs - QUIET_MS}ms\n` +
      `  d2(WASM+ELK):   ${d2Ms}ms  → render≈${d2Ms - QUIET_MS}ms`,
  )
  expect(mermaidMs).toBeGreaterThan(0)
  expect(d2Ms).toBeGreaterThan(0)
})
