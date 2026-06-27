// GeoJSON/TopoJSON basemap tiles (task 99). Default = geometry-only, fully offline (no tile requests).
// When the user opts into remote images (vmarkd.image.allowRemoteImages), initLeafletMap adds CARTO's
// no-key basemap UNDER the geometry; the CSP only allows the https tiles when that setting is on.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

async function open(
  evaluateInVSCode: any,
  allowRemoteImages: boolean,
): Promise<void> {
  await evaluateInVSCode(
    async (vscode: any, args: any) => {
      const [uri, allow] = args as [string, boolean]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('image.allowRemoteImages', allow, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE, allowRemoteImages] as [string, boolean],
  )
}

function countTiles(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const tiles = [
      ...document.querySelectorAll('.language-geojson img.leaflet-tile'),
    ] as HTMLImageElement[]
    return {
      tileCount: tiles.length,
      anyCarto: tiles.some((t) => t.src.includes('cartocdn.com')),
    }
  })
}

test('geojson shows a remote basemap when allowRemoteImages is ON', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, true)
  const frame = wf(workbox)
  await frame
    .locator('.language-geojson .leaflet-container')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const info = await countTiles(frame)
  // eslint-disable-next-line no-console
  console.log(`[geojson-tiles ON] ${JSON.stringify(info)}`)
  expect(info.tileCount).toBeGreaterThan(0)
  expect(info.anyCarto).toBe(true)
})

test('geojson stays geometry-only (no tiles) when allowRemoteImages is OFF', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, false)
  const frame = wf(workbox)
  await frame
    .locator('.language-geojson .leaflet-container')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const info = await countTiles(frame)
  // eslint-disable-next-line no-console
  console.log(`[geojson-tiles OFF] ${JSON.stringify(info)}`)
  expect(info.tileCount).toBe(0)
})
