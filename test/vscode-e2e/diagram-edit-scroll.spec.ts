import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Regression: editing a diagram must NOT leave a background rAF loop that stutters scrolling. An earlier
// cut snapshot-cached the diagrams via a MutationObserver that rasterised every canvas with toDataURL on
// each DOM mutation — while the diagrams idle-animate (STL's three.js render loop, leaflet, echarts) that
// fired ~20×/s, blocking the main thread ~25% AFTER an edit. Now the snapshot runs once per typing burst.
// We compare IDLE main-thread blocking BEFORE vs AFTER an edit: the edit must not add meaningful blocking
// (the standing animation cost of the fixture's 3D/map diagrams is present in both samples and cancels).
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('editing a diagram does not add background blocking (scroll stays smooth)', async ({
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
    .locator('.language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {})
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // Sample IDLE main-thread blocking (rAF-gap sum over 2.5 s, no typing/scroll).
  const sampleIdle = () =>
    frame.locator('body').evaluate(
      () =>
        new Promise<number>((resolve) => {
          let blockingMs = 0
          let last = performance.now()
          const start = last
          const tick = () => {
            const now = performance.now()
            const gap = now - last
            last = now
            if (gap > 20) blockingMs += gap - 16.7
            if (now - start < 2500) requestAnimationFrame(tick)
            else resolve(Math.round(blockingMs))
          }
          requestAnimationFrame(tick)
        }),
    )

  const before = await sampleIdle()

  // Edit the first d2 block: place caret at the end of its source, type a few chars, let it settle.
  await frame.locator('body').evaluate(() => {
    const node = document
      .querySelector('.language-d2')
      ?.closest('.vditor-ir__node') as HTMLElement | null
    if (!node) return
    node.classList.add('vditor-ir__node--expand')
    const src = node.querySelector(
      '.vditor-ir__marker--pre',
    ) as HTMLElement | null
    if (!src) return
    const walker = document.createTreeWalker(src, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      if ((n.textContent ?? '').trim().length) t = n
      n = walker.nextNode() as Text | null
    }
    if (!t) return
    const r = document.createRange()
    r.setStart(t, (t.textContent ?? '').length)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    src.focus()
  })
  await workbox.keyboard.type('xxxxx', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const after = await sampleIdle()
  // eslint-disable-next-line no-console
  console.log(
    `[diagram-edit-scroll] idle blocking before=${before}ms after=${after}ms`,
  )

  // The edit must not add a sustained background loop. Allow generous slack for headless-GL variance;
  // the pre-fix delta was ~300 ms (a per-frame toDataURL storm), so 250 ms cleanly catches a regression.
  expect(
    after - before,
    `editing added ${after - before}ms of idle blocking (before=${before}, after=${after}) — a background loop is stuttering scroll`,
  ).toBeLessThan(250)
})
