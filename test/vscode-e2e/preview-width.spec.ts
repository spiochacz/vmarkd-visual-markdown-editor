import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Edit↔Preview width parity (narrow / data-full-width="0"): the Preview content column must equal
// the EDIT content column. The editor keeps a 35px gutter floor (`max(35px, (100%-800)/2)`); the
// Preview must keep the SAME gutter so toggling Edit→Preview does not reflow everything wider
// ("w preview echarts robi się trochę szerszy"). The ECharts chart container therefore has the same
// width in both panes. (The painted canvas can sit ~scrollbar-width short of its container — an
// echarts init-measure quirk — but it is NEVER wider than edit, which was the reported problem; we
// deliberately do NOT force-resize it, as that flickered the IR source text behind the canvas.)
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

  // eslint-disable-next-line no-console
  console.log(
    `[width] irPara=${irPara} irCanvas=${irCanvas} pvPara=${pvPara} pvDiv=${pvDiv}`,
  )

  const near = (a: number, b: number) => Math.abs(a - b) <= 2
  // Gutter preserved → the content column is the same width in edit and preview.
  expect(near(pvPara, irPara)).toBe(true)
  // …so the chart's CONTAINER is the same width edit↔preview (it is never WIDER than edit, which
  // was the bug). The painted canvas may sit a scrollbar-width short — that's fine, not wider.
  expect(near(pvDiv, irCanvas)).toBe(true)
  expect(pvDiv).toBeLessThanOrEqual(irCanvas + 2)
})
