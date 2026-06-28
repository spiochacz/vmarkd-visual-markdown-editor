import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Graphviz (Viz.js) must (1) RENDER in the VS Code webview and (2) be PALETTE-PAIRED with the content
// theme: we inject palette colours as DOT graph/node/edge default statements so Graphviz colours the
// diagram semantically (node fill = surface, borders/edges = line, text = fg, transparent canvas) like
// mermaid — promoted from foreground-monochrome (task 94). themeGraphvizSvg still drops any white bg
// polygon. The fixture forces `vscode-dark-2026` (line/accent #48a0c7, fg #bbbebf, surface #232425) —
// the SVG must reference those, with no baked white background. Verified in the real webview because
// the worker + transparency behaviour does not reproduce in the harness.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const OUT = path.join(__dirname, '../../tmp/puml-theme/out')
const LINE = '#48a0c7' // vscode-dark-2026 line/accent (borders + edges)
const FG = '#bbbebf' // vscode-dark-2026 foreground (text)
const SURFACE = '#232425' // derived node fill (mix(bg,fg,0.1))

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('graphviz renders + is palette-paired with the content theme', async ({
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
  const svgLoc = frame
    .locator('.vditor-ir__preview .language-graphviz svg')
    .first()
  await svgLoc.waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  await svgLoc
    .screenshot({ path: path.join(OUT, 'gv_e2e_vscode-dark.png') })
    .catch(() => {})

  const info = await frame.locator('body').evaluate(() => {
    const svg = document.querySelector(
      '.vditor-ir__preview .language-graphviz svg',
    ) as SVGSVGElement
    const colours = new Set<string>()
    for (const el of Array.from(svg.querySelectorAll('[fill], [stroke]'))) {
      const f = (el.getAttribute('fill') ?? '').toLowerCase()
      const s = (el.getAttribute('stroke') ?? '').toLowerCase()
      if (f) colours.add(f)
      if (s) colours.add(s)
    }
    const text = svg.querySelector('text')
    return {
      colours: [...colours],
      whiteBg: [...colours].some((c) => c === '#ffffff' || c === 'white'),
      textFill: (text?.getAttribute('fill') ?? 'NO-TEXT').toLowerCase(),
      textComputedFill: text ? getComputedStyle(text).fill : 'NO-TEXT',
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[graphviz] ${JSON.stringify(info)}`)

  // (2a) Borders/edges use the themed line colour, node fills the surface tint → actually PAIRED.
  expect(info.colours).toContain(LINE)
  expect(info.colours).toContain(SURFACE)
  // (2b) Text is the themed foreground (not baked black).
  expect(info.textFill).toBe(FG)
  expect(info.textComputedFill).not.toBe('rgb(0, 0, 0)')
  // (2c) No baked white background survives.
  expect(info.whiteBg).toBe(false)
})
