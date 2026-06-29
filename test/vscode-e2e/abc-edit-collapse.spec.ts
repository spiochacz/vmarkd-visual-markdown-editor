// abc preview height collapses while editing → content below bounces (task 161 follow-up) — real-VS-Code.
//
// While typing, edit-activity shows the last render in a `.vmarkd-stale-overlay`. abc's cached svg
// re-lays-out SHORTER inside the overlay (no viewBox → ~73px vs the 124px live render region), so the
// preview shrank mid-typing → the content below jumped up, then back down when the live render swapped
// in (user: "stary diagram znika, content podskakuje, potem wraca"). Fix: the overlay reserves the live
// render REGION's height (visualSnapshot captures the `.language-X` wrapper height; restoreOverlay pins
// min-height). This drives a real edit and asserts the preview height never collapses below the render.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('editing abc never collapses the preview height (overlay reserves the render height)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
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
    .locator('.vditor-ir__preview .language-abc svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // sample the abc PREVIEW height + whether the deferred overlay is up, each frame, across the edit
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    w.__samples = []
    w.__sampling = true
    const tick = () => {
      if (!w.__sampling) return
      const preview = document
        .querySelector('.vditor-ir__marker--pre code.language-abc')
        ?.closest('.vditor-ir__node')
        ?.querySelector('.vditor-ir__preview') as HTMLElement | null
      w.__samples.push({
        h: preview ? Math.round(preview.getBoundingClientRect().height) : -1,
        overlay: preview
          ? !!preview.querySelector('.vmarkd-stale-overlay')
          : false,
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  // place the caret after "Major" in the abc title and type — real keystrokes drive the defer/overlay/
  // settle cycle (the title edit keeps the abc valid so the render returns to its full height).
  const placed = await frame.locator('body').evaluate(() => {
    const node = document
      .querySelector('.vditor-ir__marker--pre code.language-abc')
      ?.closest('.vditor-ir__node') as HTMLElement | null
    if (!node) return false
    node.classList.add('vditor-ir__node--expand')
    const source = node.querySelector(
      '.vditor-ir__marker--pre',
    ) as HTMLElement | null
    if (!source) return false
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
    let n = walker.nextNode() as Text | null
    while (n) {
      const i = (n.textContent ?? '').indexOf('Major')
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(n, i + 5)
        r.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
        source.focus()
        return true
      }
      n = walker.nextNode() as Text | null
    }
    return false
  })
  expect(placed).toBe(true)
  await workbox.keyboard.type('xyz', { delay: 90 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const r = await frame.locator('body').evaluate(() => {
    const w = window as unknown as Record<string, any>
    w.__sampling = false
    const s = w.__samples as Array<{ h: number; overlay: boolean }>
    const heights = s.map((x) => x.h).filter((h) => h > 0)
    return {
      baseline: heights[0],
      minH: Math.min(...heights),
      maxH: Math.max(...heights),
      overlayFrames: s.filter((x) => x.overlay).length,
      frames: s.length,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[abc-collapse] ${JSON.stringify(r)}`)

  // the deferred overlay state was actually exercised (otherwise the assertion is vacuous)
  expect(r.overlayFrames).toBeGreaterThan(0)
  // the preview height NEVER collapsed below the render while typing (the bug shrank 124→79)
  expect(r.minH).toBeGreaterThanOrEqual(Math.round(r.baseline * 0.9))
})
