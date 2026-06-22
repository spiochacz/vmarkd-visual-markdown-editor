import path from 'node:path'
import { test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('mermaid SVG marker probe', async ({ workbox, evaluateInVSCode }) => {
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
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const probe = await frame.locator('body').evaluate(() => {
    const svg = document.querySelector('.language-mermaid svg')!
    const all = [...svg.querySelectorAll('*')]

    // Find circles with text (the numbered markers)
    const circleGroups = all
      .filter((e) => e.querySelector('circle') && e.querySelector('text'))
      .map((e) => ({
        tag: e.tagName,
        class:
          (e as HTMLElement).className?.toString?.() || e.getAttribute('class'),
        id: e.id,
        html: (e as HTMLElement).outerHTML?.substring(0, 300),
      }))

    // Find anything with "access" in class/id
    const accessEls = all
      .filter((e) => {
        const cls =
          (e.className?.toString?.() || e.getAttribute('class') || '') +
          (e.id || '')
        return /access|a11y|aria|descr/i.test(cls)
      })
      .map((e) => ({
        tag: e.tagName,
        class:
          (e as HTMLElement).className?.toString?.() || e.getAttribute('class'),
        id: e.id,
      }))

    // Find all circles
    const circles = all
      .filter((e) => e.tagName === 'circle')
      .map((c) => ({
        r: c.getAttribute('r'),
        parentClass: c.parentElement?.getAttribute('class'),
        parentId: c.parentElement?.id,
      }))

    return {
      circleGroups,
      accessEls,
      circles,
      svgHTML: svg.outerHTML.substring(0, 5000),
    }
  })

  console.log('=== CIRCLE GROUPS ===')
  console.log(JSON.stringify(probe.circleGroups, null, 2))
  console.log('\n=== ACCESS ELEMENTS ===')
  console.log(JSON.stringify(probe.accessEls, null, 2))
  console.log('\n=== CIRCLES ===')
  console.log(JSON.stringify(probe.circles, null, 2))
  console.log('\n=== SVG HTML ===')
  console.log(probe.svgHTML)
})
