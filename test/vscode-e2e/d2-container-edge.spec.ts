import { wf } from './webview-helpers'
// Task 104 leftover, in the REAL webview: dagre's rank pass only walks LEAF nodes, so an edge whose
// endpoint is a container ("gateway -> frontend") threw "Cannot set properties of undefined (setting
// 'rank')" out of renderD2Graph. That throw lands in renderD2's `.catch { leave source visible }`,
// so the user saw the raw ```d2 text with no rendered diagram and no stated reason.
//
// dagre is no longer the DEFAULT engine ('vmarkd' = ELK + refinement is), but it is still the
// unconditional fallback whenever ELK fails to load or lay out — so this path is reachable without
// the user ever picking it. The spec pins it explicitly via vmarkd.diagram.d2.layout: 'dagre',
// because asserting through the default engine would prove nothing about dagre at all.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'd2-container-edge.md')

// Set once, up front, before opening — the layout engine is read into the webview at init.
usePinnedSettings(test, { 'vmarkd.diagram.d2.layout': 'dagre' })

test('a D2 diagram with container-endpoint edges renders under the dagre engine', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
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
  // The crash left the source visible with no <svg> at all, so waiting for one IS the assertion —
  // but wait via poll so the failure reports the wrapper's state rather than a bare locator timeout.
  // IR is dual-node: the editable SOURCE <code class="language-d2"> and the rendered preview wrapper
  // both carry the class, and the source one is first in the document — scan for the render wrapper
  // rather than taking querySelector's first hit.
  await expect
    .poll(
      async () =>
        frame.locator('body').evaluate(() => {
          const w = [...document.querySelectorAll('.language-d2')].find(
            (n) => n.querySelector('svg') || n.hasAttribute('data-d2-error'),
          )
          return {
            hasSvg: !!w?.querySelector('svg'),
            err: w?.getAttribute('data-d2-error') ?? null,
            engine: w?.getAttribute('data-d2-engine') ?? null,
          }
        }),
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toMatchObject({ hasSvg: true, engine: 'dagre' })

  const shape = await frame.locator('body').evaluate(() => {
    const w = [...document.querySelectorAll('.language-d2')].find((n) =>
      n.querySelector('svg'),
    )
    const svg = w?.querySelector('svg')
    return {
      err: w?.getAttribute('data-d2-error') ?? null,
      unsupported: !!document.querySelector('.language-d2-unsupported'),
      // 3 container-endpoint edges in the fixture; each must survive layout, not be dropped.
      paths: svg?.querySelectorAll('path').length ?? 0,
      rects: svg?.querySelectorAll('rect').length ?? 0,
    }
  })
  expect(shape.err, 'no compile/boot error was recorded').toBeFalsy()
  expect(shape.unsupported, 'not the loud unsupported fallback').toBe(false)
  // gateway + 2 containers + 4 children = 7 boxes; the exact count can move with chrome, so assert
  // the floor that proves containers AND their children were all drawn.
  expect(shape.rects).toBeGreaterThanOrEqual(7)
  expect(shape.paths, 'all three edges routed').toBeGreaterThanOrEqual(3)
})
