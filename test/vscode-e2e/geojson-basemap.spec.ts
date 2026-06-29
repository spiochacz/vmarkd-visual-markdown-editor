// The `vmarkd.theme.geoBasemap` setting picks the basemap UNDER geojson/topojson maps. Default `auto`
// is themed monochrome CARTO (covered by geojson-tiles.spec.ts); here we verify the override values
// load the right tile source: `osm` → OpenStreetMap, `voyager` → CARTO Voyager (colored), `none` →
// no basemap even with remote images allowed. All gated by image.allowRemoteImages (CSP). Real VS Code
// only (Leaflet tiles + the custom-editor CSP pipeline).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Reset the globally-written settings after each test so this spec doesn't pollute others sharing the
// VS Code instance (geojson-tiles.spec.ts relies on the DEFAULT geoBasemap — leaking `none` here would
// break its ON case). `update(key, undefined, true)` drops the global override → back to the default.
test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    const cfg = vscode.workspace.getConfiguration('vmarkd')
    await cfg.update('theme.geoBasemap', undefined, true)
    await cfg.update('image.allowRemoteImages', undefined, true)
  }, [])
})

async function open(
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
  basemap: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [string, string]) => {
      const [uri, geoBasemap] = args
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await cfg.update('image.allowRemoteImages', true, true)
      await cfg.update('theme.geoBasemap', geoBasemap, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE, basemap] as [string, string],
  )
}

function tileInfo(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const tiles = [
      ...document.querySelectorAll('.language-geojson img.leaflet-tile'),
    ] as HTMLImageElement[]
    return {
      tileCount: tiles.length,
      anyOsm: tiles.some((t) => t.src.includes('tile.openstreetmap.org')),
      anyVoyager: tiles.some((t) =>
        t.src.includes('cartocdn.com/rastertiles/voyager'),
      ),
      anyMono: tiles.some(
        (t) =>
          t.src.includes('cartocdn.com/light_all') ||
          t.src.includes('cartocdn.com/dark_all'),
      ),
    }
  })
}

async function waitForMap(frame: ReturnType<typeof wf>) {
  await frame
    .locator('.language-geojson .leaflet-container')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
}

test('geoBasemap=osm loads OpenStreetMap tiles (not CARTO)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, 'osm')
  const frame = wf(workbox)
  await waitForMap(frame)
  const info = await tileInfo(frame)
  // eslint-disable-next-line no-console
  console.log(`[geojson-basemap osm] ${JSON.stringify(info)}`)
  expect(info.tileCount).toBeGreaterThan(0)
  expect(info.anyOsm).toBe(true)
  expect(info.anyMono).toBe(false) // not the default mono CARTO
})

test('geoBasemap=voyager loads the colored CARTO Voyager tiles', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, 'voyager')
  const frame = wf(workbox)
  await waitForMap(frame)
  const info = await tileInfo(frame)
  // eslint-disable-next-line no-console
  console.log(`[geojson-basemap voyager] ${JSON.stringify(info)}`)
  expect(info.tileCount).toBeGreaterThan(0)
  expect(info.anyVoyager).toBe(true)
  expect(info.anyMono).toBe(false) // not the default mono CARTO
})

test('geoBasemap=none shows no basemap even with remote images allowed', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, 'none')
  const frame = wf(workbox)
  await waitForMap(frame)
  const info = await tileInfo(frame)
  // eslint-disable-next-line no-console
  console.log(`[geojson-basemap none] ${JSON.stringify(info)}`)
  expect(info.tileCount).toBe(0) // geometry only — no tiles requested
})
