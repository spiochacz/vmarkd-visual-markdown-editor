import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Regression: a custom-observer diagram (d2/wavedrom/nomnoml/geojson/topojson/vega/stl) must sit on the
// PAGE background, not a code-block panel. Vditor highlights these unknown-language blocks as code first
// (adds `.hljs` to the <code>); our findBlocks used to copy that class onto the rendered diagram <div>,
// so the highlight.js theme painted the code-panel bg behind the (often transparent) svg. findBlocks now
// strips `hljs` — assert no rendered diagram wrapper carries it and its background is transparent.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('rendered diagram wrappers sit on the page bg (no hljs panel)', async ({
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
    .evaluate(() => new Promise((r) => setTimeout(r, 6000)))

  const bad = await frame.locator('body').evaluate(() => {
    const transparent = (c: string) =>
      c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
    const offenders: { lang: string; bg: string; hljs: boolean }[] = []
    const wrappers = document.querySelectorAll(
      '.vditor-ir .vditor-ir__preview [class*="language-"]',
    )
    for (const w of Array.from(wrappers)) {
      const el = w as HTMLElement
      const lang = el.className.match(/language-([\w-]+)/)?.[1] ?? '?'
      // only the rendered diagram wrappers (hold an svg/canvas), not raw code/text previews
      if (!el.querySelector('svg, canvas')) continue
      const bg = getComputedStyle(el).backgroundColor
      const hljs = el.classList.contains('hljs')
      if (hljs || !transparent(bg)) offenders.push({ lang, bg, hljs })
    }
    return offenders
  })
  // eslint-disable-next-line no-console
  console.log(`[diagram-bg] offenders=${JSON.stringify(bad)}`)
  expect(
    bad,
    `diagram wrappers with a panel bg / hljs class: ${JSON.stringify(bad)}`,
  ).toEqual([])
})
