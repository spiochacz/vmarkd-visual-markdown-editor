// Inline diagram zoom/pan + ⛶ fullscreen button (diagram-zoom.ts) — real-VS-Code only.
//
// Proves, in the real webview: every rendered static-SVG diagram (d2/mermaid/flowchart/graphviz/abc/
// smiles) gets a ⛶ button and the wheel/drag/double-click transform handlers, and that they mutate the
// <svg> transform (zoom toward the cursor, pan, reset). Fullscreen itself is only smoke-checked (the
// Fullscreen API may be blocked inside the webview iframe — the richer overlay is task 157). This is a
// SEPARATE concern from diagram-zoom.spec.ts, which tests the Ctrl-gate for markmap/mindmap.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('rendered static-SVG diagrams get inline wheel/drag zoom+pan (⛶ gated off — task 157)', async ({
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
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  // wait for the observer to decorate (the ⛶ button is gated off — task 157 — so key off the marker)
  await frame
    .locator('[data-vmarkd-zoom="1"]')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const info = await frame.locator('body').evaluate(() => {
    const decorated = [...document.querySelectorAll('[data-vmarkd-zoom="1"]')]
    const fsButtons = document.querySelectorAll('.vmarkd-diagram-fs').length
    const wrap = document.querySelector(
      '.language-d2[data-vmarkd-zoom="1"]',
    ) as HTMLElement | null
    const svg = wrap?.querySelector('svg') as SVGElement | null
    const rect = wrap?.getBoundingClientRect()
    const at = (dx: number, dy: number) => ({
      clientX: (rect?.left ?? 0) + dx,
      clientY: (rect?.top ?? 0) + dy,
    })
    // IR is the default mode → the diagram should not be text-selectable (click opens edit instead).
    const userSelectIR = wrap ? getComputedStyle(wrap).userSelect : ''

    // PLAIN wheel (no Ctrl) must NOT zoom — the page scrolls instead (regression guard for the
    // "diagram grabs the wheel while scrolling" bug).
    wrap?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterPlainWheel = svg?.style.transform || ''

    // Ctrl+wheel up (deltaY<0) → zoom in toward the cursor.
    wrap?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterWheel = svg?.style.transform || ''
    const scaleAfterWheel = Number(
      /scale\(([\d.]+)\)/.exec(transformAfterWheel)?.[1] ?? '1',
    )

    // Pan needs Ctrl too: a plain pointerdown must NOT start a pan.
    wrap?.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 2,
        ...at(50, 40),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        ...at(90, 70),
        bubbles: true,
      }),
    )
    const transformAfterPlainDrag = svg?.style.transform || ''
    wrap?.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        ...at(90, 70),
        bubbles: true,
      }),
    )

    // Ctrl + pan: pointerdown → move → up.
    wrap?.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        ctrlKey: true,
        pointerId: 1,
        ...at(50, 40),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        ...at(80, 60),
        bubbles: true,
      }),
    )
    wrap?.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        ...at(80, 60),
        bubbles: true,
      }),
    )
    const transformAfterPan = svg?.style.transform || ''

    // Double-click → reset.
    wrap?.dispatchEvent(
      new MouseEvent('dblclick', {
        ...at(50, 40),
        bubbles: true,
        cancelable: true,
      }),
    )
    const transformAfterReset = svg?.style.transform || ''

    return {
      decoratedCount: decorated.length,
      fsButtons,
      userSelectIR,
      transformAfterPlainWheel,
      scaleAfterWheel,
      transformAfterWheel,
      transformAfterPlainDrag,
      transformAfterPan,
      transformAfterReset,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[diagram-inline-zoom] ${JSON.stringify(info, null, 2)}`)

  expect(info.decoratedCount).toBeGreaterThan(0)
  expect(info.fsButtons).toBe(0) // ⛶ disabled until task 157 (FULLSCREEN_BUTTON=false)
  expect(info.userSelectIR).toBe('none') // no text selection on a diagram in IR (click opens edit)
  expect(info.transformAfterPlainWheel).toBe('') // plain wheel did NOT zoom (page scrolls)
  expect(info.scaleAfterWheel).toBeGreaterThan(1) // Ctrl+wheel zoomed in
  expect(info.transformAfterPlainDrag).toBe(info.transformAfterWheel) // plain drag did NOT pan
  expect(info.transformAfterPan).not.toBe(info.transformAfterWheel) // Ctrl+drag panned it
  expect(info.transformAfterReset).toMatch(/scale\(1(\.0+)?\)/) // reset to 1
})
