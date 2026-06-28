import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// PlantUML (offline TeaVM) must (1) RENDER an inline <svg> in the real VS Code webview and (2) be
// theme-agnostic: the baked default-skin foreground (#181818/#000000) becomes currentColor so it
// follows the theme, participant boxes flatten to a faint currentColor tint, and the transparent
// background rect is dropped. Task 141 (the render test) extended by task 144 item 2 (the colour
// assertion) — after the render+theme logic moved from the esbuild patch STRING into the typed
// media-src/src/plantuml-render.ts module. Real-webview-only: the TeaVM lazy-load + the resource
// pipeline don't reproduce in the Playwright harness.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('plantuml renders + is theme-agnostic (currentColor foreground, no baked bg)', async ({
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
  // (1) It RENDERS an <svg> (the TeaVM lazy-load + render) — this waitFor IS the render regression.
  await frame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .first()
    .waitFor({ timeout: 45_000 })
  // themePumlSvg runs on a MutationObserver after the async render — give it a beat.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const info = await frame.locator('body').evaluate(() => {
    const svg = document.querySelector(
      '.vditor-ir__preview .language-plantuml svg',
    ) as SVGSVGElement
    const rects = Array.from(svg.querySelectorAll('rect'))
    const text = svg.querySelector('text')
    return {
      // no baked foreground left anywhere (the #181818/#000000 skin ink)
      bakedForeground: Array.from(
        svg.querySelectorAll('[fill], [stroke]'),
      ).filter(
        (el) =>
          ['#181818', '#000000'].includes(el.getAttribute('fill') ?? '') ||
          ['#181818', '#000000'].includes(el.getAttribute('stroke') ?? ''),
      ).length,
      // a fully-transparent background rect must have been removed
      transparentBgRects: rects.filter(
        (r) => r.getAttribute('fill') === '#00000000',
      ).length,
      // at least one participant box flattened to the faint currentColor tint
      tintedBoxes: rects.filter(
        (r) =>
          r.getAttribute('fill') === 'currentColor' &&
          r.getAttribute('fill-opacity') === '0.06',
      ).length,
      textFillAttr: text?.getAttribute('fill') ?? 'NO-TEXT',
      textComputedFill: text ? getComputedStyle(text).fill : 'NO-TEXT',
      resetColor: getComputedStyle(
        document.querySelector('.vditor-ir .vditor-reset') as Element,
      ).color,
    }
  })

  // (2a) No baked skin foreground survives.
  expect(info.bakedForeground).toBe(0)
  // (2b) The transparent background rect was dropped.
  expect(info.transparentBgRects).toBe(0)
  // (2c) Participant boxes use the faint currentColor tint.
  expect(info.tintedBoxes).toBeGreaterThan(0)
  // (2d) Text foreground is currentColor → resolves to the theme foreground (NOT baked black).
  expect(info.textFillAttr).toBe('currentColor')
  expect(info.textComputedFill).toBe(info.resetColor)
  expect(info.textComputedFill).not.toBe('rgb(0, 0, 0)')
})
