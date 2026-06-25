// ELK D2 layout engine (vmarkd.diagram.d2Layout=vmarkd, the default) — real-VS-Code only.
//
// The whole point of this suite: the stock elk.bundled.js spawns a blob Web Worker that
// `elk.layout()` REJECTS under the VS Code webview, so an ELK-based engine used to silently fall back
// to dagre. We now bundle elkjs as a MAIN-THREAD instance (elk-main.js → window.__vmarkdElk, no
// Worker). This proves (a) that instance boots in the real webview, (b) elk.layout() actually
// resolves there, and (c) its output reaches the rendered D2 SVG (data-d2-engine=vmarkd), not the
// dagre fallback. We exercise the default `vmarkd` engine (ELK + our refinement pipeline); the raw
// `elk` engine shares the identical boot/layout path (just skips refineLayout). None of this
// reproduces in the Playwright harness (no real resource-URI pipeline for the lazy-loaded bundle,
// no real config plumbing).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('D2 renders via the ELK engine on the webview main thread', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      // Select the vmarkd layout engine (default: ELK + refinement) BEFORE opening
      // (collectConfigOptions reads it at open).
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.d2Layout', 'vmarkd', true)
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
  // D2 lazy-loads the WASM compiler + the elk-main.js bundle, then lays out + renders. Wait for the
  // wrapper to be STAMPED data-d2-engine=elk — the deterministic signal that the whole chain ran
  // (replaces a fixed sleep, which flaked on cold VS Code starts where 9 s wasn't enough).
  await frame
    .locator('.language-d2[data-d2-engine="vmarkd"]')
    .first()
    .waitFor({ timeout: 60_000 })

  // (1) the setting reached the webview, and (2) the main-thread ELK instance booted.
  const boot = await frame.locator('body').evaluate(() => ({
    d2Layout: (window as any).__vmarkdD2Layout,
    hasElk: typeof (window as any).__vmarkdElk?.layout === 'function',
  }))
  // eslint-disable-next-line no-console
  console.log(`[d2-elk] boot: ${JSON.stringify(boot)}`)
  expect(boot.d2Layout).toBe('vmarkd')
  expect(boot.hasElk).toBe(true)

  // (3) elk.layout() RESOLVES in the webview — the exact call that rejected with the blob Worker.
  const layout = await frame.locator('body').evaluate(async () => {
    try {
      const res = await (window as any).__vmarkdElk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.edgeRouting': 'ORTHOGONAL',
        },
        children: [
          { id: 'a', width: 60, height: 30 },
          { id: 'b', width: 60, height: 30 },
          { id: 'c', width: 60, height: 30 },
        ],
        edges: [
          { id: 'e1', sources: ['a'], targets: ['b'] },
          { id: 'e2', sources: ['b'], targets: ['c'] },
        ],
      })
      return {
        ok: true,
        w: Math.round(res.width || 0),
        h: Math.round(res.height || 0),
        positioned: (res.children || []).every(
          (n: any) => typeof n.x === 'number' && typeof n.y === 'number',
        ),
        hasSections: !!res.edges?.[0]?.sections?.length,
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[d2-elk] layout: ${JSON.stringify(layout)}`)
  expect(layout.ok).toBe(true)
  expect(layout.positioned).toBe(true)
  expect(layout.hasSections).toBe(true)
  expect(layout.h).toBeGreaterThan(layout.w) // DOWN-stacked a→b→c is taller than wide

  // (4) ELK's output reached the rendered D2 SVG — at least one block stamped data-d2-engine=vmarkd,
  // NOT the dagre fallback. The fixture's sequence_diagram block still falls back to raw source.
  const render = await frame.locator('body').evaluate(() => {
    const wrappers = Array.from(
      document.querySelectorAll('.language-d2[data-processed="true"]'),
    )
    const engines = wrappers.map((w) => w.getAttribute('data-d2-engine'))
    const elkSvg = wrappers.find(
      (w) =>
        w.getAttribute('data-d2-engine') === 'vmarkd' && w.querySelector('svg'),
    )
    return {
      count: wrappers.length,
      engines,
      anyElk: engines.includes('vmarkd'),
      elkHasSvg: !!elkSvg,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[d2-elk] render: ${JSON.stringify(render)}`)
  expect(render.anyElk).toBe(true)
  expect(render.elkHasSvg).toBe(true)

  // Reset the setting so other specs see the default (vmarkd).
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('diagram.d2Layout', undefined, true)
  })
})
