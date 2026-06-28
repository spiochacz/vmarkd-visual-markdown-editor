// PlantUML keep-last overlay must match the LIVE diagram size (no shrink-then-jump while editing) —
// real-VS-Code only.
//
// Bug: while typing, edit-activity.ts shows the cached render in a `.vmarkd-stale-overlay` div (task
// 161). The live plantuml svg carries `min-width:300px` (main.css) so small diagrams stretch to 300px,
// but the overlay svg only got `max-width:100%; height:auto` — so a small plantuml shrank under the
// overlay and JUMPED back to 300px when the real render swapped in. Fix: bridge per-engine sizing to the
// overlay via `data-lang` (NOT a `.language-X` class — observers key on that and must not re-process the
// overlay). This asserts the overlay svg renders at the SAME width as the live svg (with data-lang), and
// that WITHOUT the bridge it shrinks (the bug) — measured in the real webview where plantuml's TeaVM
// render + the min-width layout actually run.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-resize.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('plantuml keep-last overlay matches the live diagram width (no shrink/jump)', async ({
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
  await frame
    .locator('.language-plantuml svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  const info = await frame.locator('body').evaluate(() => {
    // `.language-plantuml` matches the editable SOURCE code first (no svg) — pick the RENDERED one by
    // finding the svg, then walking up to its wrapper + preview pane.
    const live = (document.querySelector(
      '.vditor-ir__preview .language-plantuml > svg',
    ) ?? document.querySelector('.language-plantuml svg')) as SVGElement | null
    const wrap = live?.closest('.language-plantuml') as HTMLElement | null
    const preview =
      (wrap?.closest('.vditor-ir__preview') as HTMLElement) ??
      (wrap?.parentElement as HTMLElement)
    if (!live || !preview) return { error: 'no rendered plantuml svg' }
    const liveW = live.getBoundingClientRect().width
    // Replicate restoreOverlay's DOM exactly (visualSnapshot caches the live svg outerHTML) and measure
    // the overlay svg width with vs without the data-lang bridge.
    const html = live.outerHTML
    const measure = (withLang: boolean): number => {
      const o = document.createElement('div')
      o.className = 'vmarkd-stale-overlay'
      o.setAttribute('data-render', '1')
      if (withLang) o.setAttribute('data-lang', 'plantuml')
      o.innerHTML = html
      preview.appendChild(o)
      const w = (o.querySelector('svg') as SVGElement).getBoundingClientRect()
        .width
      o.remove()
      return w
    }
    return { liveW, withLang: measure(true), without: measure(false) }
  })
  // eslint-disable-next-line no-console
  console.log(`[plantuml-overlay-size] ${JSON.stringify(info)}`)

  expect(info.error).toBeUndefined()
  // fixture sanity: the diagram is small enough that live `min-width:300px` engaged
  expect(info.liveW).toBeGreaterThanOrEqual(299)
  // the fix: overlay (with data-lang) renders at the SAME width as the live diagram (no jump)
  expect(Math.abs((info.withLang ?? 0) - (info.liveW ?? 0))).toBeLessThan(2)
  // control: WITHOUT the bridge the overlay shrinks below the live width (the reported bug)
  expect(info.without ?? 0).toBeLessThan((info.liveW ?? 0) - 5)
})
