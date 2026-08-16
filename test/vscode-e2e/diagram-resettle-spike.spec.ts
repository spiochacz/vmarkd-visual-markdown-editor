import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// SPIKE (diagnostic) — after editing ONE diagram, does the settle re-render ALL diagram
// previews or just the edited one? Decides whether option A ("render only the changed
// diagram") has anything to win, or whether Vditor's processCodeRender already dirty-checks.
// Method: tag every rendered mermaid <svg> with a unique marker, edit the SECOND diagram's
// source, wait for the settle re-render to finish, then count how many marked svgs SURVIVED
// (a re-rendered diagram gets a fresh svg → loses its mark).
//   survivors === 0        → ALL diagrams re-rendered (render-all confirmed → option A wins)
//   survivors === count-1  → only the edited one re-rendered (Vditor already skips → A moot)
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-resettle-spike.md')

test('SPIKE: settle re-renders all diagrams vs only the edited one', async ({
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
  // wait for all 3 mermaid diagrams to render
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 5000)))

  // Tag every rendered (non-overlay) mermaid svg.
  const tagged = (await frame.locator('body').evaluate(() => {
    const svgs = Array.from(
      document.querySelectorAll('.language-mermaid svg'),
    ).filter((s) => !s.closest('.vmarkd-stale-overlay'))
    svgs.forEach((s, i) => {
      s.setAttribute('data-spike-mark', `m${i}`)
    })
    return svgs.length
  })) as number

  // Put the caret at the END of the SECOND diagram's source code, focus it, and record the
  // source length so we can confirm the edit actually landed.
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  const placed = (await frame.locator('body').evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
    ).filter((n) => n.querySelector('code.language-mermaid'))
    const target = nodes[1] as HTMLElement | undefined
    const code = target?.querySelector('.vditor-ir__marker--pre code') as
      | HTMLElement
      | undefined
    if (!code) return { ok: false, srcLen: 0 }
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      last = n
      n = walker.nextNode() as Text | null
    }
    const node: Node = last ?? code
    const len = node.nodeType === 3 ? (node.textContent ?? '').length : 0
    const r = document.createRange()
    r.setStart(node, len)
    r.collapse(true)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    target?.focus()
    return { ok: true, srcLen: (code.textContent ?? '').length }
  })) as { ok: boolean; srcLen: number }

  // Type a harmless char into diagram #2, then WAIT for the edited diagram to actually
  // re-render (its m1-marked svg replaced) — NOT just "no overlay", which is true at t=0.
  await workbox.keyboard.type('X', { delay: 0 })
  const result = (await frame.locator('body').evaluate(
    async (_b, ctx) => {
      const { count, srcLenBefore } = ctx as {
        count: number
        srcLenBefore: number
      }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const start = performance.now()
      const editedCode = () => {
        const nodes = Array.from(
          document.querySelectorAll('.vditor-ir__node[data-type="code-block"]'),
        ).filter((n) => n.querySelector('code.language-mermaid'))
        return (nodes[1] as HTMLElement | undefined)?.querySelector(
          '.vditor-ir__marker--pre code',
        )
      }
      const editedStillMarked = () =>
        !!document.querySelector('svg[data-spike-mark="m1"]')
      let waited = 0
      let editedReRenderedAt = -1
      // poll until the EDITED diagram's original svg (m1) is gone → it re-rendered
      while (waited < 9000) {
        await sleep(50)
        waited += 50
        if (!editedStillMarked()) {
          editedReRenderedAt = Math.round(performance.now() - start)
          break
        }
      }
      // give any render-all of the OTHER diagrams a moment to also complete
      await sleep(600)
      const fresh = Array.from(
        document.querySelectorAll('.language-mermaid svg'),
      ).filter((s) => !s.closest('.vmarkd-stale-overlay'))
      const survivors = fresh.filter((s) =>
        s.hasAttribute('data-spike-mark'),
      ).length
      const srcLenAfter = (editedCode()?.textContent ?? '').length
      return {
        editToReRenderMs: editedReRenderedAt,
        editedReRendered: editedReRenderedAt >= 0,
        taggedDiagrams: count,
        freshAfter: fresh.length,
        survivors,
        editLanded: srcLenAfter > srcLenBefore,
        srcLenBefore,
        srcLenAfter,
      }
    },
    { count: tagged, srcLenBefore: placed.srcLen },
  )) as {
    editToReRenderMs: number
    editedReRendered: boolean
    taggedDiagrams: number
    freshAfter: number
    survivors: number
    editLanded: boolean
    srcLenBefore: number
    srcLenAfter: number
  }

  const verdict = !result.editLanded
    ? 'INCONCLUSIVE (the edit never reached the source)'
    : !result.editedReRendered
      ? 'INCONCLUSIVE (the edited diagram never re-rendered in 9s)'
      : result.survivors === 0
        ? 'RENDER-ALL (all diagrams re-rendered → option A wins)'
        : result.survivors === result.taggedDiagrams - 1
          ? 'ONLY-EDITED (Vditor already skips unchanged → option A moot)'
          : `MIXED (${result.survivors}/${result.taggedDiagrams} survived)`
  // eslint-disable-next-line no-console
  console.log(
    `[diagram-resettle-spike] placedCaret=${placed.ok} editLanded=${result.editLanded} ` +
      `(src ${result.srcLenBefore}→${result.srcLenAfter}) editedReRendered=${result.editedReRendered} ` +
      `edit→reRender≈${result.editToReRenderMs}ms\n  tagged=${result.taggedDiagrams} ` +
      `survivors=${result.survivors} freshAfter=${result.freshAfter}\n  VERDICT: ${verdict}`,
  )
  expect(result.taggedDiagrams).toBeGreaterThanOrEqual(2)
})
