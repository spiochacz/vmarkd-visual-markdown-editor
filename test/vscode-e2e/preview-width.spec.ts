import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Edit↔Preview width parity (narrow / data-full-width="0"):
//   1. The Preview content column must equal the EDIT content column — the editor keeps a 35px
//      gutter floor (`max(35px, (100%-800)/2)`); the Preview must keep the SAME gutter so toggling
//      Edit→Preview does not reflow everything wider ("w preview echarts robi się trochę szerszy").
//   2. The ECharts chart must FILL its container in both panes — echarts.init measures once and
//      never resizes, so in the Preview overlay it rendered ~15px short (scrollbar settled after the
//      measure); observeEchartsFit (ResizeObserver) resizes it to fill. So the chart's canvas width
//      is the same in edit and preview.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('echarts width is identical edit↔preview (gutter preserved + chart fills)', async ({
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

  const w = (sel: string) =>
    frame.locator('body').evaluate((_b, s) => {
      const el = document.querySelector(s) as HTMLElement | null
      return el ? Math.round(el.getBoundingClientRect().width) : -1
    }, sel)

  const irPara = await w('.vditor-ir p')
  const irCanvas = await w('.vditor-ir__preview .language-echarts canvas')

  // Enter the full Preview overlay.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor?: {
          vditor?: {
            preview?: { element?: HTMLElement; render?: (x: unknown) => void }
          }
        }
      }
    ).vditor
    for (const el of Array.from(
      document.querySelectorAll('.vditor-ir, .vditor-wysiwyg, .vditor-sv'),
    ))
      (el as HTMLElement).style.display = 'none'
    if (v?.vditor?.preview?.element) {
      v.vditor.preview.element.style.display = 'block'
      v.vditor.preview.render(v.vditor)
    }
  })
  await frame
    .locator('.vditor-preview .language-echarts canvas')
    .first()
    .waitFor({ timeout: 30_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const pvPara = await w('.vditor-preview p')
  const pvDiv = await w('.vditor-preview .language-echarts')
  const pvCanvas = await w('.vditor-preview .language-echarts canvas')

  // eslint-disable-next-line no-console
  console.log(
    `[width] irPara=${irPara} irCanvas=${irCanvas} pvPara=${pvPara} pvDiv=${pvDiv} pvCanvas=${pvCanvas}`,
  )

  const near = (a: number, b: number) => Math.abs(a - b) <= 2
  // Gutter preserved → the content column is the same width in edit and preview.
  expect(near(pvPara, irPara)).toBe(true)
  // The chart fills its container in the preview (no scrollbar-width gap).
  expect(near(pvCanvas, pvDiv)).toBe(true)
  // …and therefore the chart is the same width in edit and preview.
  expect(near(pvCanvas, irCanvas)).toBe(true)
})
