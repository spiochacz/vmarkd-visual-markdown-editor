// nomnoml is paired with the content theme (task 103) by SVG post-processing: themeNomnomlSvg recolors
// nomnoml's baked palette (dark text/stroke #33322e → currentColor; light node fill #eee8d5/#fdf6e3 →
// currentColor @ low opacity). This was previously UNASSERTED (the e2e only console.logged the colours).
// Lock it: on a dark theme NO baked nomnoml colour may survive, including in NESTED containers (depth 3
// in the fixture) — every fill/stroke must be currentColor / transparent / none.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

const BAKED = ['#33322e', '#eee8d5', '#fdf6e3'] // nomnoml's hard-coded defaults — must be recoloured

test('nomnoml follows the theme (no baked palette survives, incl. nested) on dark', async ({
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
  // the fixture has two nomnoml blocks (flat + nested); wait for the 2nd (nested)
  await frame
    .locator('.vditor-ir__preview .language-nomnoml svg')
    .nth(1)
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const info = await frame.locator('body').evaluate(() => {
    const svgs = [
      ...document.querySelectorAll('.vditor-ir__preview .language-nomnoml svg'),
    ] as SVGElement[]
    const scan = (svg: SVGElement) => {
      const colours = new Set<string>()
      for (const el of [...svg.querySelectorAll('*')] as SVGElement[]) {
        const f = el.getAttribute('fill')
        const s = el.getAttribute('stroke')
        if (f) colours.add(f.toLowerCase())
        if (s) colours.add(s.toLowerCase())
      }
      return [...colours]
    }
    return { count: svgs.length, flat: scan(svgs[0]), nested: scan(svgs[1]) }
  })
  // eslint-disable-next-line no-console
  console.log(`[nomnoml-theme] ${JSON.stringify(info)}`)

  expect(info.count).toBe(2)
  for (const colours of [info.flat, info.nested]) {
    // some currentColor must be present (the recolor ran), and NO baked nomnoml colour survives
    expect(colours).toContain('currentcolor')
    for (const baked of BAKED) expect(colours).not.toContain(baked)
  }
})
