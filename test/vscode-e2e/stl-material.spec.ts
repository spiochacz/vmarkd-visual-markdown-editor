// STL 3D-model material colour — real-VS-Code regression guard for the "all-black cube on a light
// theme" bug. The model used to take its three.js material colour from the wrapper's computed
// foreground (currentColor); three.js lighting MULTIPLIES the base, so a near-black foreground (every
// light content theme, e.g. github-light) rendered a formless black blob. The fix is a fixed neutral
// mid-grey (STL_MATERIAL_COLOR in custom-diagrams.ts).
//
// This spec deliberately does NOT assert the WebGL render itself: many headless/CI hosts can't create
// a WebGL context (the canvas + the data-stl-material attribute are both written BEFORE the
// WebGLRenderer is constructed, so the attribute is present even where WebGL is unavailable). Asserting
// the recorded material colour proves the fix end-to-end without a flaky GPU dependency.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('STL model uses the fixed neutral material, not the theme foreground', async ({
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
  // The canvas is appended (and data-stl-material set) before three.js builds the WebGL renderer, so
  // it appears even on hosts without a WebGL context.
  await frame
    .locator('.language-stl canvas')
    .first()
    .waitFor({ timeout: 60_000 })

  const material = await frame.locator('body').evaluate(() => {
    const canvas = document.querySelector(
      '.language-stl canvas',
    ) as HTMLElement | null
    return canvas?.dataset.stlMaterial ?? ''
  })
  // eslint-disable-next-line no-console
  console.log(`[stl-material] data-stl-material=${material}`)

  // The neutral mid-grey from STL_MATERIAL_COLOR — and emphatically NOT a near-black theme foreground.
  expect(material).toBe('#9aa0a6')
})
