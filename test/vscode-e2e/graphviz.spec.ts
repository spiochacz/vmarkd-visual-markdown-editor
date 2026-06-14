import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Graphviz (Viz.js) must (1) RENDER in the VS Code webview and (2) follow the content theme.
// The stock blob-worker importScripts of the cross-origin full.render.js hangs in the webview, so
// the block used to stay as raw DOT text ("źle renderuje"); patchGraphvizRender fetches the script
// and builds the worker from inlined code. And graphviz bakes a white background polygon + #000000
// foreground ("złe tło" on dark) — the patch removes the bg polygon (so the page background shows)
// and recolours #000000/black → currentColor (so text/edges follow the theme foreground). Verified
// in the real webview because the worker + transparency behaviour does not reproduce in the harness.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('graphviz renders + follows the content theme (no baked white bg)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'vscode-dark-2026', true)
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
  // (1) It RENDERS an <svg> (the worker fix) — this waitFor is itself the render regression.
  await frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const info = await frame.locator('body').evaluate(() => {
    const svg = document.querySelector(
      '.vditor-ir__preview .language-graphviz svg',
    ) as SVGSVGElement
    // The baked white background polygon (stroke transparent/none) must be gone.
    const bgPolys = Array.from(svg.querySelectorAll('polygon')).filter((p) => {
      const s = p.getAttribute('stroke')
      return s === 'transparent' || s === 'none'
    }).length
    const text = svg.querySelector('text')
    return {
      bgPolys,
      textFillAttr: text?.getAttribute('fill'),
      textComputedFill: text
        ? getComputedStyle(text as Element).fill
        : 'NO-TEXT',
      resetColor: getComputedStyle(
        document.querySelector('.vditor-ir .vditor-reset') as Element,
      ).color,
    }
  })

  // (2a) No baked white/background polygon remains.
  expect(info.bgPolys).toBe(0)
  // (2b) Foreground is currentColor → resolves to the theme foreground (NOT baked black).
  expect(info.textFillAttr).toBe('currentColor')
  expect(info.textComputedFill).toBe(info.resetColor)
  // On dark-2026 the foreground is light, definitely not black.
  expect(info.textComputedFill).not.toBe('rgb(0, 0, 0)')
})
