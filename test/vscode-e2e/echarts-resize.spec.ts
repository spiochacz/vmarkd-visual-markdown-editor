import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// ECharts must stay responsive to a window/pane resize. echarts.init installs no resize handler, so
// without installEchartsResize the chart keeps its old pixel width when the editor widens — it stays
// anchored left while the container grows to the right ("lewa nie zmienia, prawa rozciąga się w
// prawo"). installEchartsResize (window 'resize' listener) resizes every instance to fill its
// container. We widen the editor by hiding the sidebar and assert the canvas tracks the container.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('echarts canvas tracks its container when the editor pane is resized', async ({
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
  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir__preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const ech = document.querySelector(
        '.vditor-ir__preview .language-echarts',
      ) as HTMLElement
      const cv = ech.querySelector('canvas') as HTMLCanvasElement
      return {
        container: Math.round(ech.getBoundingClientRect().width),
        canvas: Math.round(cv.getBoundingClientRect().width),
      }
    })

  const before = await measure()
  // Widen the editor pane: hide the sidebar → the webview (and the echarts container) grows.
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand(
      'workbench.action.toggleSidebarVisibility',
    )
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const after = await measure()

  // eslint-disable-next-line no-console
  console.log(
    `[resize] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  )

  const near = (a: number, b: number) => Math.abs(a - b) <= 2
  // The pane actually widened (guards the test itself).
  expect(after.container).toBeGreaterThan(before.container + 20)
  // The chart filled its container before AND after the resize (it did not stay anchored at the
  // old width with a growing right-hand gap).
  expect(near(before.canvas, before.container)).toBe(true)
  expect(near(after.canvas, after.container)).toBe(true)
})
