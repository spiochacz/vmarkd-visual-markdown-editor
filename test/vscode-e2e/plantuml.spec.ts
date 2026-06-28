import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// PlantUML (offline TeaVM) must (1) RENDER an inline <svg> in the real VS Code webview and (2) be
// PALETTE-PAIRED with the content theme: we inject a modern `<style>` block built from the active
// diagram palette so PlantUML colours the diagram semantically (element fill = surface, lines/
// borders = line, text = fg, notes = accent) like mermaid — no baked default-skin colour survives and
// the transparent background rect is dropped. Promoted from foreground-monochrome (task 87/144) to
// full pairing. The fixture forces `vscode-dark-2026`, whose palette is fg #bbbebf + line/accent
// #48a0c7 — the SVG must reference those. Real-webview-only: the TeaVM lazy-load + the resource
// pipeline don't reproduce in the Playwright harness.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const TINT = '#48a0c7' // vscode-dark-2026 line/accent — the "is it actually paired?" signal
const FG = '#bbbebf' // vscode-dark-2026 foreground (themed text fill)

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('plantuml renders + is palette-paired with the content theme', async ({
  workbox,
  evaluateInVSCode,
}, testInfo) => {
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
  const svgLoc = frame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .first()
  await svgLoc.waitFor({ timeout: 45_000 })
  // themePumlSvg runs on a MutationObserver after the async render — give it a beat.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // Screenshot the rendered diagram for visual eval (scratch under tmp/, gitignored).
  await svgLoc
    .screenshot({
      path: path.join(
        __dirname,
        '../../tmp/puml-theme/out/e2e_vscode-dark.png',
      ),
    })
    .catch(() => {})

  const info = await frame.locator('body').evaluate(
    (_el, expected) => {
      const { tint, fg } = expected as { tint: string; fg: string }
      const svg = document.querySelector(
        '.vditor-ir__preview .language-plantuml svg',
      ) as SVGSVGElement
      const all = Array.from(svg.querySelectorAll('[fill], [stroke]'))
      const colours = new Set<string>()
      for (const el of all) {
        const f = (el.getAttribute('fill') ?? '').toLowerCase()
        const s = (el.getAttribute('stroke') ?? '').toLowerCase()
        if (f) colours.add(f)
        if (s) colours.add(s)
      }
      const text = svg.querySelector('text')
      return {
        // no baked default-skin colour left anywhere (the #181818/#E2E2F0/#000000 ink/box defaults)
        bakedDefaults: all.filter((el) =>
          ['#181818', '#e2e2f0', '#000000'].some(
            (c) =>
              (el.getAttribute('fill') ?? '').toLowerCase() === c ||
              (el.getAttribute('stroke') ?? '').toLowerCase() === c,
          ),
        ).length,
        transparentBgRects: Array.from(svg.querySelectorAll('rect')).filter(
          (r) => r.getAttribute('fill') === '#00000000',
        ).length,
        usesTint: colours.has(tint.toLowerCase()), // paired line/accent present
        textFill: (text?.getAttribute('fill') ?? 'NO-TEXT').toLowerCase(),
        textIsThemedFg: (text?.getAttribute('fill') ?? '').toLowerCase() === fg,
        textComputedFill: text ? getComputedStyle(text).fill : 'NO-TEXT',
        distinctColours: colours.size,
      }
    },
    { tint: TINT, fg: FG },
  )

  // eslint-disable-next-line no-console
  console.log(`[plantuml] ${JSON.stringify(info)}`)
  testInfo.annotations.push({
    type: 'plantuml-colours',
    description: JSON.stringify(info),
  })

  // (2a) No baked default-skin colour survives — the <style> themed everything.
  expect(info.bakedDefaults).toBe(0)
  // (2b) The transparent background rect was dropped (page bg shows through).
  expect(info.transparentBgRects).toBe(0)
  // (2c) The diagram references the content theme's line/accent colour → it's actually PAIRED,
  //      not generic monochrome.
  expect(info.usesTint).toBe(true)
  // (2d) Text is painted the themed foreground (not currentColor, not baked black).
  expect(info.textIsThemedFg).toBe(true)
  expect(info.textComputedFill).not.toBe('rgb(0, 0, 0)')
  // (2e) More than a single ink colour → a real palette (fg + line + surface + accent…), not mono.
  expect(info.distinctColours).toBeGreaterThan(2)
})
