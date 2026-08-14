import { wf } from './webview-helpers'
// D2 colour themes (vmarkd.diagram.d2.theme) — real-VS-Code only.
//
// Proves the two background contracts that only hold with the real config plumbing + the transparent
// webview body:
//   • editor-paired themes (vscode-*/github-*) paint NO page-background rect — they sit on the
//     transparent webview body so the diagram blends into the editor (like mermaid). The page-bg rect
//     is marked data-d2-page-bg in toSVG, so its ABSENCE is the deterministic signal.
//   • d2-* catalog themes DO bake a page-bg rect (so they look identical on any editor) — the contrast
//     case, asserted so a regression to "always paint a bg" can't slip through.
// Neither reproduces in the Playwright harness (no real config plumbing; D2 is test.fixme there).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Flips `diagram.d2.theme` across several catalog/editor-paired themes, and `theme.content` once
// more near the end, all mid-test — can't be pinned.
useSettingsRestore(test, ['vmarkd.diagram.d2.theme', 'vmarkd.theme.content'])

async function openWithTheme(
  evaluateInVSCode: (
    fn: (vscode: any, args: unknown) => unknown,
    args: unknown,
  ) => Promise<unknown>,
  theme: string,
) {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri, d2Theme] = args as [string, string]
      // collectConfigOptions reads the setting at open time → set it BEFORE openWith.
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.d2.theme', d2Theme, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE, theme] as [string, string],
  )
}

// Collect, across every rendered D2 SVG: did any paint a page-bg rect, and is any of them coloured
// (a hex stroke, i.e. not the monochrome currentColor)?
async function readD2(frame: ReturnType<typeof wf>) {
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  // Let the WASM compile + layout + render settle across all D2 blocks.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))
  return frame.locator('body').evaluate(() => {
    const svgs = [...document.querySelectorAll('.language-d2 svg')]
    const html = svgs.map((s) => s.outerHTML).join('\n')
    return {
      count: svgs.length,
      theme: (window as any).__vmarkdD2Theme,
      hasPageBg: svgs.some((s) => !!s.querySelector('[data-d2-page-bg]')),
      hasHexStroke: /stroke="#[0-9a-fA-F]{3,8}"/.test(html),
    }
  })
}

test('D2 themes preserve their background and colour contracts', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  for (const variant of [
    { theme: 'github-dark', pageBg: false },
    { theme: 'd2-original', pageBg: true },
  ]) {
    await openWithTheme(evaluateInVSCode, variant.theme)
    const info = await readD2(wf(workbox))
    expect.soft(info.theme, `${variant.theme}: selected`).toBe(variant.theme)
    expect.soft(info.count, `${variant.theme}: SVG count`).toBeGreaterThan(0)
    expect
      .soft(info.hasPageBg, `${variant.theme}: page background`)
      .toBe(variant.pageBg)
    expect.soft(info.hasHexStroke, `${variant.theme}: colour`).toBe(true)
  }
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await cfg.update('diagram.d2.theme', 'auto', true)
      await cfg.update('theme.content', 'github-dark', true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const auto = await readD2(wf(workbox))
  expect.soft(auto.theme, 'auto: selected').toBe('auto')
  expect.soft(auto.hasPageBg, 'auto: transparent').toBe(false)
  expect.soft(auto.hasHexStroke, 'auto: coloured').toBe(true)
})
