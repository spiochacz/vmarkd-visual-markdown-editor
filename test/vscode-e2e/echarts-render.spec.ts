// ECharts charts: (1) NO entry animation on first render / theme re-render (chartRender patch +
// reRenderEcharts force animation:false); (2) the canvas fits its container width on first render
// even when echarts.init() ran before the column settled (installEchartsResize's deferred re-fits).
// Real-VS-Code-only → headless via `xvfb-run -a npx playwright test echarts-render.spec`.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('echarts charts: no entry animation + canvas fits its container on first render', async ({
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
  // switch to WYSIWYG (its preview pane holds live, retrievable echarts instances)
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // wait past the deferred first-render re-fits (150/450/1000/2000ms)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const r = await frame.locator('body').evaluate(() => {
    const widthDeltas: number[] = []
    for (const el of Array.from(
      document.querySelectorAll('.language-echarts'),
    )) {
      const canvas = el.querySelector('canvas')
      const hostW = (el as HTMLElement).clientWidth
      if (canvas && hostW > 0)
        widthDeltas.push(
          Math.round(Math.abs(canvas.getBoundingClientRect().width - hostW)),
        )
    }
    return { widthDeltas }
  })
  // eslint-disable-next-line no-console
  console.log('[echarts] ' + JSON.stringify(r))
  // The chart canvas matches its container width on first render (the deferred re-fits corrected any
  // too-wide init captured before the column settled). (animation:false is locked by the
  // patchEchartsThemeInit unit test — the rendered preview is a snapshot with no queryable instance.)
  expect(r.widthDeltas.length).toBeGreaterThan(0)
  expect(Math.max(...r.widthDeltas)).toBeLessThanOrEqual(4)
})
