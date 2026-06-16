// markmap fits its tree to the container only at create time → when the column narrows the svg
// element shrinks but the content clips (doesn't shrink). markmap-fit.ts re-fits every visible
// markmap instance (stashed on its svg by the esbuild patch) on a debounced window resize. This
// regresses BOTH IR and WYSIWYG (the user hit it in both). Real-VS-Code-only → headless via
// `xvfb-run -a npx playwright test markmap-resize.spec`.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('markmap content shrinks with the window in IR and WYSIWYG', async ({
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
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3500)))

  const info = (mode: string) =>
    frame.locator('body').evaluate((_el, m) => {
      const sel = `${m} .language-markmap svg`
      const svg = document.querySelector(sel) as SVGSVGElement | null
      const g = svg?.querySelector('g')
      return {
        svgW: svg ? Math.round(svg.getBoundingClientRect().width) : null,
        contentW: g ? Math.round(g.getBoundingClientRect().width) : null,
        hasViewBox: !!svg?.getAttribute('viewBox'),
      }
    }, mode)

  const irWide = await info('.vditor-ir__preview')
  // eslint-disable-next-line no-console
  console.log(`[IR wide] ${JSON.stringify(irWide)}`)
  await workbox.setViewportSize({ width: 700, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  const irNarrow = await info('.vditor-ir__preview')
  // eslint-disable-next-line no-console
  console.log(`[IR narrow] ${JSON.stringify(irNarrow)}`)
  // IR: the svg shrank, and the content re-fit INSIDE it (didn't stay clipped at its old size).
  expect(irWide.contentW ?? 0).toBeGreaterThan(300)
  expect(irNarrow.svgW ?? 999).toBeLessThan(300)
  expect(irNarrow.contentW ?? 999).toBeLessThanOrEqual((irNarrow.svgW ?? 0) + 8)

  await workbox.setViewportSize({ width: 1400, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3500)))
  const wyWide = await info('.vditor-wysiwyg__preview')
  // eslint-disable-next-line no-console
  console.log(`[WY wide] ${JSON.stringify(wyWide)}`)
  await workbox.setViewportSize({ width: 700, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  const wyNarrow = await info('.vditor-wysiwyg__preview')
  // eslint-disable-next-line no-console
  console.log(`[WY narrow] ${JSON.stringify(wyNarrow)}`)
  // WYSIWYG: same — content fits the (now narrow) svg, not clipped/overflowing at its old size.
  expect(wyNarrow.svgW ?? 999).toBeLessThan(300)
  expect(wyNarrow.contentW ?? 999).toBeLessThanOrEqual((wyNarrow.svgW ?? 0) + 8)
})
