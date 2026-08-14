import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// Mermaid's C4 renderer bypasses themeVariables: relationship labels/lines/boundaries are emitted
// #444444 and EVERY in-box label #FFFFFF (2.0:1 on mermaid's own light-blue `component` fill). The
// post-render hook repaints box labels against their own box and the rest against the page.
// Real-webview net — the hook runs off Vditor's patched mermaidRender, not the harness path.
const FIXTURE = path.join(__dirname, 'fixtures', 'mermaid-c4-colors.md')

usePinnedSettings(test, { 'vmarkd.diagram.mermaid.theme': 'vscode-dark-2026' })

test('C4 boxes, labels and relationships are readable on a dark palette', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
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
  const c4 = frame.locator('.language-mermaid svg[aria-roledescription="c4"]')
  await c4.waitFor({ timeout: 60_000 })

  const colors = await frame.locator('body').evaluate(() => {
    const svg = document.querySelector(
      '.language-mermaid svg[aria-roledescription="c4"]',
    ) as SVGElement
    const label = (txt: string) =>
      [...svg.querySelectorAll('text')]
        .find((t) => t.textContent === txt)
        ?.getAttribute('fill')
    return {
      boxes: [...svg.querySelectorAll('g > rect[fill], g > path[fill]')]
        .map((el) => el.getAttribute('fill'))
        .filter((fill) => fill && fill !== 'none')
        .sort(),
      userInk: label('User'),
      dbInk: label('DB'),
      relation: label('Uses'),
      boundary: label('Boundary'),
      line: svg.querySelector('line')?.getAttribute('stroke'),
      arrow: svg.querySelector('marker path')?.getAttribute('fill'),
      // Anything mermaid drew and the hook missed still carries its hard-coded default —
      // this is what caught the curved (BiRel) relationship paths.
      leftovers: [...svg.querySelectorAll('*')].filter((el) =>
        ['#444444', '#444'].includes(
          (el.getAttribute('stroke') ?? '').toLowerCase(),
        ),
      ).length,
    }
  })

  expect(colors).toEqual({
    boxes: ['#062b50', '#083e70', '#0d537f', '#176a96', '#33383b'],
    userInk: '#ffffff',
    dbInk: '#ffffff',
    relation: '#bbbebf',
    boundary: '#bbbebf',
    line: '#48a0c7',
    arrow: '#48a0c7',
    leftovers: 0,
  })
})
