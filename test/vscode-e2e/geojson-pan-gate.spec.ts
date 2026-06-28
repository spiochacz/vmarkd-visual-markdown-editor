// Ctrl-to-pan gate for geojson/topojson Leaflet maps (diagram-zoom-gate.ts) — real-VS-Code only.
//
// Leaflet's `dragging` is on by default, so a plain drag over a rendered map PANS it — hijacking the
// pointer while you try to scroll/edit. We extend the existing markmap/mindmap Ctrl-gate to maps: a
// plain mousedown over the rendered map is suppressed (document-capture stopImmediatePropagation) so
// Leaflet never starts a pan; Ctrl+drag passes through (Leaflet pans); and the +/- zoom control stays
// plain-clickable. We assert the deterministic signal of the gate: whether a bubble-phase sentinel ON
// the map wrapper sees the mousedown (stopped by the capture gate ⟹ no pan). The behaviour lives
// entirely in the webview's native event path, so it is not reproducible in the chromium harness.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('geojson map: plain drag is gated (no pan), Ctrl+drag pans, +/- control still clickable', async ({
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
  // default mode is IR → the rendered map lives in .vditor-ir__preview
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.language-geojson .leaflet-container')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const info = await frame.locator('body').evaluate(() => {
    const container = document.querySelector(
      '.language-geojson .leaflet-container',
    ) as HTMLElement | null
    const wrap = container?.closest('.language-geojson') as HTMLElement | null
    if (!container || !wrap) return { error: 'no rendered map' }
    const control = wrap.querySelector(
      '.leaflet-control-zoom a, .leaflet-control a',
    ) as HTMLElement | null

    // CAPTURE-phase sentinel on the wrapper: it runs after the document-capture gate but before the
    // event reaches Leaflet — so it reflects ONLY whether OUR gate stopped the event, independent of
    // Leaflet's own bubble-phase disableClickPropagation on the +/- control (which would otherwise
    // mask a correctly-exempted control click from a bubble sentinel).
    let reached = false
    const sentinel = () => {
      reached = true
    }
    wrap.addEventListener('mousedown', sentinel, true)
    const fire = (el: Element, ctrlKey: boolean): boolean => {
      reached = false
      el.dispatchEvent(
        new MouseEvent('mousedown', {
          button: 0,
          ctrlKey,
          bubbles: true,
          cancelable: true,
        }),
      )
      return reached
    }
    const plainDrag = fire(container, false)
    const ctrlDrag = fire(container, true)
    const controlClick = control ? fire(control, false) : null
    wrap.removeEventListener('mousedown', sentinel, true)

    return {
      inPreviewPane: !!wrap.closest(
        '.vditor-ir__preview, .vditor-wysiwyg__preview, .vditor-preview',
      ),
      hasControl: !!control,
      plainDrag, // expect false — gated → Leaflet never starts a pan
      ctrlDrag, // expect true  — passes → Leaflet pans
      controlClick, // expect true  — +/- control exempt from the gate
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[geojson-pan-gate] ${JSON.stringify(info)}`)

  expect(info.error).toBeUndefined()
  expect(info.inPreviewPane).toBe(true)
  expect(info.plainDrag).toBe(false) // plain drag suppressed → no pan
  expect(info.ctrlDrag).toBe(true) // Ctrl+drag reaches Leaflet → pans
  if (info.hasControl) expect(info.controlClick).toBe(true) // +/- still clickable
})
