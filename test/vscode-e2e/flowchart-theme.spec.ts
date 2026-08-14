import { wf } from './webview-helpers'
// flowchart.js is paired with the content theme (task 91): Vditor renders it baked black (#000 lines/
// borders/text, #fff box fill) ignoring the theme — invisible on dark. The esbuild patch passes the
// themed colours + fill:none to drawSVG (flowchartDrawOptions), and reRenderFlowchart re-renders on
// a live theme flip.
//
// Task 376 split the two roles: lines and box borders take the palette's `muted`, labels keep `fg`
// — driving all three from one foreground made the diagram shout as loudly as the body text. This
// spec compared both against `getComputedStyle(el).color` and went red on that change; it now
// asserts the CONTRACT (readable on the theme, structure ink muted below the label ink, both
// repainted by a flip) rather than one palette value, so a re-tune of the palette cannot make it
// red while the diagram is fine. Real-VS-Code-only (flowchart.js SVG render).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Flips `theme.content` mid-test (github-dark → github-light) to observe the live re-render —
// can't be pinned.
useSettingsRestore(test, ['vmarkd.theme.content'])

test('flowchart follows the content theme foreground (open + live flip)', async ({
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
    .locator('.vditor-ir__preview .language-flowchart svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const el = document.querySelector(
        '.vditor-ir__preview .language-flowchart',
      ) as HTMLElement | null
      const svg = el?.querySelector('svg')
      const norm = (c: string | null) => (c || '').toLowerCase()
      return {
        fg: el ? getComputedStyle(el).color : '',
        rectStroke: norm(svg?.querySelector('rect')?.getAttribute('stroke')),
        rectFill: norm(svg?.querySelector('rect')?.getAttribute('fill')),
        textFill: norm(svg?.querySelector('text')?.getAttribute('fill')),
      }
    })

  // Relative luminance of a #rrggbb, so "readable on this theme" can be asserted as a DIRECTION
  // (light ink on the dark theme, dark ink on the light one) instead of an exact palette value —
  // the colours are the paired palette's and are free to be re-tuned; being invisible is the bug.
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/.exec(hex)
    if (!m) return Number.NaN
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = Number.parseInt(m[1].slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  const dark = await measure()
  // eslint-disable-next-line no-console
  console.log(`[github-dark] ${JSON.stringify(dark)}`)
  // Task 91: not the baked black that made it invisible; box interior transparent.
  expect(dark.rectStroke).not.toBe('#000000')
  expect(dark.textFill).not.toBe('#000000')
  expect(dark.rectFill).toBe('none')
  // Both inks are LIGHT on a dark theme — the actual "invisible on dark" contract.
  expect(
    lum(dark.rectStroke),
    'box border readable on a dark theme',
  ).toBeGreaterThan(0.2)
  expect(lum(dark.textFill), 'label readable on a dark theme').toBeGreaterThan(
    0.2,
  )
  // Task 376: structure ink and label ink are NOT the same colour any more. Lines and borders take
  // the palette's `muted`, labels keep `fg`; driving all three from one foreground made the diagram
  // shout as loudly as the body text. (This spec asserted stroke === computed color until 376.)
  expect(
    dark.rectStroke,
    'structure ink must be muted, distinct from the label ink (task 376)',
  ).not.toBe(dark.textFill)
  expect(
    lum(dark.rectStroke),
    'the muted structure ink sits below the label ink',
  ).toBeLessThan(lum(dark.textFill))

  // Live flip to a light content theme → the flowchart re-renders in the new palette.
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'github-light', true)
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const light = await measure()
  // eslint-disable-next-line no-console
  console.log(`[github-light] ${JSON.stringify(light)}`)
  // Both inks flipped to dark, and the two roles stay distinct.
  expect(
    lum(light.rectStroke),
    'box border readable on a light theme',
  ).toBeLessThan(0.5)
  expect(lum(light.textFill), 'label readable on a light theme').toBeLessThan(
    0.5,
  )
  expect(light.rectStroke).not.toBe(light.textFill)
  // …and the flip actually repainted (the whole point of reRenderFlowchart).
  expect(light.rectStroke).not.toBe(dark.rectStroke)
  expect(light.textFill).not.toBe(dark.textFill)
})
