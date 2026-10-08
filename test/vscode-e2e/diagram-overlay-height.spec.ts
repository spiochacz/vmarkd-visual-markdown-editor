// Task 532 step 5c — the instant-paint overlay reserves a diagram's height, so the content BELOW it
// does not move when the live editor takes over.
//
// FIRST open (empty cache): the host has no recorded size; the overlay shows an empty box of the
// fixed minimum (no fence source) and the paragraph below jumps by (rendered height - minimum) - the
// bounded, documented case (test/parity/policy.ts). SECOND open (the webview reported the sizes on
// the first): the overlay reserves the recorded height and the paragraph below stays put. Measured in
// px, with the overlay held past boot (VMARKD_PRERENDER_PARITY_HOLD, same hook as parity-matrix).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-overlay-height.md')

test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})

interface Probe {
  /** top of the paragraph below the diagrams, relative to its root */
  belowTop: number
  boxes: { text: string; height: number }[]
}

const probe = (_b: unknown, [sel, boxSel]: [string, string]) => {
  const root = document.querySelector(sel) as HTMLElement
  const base = root.getBoundingClientRect().top
  const below = Array.from(root.querySelectorAll('p')).find((p) =>
    (p.textContent ?? '').includes('PXbelow'),
  ) as HTMLElement
  const boxes = Array.from(document.querySelectorAll(boxSel)).map((e) => ({
    text: e.textContent ?? '',
    height: Math.round(e.getBoundingClientRect().height * 100) / 100,
  }))
  return {
    belowTop:
      Math.round((below.getBoundingClientRect().top - base) * 100) / 100,
    boxes,
  } satisfies Probe
}

test('the content below a diagram does not move at the swap once the size is known', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const open = () =>
    evaluateInVSCode(
      async (vscode, args) => {
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

  // One open: hold the overlay, measure it, release it, measure the live editor.
  const measure = async () => {
    await open()
    await frame.locator('#vmarkd-prerender').waitFor({ timeout: 60_000 })
    const overlay = await frame
      .locator('body')
      .evaluate(probe, [
        '#vmarkd-prerender pre.vditor-reset',
        '#vmarkd-prerender .vmarkd-diagram-placeholder > *',
      ])
    await expect
      .poll(() =>
        frame
          .locator('body')
          .evaluate(
            () =>
              typeof (window as { __vmarkdReleasePrerender?: unknown })
                .__vmarkdReleasePrerender,
          ),
      )
      .toBe('function')
    await frame.locator('body').evaluate(() => {
      ;(
        window as unknown as { __vmarkdReleasePrerender: () => void }
      ).__vmarkdReleasePrerender()
    })
    await frame
      .locator('#vmarkd-prerender')
      .waitFor({ state: 'detached', timeout: 45_000 })
    for (const lang of ['mermaid', 'd2'])
      await frame
        .locator(`.vditor-ir div.language-${lang} svg`)
        .first()
        .waitFor({ timeout: 90_000 })
    // let the render's size reach the host before the next open
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 2000)))
    const live = await frame
      .locator('body')
      .evaluate(probe, [
        '.vditor-ir pre.vditor-reset',
        '.vditor-ir .language-nothing',
      ])
    return { overlay, live }
  }

  const first = await measure()
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    )
  })
  await new Promise((r) => setTimeout(r, 500))
  const second = await measure()

  const jump = (m: { overlay: Probe; live: Probe }) =>
    Math.round((m.live.belowTop - m.overlay.belowTop) * 100) / 100
  // eslint-disable-next-line no-console
  console.log(
    `[diagram-overlay-height] first open: overlay=${first.overlay.belowTop} live=${first.live.belowTop} jump=${jump(first)}px boxes=${JSON.stringify(first.overlay.boxes)}\n` +
      `[diagram-overlay-height] second open: overlay=${second.overlay.belowTop} live=${second.live.belowTop} jump=${jump(second)}px boxes=${JSON.stringify(second.overlay.boxes)}`,
  )

  // First open: a placeholder, never the fence source, at the fixed minimum.
  expect(first.overlay.boxes).toHaveLength(2)
  for (const b of first.overlay.boxes) {
    expect(b.text).toBe('')
    expect(b.height).toBe(160)
  }
  // The bounded jump of the uncached case: the diagrams are taller than the minimum.
  expect(jump(first)).toBeGreaterThan(20)

  // Second open: the recorded heights are reserved - nothing below moves.
  expect(second.overlay.boxes).toHaveLength(2)
  for (const b of second.overlay.boxes) expect(b.text).toBe('')
  expect(Math.abs(jump(second))).toBeLessThanOrEqual(1)
})
