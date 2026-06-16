// flowchart.js is paired with the content theme (task 91): Vditor renders it baked black (#000 lines/
// borders/text, #fff box fill) ignoring the theme — invisible on dark. The esbuild patch passes the
// themed foreground (getComputedStyle(item).color) + fill:none to drawSVG, and reRenderFlowchart
// re-renders on a live theme flip. Assert the rendered stroke = the themed foreground (not #000) and
// that it tracks a flip. Real-VS-Code-only (flowchart.js SVG render) → `xvfb-run -a npx playwright
// test flowchart-theme.spec`.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('flowchart follows the content theme foreground (open + live flip)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'github-dark', true)
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
  await frame
    .locator('.vditor-ir__preview .language-flowchart svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const el = document.querySelector(
        '.vditor-ir__preview .language-flowchart',
      ) as HTMLElement | null
      const svg = el?.querySelector('svg')
      const norm = (c: string | null) => (c || '').toLowerCase()
      return {
        fg: el ? getComputedStyle(el).color : '',
        rectStroke: norm(svg?.querySelector('rect')?.getAttribute('stroke')),
        rectFill: norm(svg?.querySelector('rect')?.getAttribute('fill')),
        textFill: norm(svg?.querySelector('text')?.getAttribute('fill')),
      }
    })

  // rgb(r,g,b) → #rrggbb so we can compare the SVG hex attrs to the computed foreground.
  const toHex = (rgb: string) => {
    const m = rgb.match(/\d+/g)
    return m
      ? '#' +
          m
            .slice(0, 3)
            .map((n) => Number(n).toString(16).padStart(2, '0'))
            .join('')
      : rgb
  }

  const dark = await measure()
  // eslint-disable-next-line no-console
  console.log('[github-dark] ' + JSON.stringify(dark))
  // NOT baked black, and matches the (light) themed foreground; box interior transparent.
  expect(dark.rectStroke).not.toBe('#000000')
  expect(dark.rectStroke).toBe(toHex(dark.fg))
  expect(dark.textFill).toBe(toHex(dark.fg))
  expect(dark.rectFill).toBe('none')

  // Live flip to a light content theme → the flowchart re-renders in the new (dark) foreground.
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'github-light', true)
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const light = await measure()
  // eslint-disable-next-line no-console
  console.log('[github-light] ' + JSON.stringify(light))
  expect(light.rectStroke).toBe(toHex(light.fg))
  // the foreground actually changed (dark theme fg was light, light theme fg is dark)
  expect(light.rectStroke).not.toBe(dark.rectStroke)
})
