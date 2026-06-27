// D2 colour themes (vmarkd.theme.d2) — real-VS-Code only.
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

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

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
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.d2', d2Theme, true)
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

async function resetTheme(
  evaluateInVSCode: (
    fn: (vscode: any, args: unknown) => unknown,
    args: unknown,
  ) => Promise<unknown>,
) {
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.d2', undefined, true)
  }, [])
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

test('editor-paired theme (github-dark): coloured but NO baked page background', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await openWithTheme(evaluateInVSCode, 'github-dark')
  const info = await readD2(wf(workbox))
  // eslint-disable-next-line no-console
  console.log(`[d2-theme] github-dark: ${JSON.stringify(info)}`)
  expect(info.theme).toBe('github-dark')
  expect(info.count).toBeGreaterThan(0)
  expect(info.hasPageBg).toBe(false) // transparent — blends into the editor
  expect(info.hasHexStroke).toBe(true) // …yet still coloured (not monochrome)
  await resetTheme(evaluateInVSCode)
})

test('d2-catalog theme (d2-original) DOES bake a page background', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await openWithTheme(evaluateInVSCode, 'd2-original')
  const info = await readD2(wf(workbox))
  // eslint-disable-next-line no-console
  console.log(`[d2-theme] d2-original: ${JSON.stringify(info)}`)
  expect(info.theme).toBe('d2-original')
  expect(info.hasPageBg).toBe(true) // self-contained card — identical on any editor
  await resetTheme(evaluateInVSCode)
})

test('auto theme pairs to the content theme — coloured, transparent', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      // 'auto' D2 theme + a concrete content theme → D2 pairs to that content palette.
      await cfg.update('theme.d2', 'auto', true)
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
  const info = await readD2(wf(workbox))
  // eslint-disable-next-line no-console
  console.log(`[d2-theme] auto+github-dark: ${JSON.stringify(info)}`)
  expect(info.theme).toBe('auto')
  expect(info.hasPageBg).toBe(false) // transparent — blends into the editor
  expect(info.hasHexStroke).toBe(true) // …yet paired/coloured (not monochrome)
  await evaluateInVSCode(async (vscode) => {
    const cfg = vscode.workspace.getConfiguration('vmarkd')
    await cfg.update('theme.d2', undefined, true)
    await cfg.update('theme.content', undefined, true)
  }, [])
})
