// WaveDrom is paired with the content theme (task 101). Its wave LINES/dashes/hatch get their colour
// from CLASSES in an embedded <style> skin (stroke/fill/color:#000), not inline attrs — so they stayed
// BLACK and were invisible on a dark theme (user report: "wavedrom na ciemnym tle ma czarne waves").
// themeWavedromSvg now rewrites the skin CSS (black → currentColor, white fill → transparent). Assert
// the embedded skin no longer hard-codes black and that a wave path resolves to the themed foreground.
// Real-VS-Code-only (WaveDrom SVG render).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('wavedrom wave lines follow the theme foreground (not baked black) on dark', async ({
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
  await frame
    .locator('.vditor-ir__preview .language-wavedrom svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const info = await frame.locator('body').evaluate(() => {
    const el = document.querySelector(
      '.vditor-ir__preview .language-wavedrom',
    ) as HTMLElement | null
    const svg = el?.querySelector('svg')
    const styleText = svg
      ? [...svg.querySelectorAll('style')].map((s) => s.textContent).join('\n')
      : ''
    // .s1/.s2 are the signal wave lines; grab the first one and read its RESOLVED stroke colour.
    const wave = svg?.querySelector('.s1, .s2') as SVGElement | null
    return {
      fg: el ? getComputedStyle(el).color : '',
      // After the rewrite the skin must NOT hard-code black on stroke/fill/color any more.
      styleHasBlackStroke:
        /(stroke|fill|color)\s*:\s*(#0{3}(?:0{3})?|black)\b/i.test(styleText),
      foundWave: !!wave,
      waveStroke: wave ? getComputedStyle(wave).stroke : '',
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[wavedrom github-dark] ${JSON.stringify(info)}`)

  expect(info.foundWave).toBe(true)
  // The skin no longer bakes black anywhere (every #000/black → currentColor).
  expect(info.styleHasBlackStroke).toBe(false)
  // The wave line resolves to the themed foreground (a light colour on dark) — NOT black.
  expect(info.waveStroke).not.toBe('')
  expect(info.waveStroke).toBe(info.fg)
  expect(info.waveStroke).not.toMatch(/rgb\(0, 0, 0\)|#000/)
})
