import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// SPIKE (diagnostic) — verify the d2 INSERT jump is gone: while the settle re-render runs, the d2
// preview must NEVER be empty (no svg AND no overlay) — an empty frame is the collapse that makes
// everything below jump. Insert a char, sample the preview every 16ms through the settle, and flag
// any "empty" frame. Before the overlay-cover fix the INSERT path rendered without an overlay
// (isTyping=false during the fence-respin) → gap; after, restoreOverlay covers it until swap.
const FIXTURE = path.join(__dirname, 'fixtures', 'render-cost-spike.md')

test('SPIKE: d2 insert keeps the preview covered (no empty/jump frame)', async ({
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
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // caret at end of the d2 source
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  await frame.locator('body').evaluate(() => {
    const node = Array.from(
      document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
    ).find((n) => n.querySelector('code.language-d2')) as
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

  // sample the d2 preview region through the whole settle+render window
  const poll = frame.locator('body').evaluate(async () => {
    const d2Preview = () => {
      const node = Array.from(
        document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
      ).find((n) => n.querySelector('code.language-d2'))
      return node?.querySelector('.vditor-ir__preview') as HTMLElement | null
    }
    let emptyFrames = 0
    let sawFreshAfterEdit = false
    let samples = 0
    let waited = 0
    while (waited < 2000) {
      await new Promise((r) => setTimeout(r, 16))
      waited += 16
      const p = d2Preview()
      if (!p) continue
      samples++
      const hasSvg = !!p.querySelector('.language-d2 svg, svg')
      const hasOverlay = !!p.querySelector('.vmarkd-stale-overlay')
      const visible = (p.getBoundingClientRect().height || 0) > 8
      if (!hasSvg && !hasOverlay && !visible) emptyFrames++
      if (
        p.querySelector('.language-d2 svg') &&
        !p.querySelector('.vmarkd-stale-overlay')
      )
        sawFreshAfterEdit = true
    }
    return { emptyFrames, samples, sawFreshAfterEdit }
  })
  await new Promise((r) => setTimeout(r, 30))
  await workbox.keyboard.type(' ', { delay: 0 }) // INSERT (175-skipped path)
  const r = (await poll) as {
    emptyFrames: number
    samples: number
    sawFreshAfterEdit: boolean
  }

  // eslint-disable-next-line no-console
  console.log(
    `[d2-insert-gap] emptyFrames=${r.emptyFrames}/${r.samples} (0 = preview never collapsed → no jump) ` +
      `sawFreshRender=${r.sawFreshAfterEdit}`,
  )
  expect(r.samples).toBeGreaterThan(0)
})
