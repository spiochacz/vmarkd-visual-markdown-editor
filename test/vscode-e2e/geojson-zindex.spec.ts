// A geojson/topojson map must NOT paint over the Vditor toolbar dropdowns (user: "mapa przykrywa
// rozwijane menu jak np w toolbarze"). Leaflet gives its control containers z-index 1000 (the zoom
// control is always present, even offline); with no stacking boundary that escaped to the editor root
// and covered `.vditor-panel` (the toolbar dropdown, z-index 3). The fix wraps each map in its own
// stacking context (`isolation: isolate` in main.css) so Leaflet's z-indexes stay scoped to the map.
//
// This reproduces the exact stacking: it parents a faithful `.vditor-panel` probe (the real class →
// real z-index 3) in the real toolbar, positioned over the map's zoom control, and asserts
// elementFromPoint hits the PANEL, not a Leaflet element. RED before the fix (Leaflet's z-index 1000
// wins → elementFromPoint returns the control). Real VS Code only (the toolbar + custom-editor CSS).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('a geojson map does not cover the toolbar dropdown (z-index isolated)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [string]) => {
      const [uri] = args
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
  // the zoom control is always rendered (zoomControl:true), even offline — that's the z-index:1000 offender
  await frame
    .locator('.language-geojson .leaflet-control-zoom')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  // the geojson block is far down the all-renderers fixture — scroll it into the centre of the viewport
  // so its zoom control is on-screen (elementFromPoint returns null for off-viewport points).
  await frame.locator('body').evaluate(() => {
    const w = document.querySelector(
      '.vditor-ir__preview .language-geojson, .vditor-wysiwyg__preview .language-geojson, .vditor-preview .language-geojson',
    )
    w?.scrollIntoView({ block: 'center' })
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 600)))

  const r = await frame.locator('body').evaluate(() => {
    const wrap = document.querySelector(
      '.vditor-ir__preview .language-geojson, .vditor-wysiwyg__preview .language-geojson, .vditor-preview .language-geojson',
    ) as HTMLElement | null
    const zoom = wrap?.querySelector(
      '.leaflet-control-zoom',
    ) as HTMLElement | null
    const toolbar = document.querySelector(
      '.vditor-toolbar',
    ) as HTMLElement | null
    if (!wrap || !zoom || !toolbar)
      return { ok: false, reason: 'missing nodes' }

    // a point over the map's zoom control (Leaflet's highest layer, z-index 1000)
    const zr = zoom.getBoundingClientRect()
    const px = Math.round(zr.left + zr.width / 2)
    const py = Math.round(zr.top + zr.height / 2)
    if (py < 0 || py > window.innerHeight || px < 0 || px > window.innerWidth)
      return { ok: false, reason: `zoom control off-viewport (${px},${py})` }

    // a faithful toolbar-dropdown probe: real `.vditor-panel` class (→ real z-index 3), parented in the
    // real toolbar (its real stacking context), positioned over that point.
    const probe = document.createElement('div')
    probe.className = 'vditor-panel'
    probe.setAttribute('data-zprobe', '1')
    probe.style.position = 'fixed'
    probe.style.left = `${px - 40}px`
    probe.style.top = `${py - 20}px`
    probe.style.width = '100px'
    probe.style.height = '60px'
    probe.style.display = 'block'
    toolbar.appendChild(probe)

    const hit = document.elementFromPoint(px, py) as HTMLElement | null
    const onPanel = !!hit?.closest('[data-zprobe="1"]')
    const onLeaflet = !!hit?.closest('.leaflet-container')
    const isolation = getComputedStyle(wrap).isolation
    probe.remove()
    return {
      ok: true,
      onPanel,
      onLeaflet,
      isolation,
      hit: hit?.className ?? null,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[geojson-zindex] ${JSON.stringify(r)}`)

  expect(r.ok, r.reason ?? '').toBe(true)
  expect(r.isolation).toBe('isolate') // the fix is applied to the map wrapper
  expect(
    r.onPanel,
    `toolbar dropdown is covered by the map (hit=${r.hit})`,
  ).toBe(true)
  expect(r.onLeaflet).toBe(false) // the map's control no longer paints on top
})
