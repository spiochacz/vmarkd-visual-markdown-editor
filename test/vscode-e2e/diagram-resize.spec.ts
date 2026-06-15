// abc + mindmap responsiveness (shrink with a narrowing window).
//   abc: abcjs renders an svg with NO viewBox → CSS max-width shrinks the svg box but the notation
//        clips (doesn't scale). abc-fit.ts adds a viewBox from its width/height attrs so it scales.
//   mindmap: the IR-pane mindmap is a snapshot canvas with NO retrievable ECharts instance, so the
//        echarts resize() handler is a no-op. echarts-fit.ts reconstructs it from data-code at the
//        new size on window resize (reconstructMindmaps).
// Real-VS-Code-only → headless via `xvfb-run -a npx playwright test diagram-resize.spec`.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('abc content + mindmap shrink with the window (IR and WYSIWYG)', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // abc: a child path's on-screen width reflects whether the CONTENT scaled (not just the svg box).
  const abcPath = (pane: string) =>
    frame.locator('body').evaluate((_el, p) => {
      const path = document.querySelector(
        `${p} .language-abc svg path, ${p} .language-abc svg g`,
      )
      return path ? Math.round(path.getBoundingClientRect().width) : null
    }, pane)
  const mmCanvas = (pane: string) =>
    frame.locator('body').evaluate((_el, p) => {
      const c = document.querySelector(`${p} .language-mindmap canvas`)
      return c ? Math.round(c.getBoundingClientRect().width) : null
    }, pane)

  // ── IR: wide → narrow ──
  const irAbcWide = await abcPath('.vditor-ir__preview')
  const irMmWide = await mmCanvas('.vditor-ir__preview')
  await workbox.setViewportSize({ width: 700, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const irAbcNarrow = await abcPath('.vditor-ir__preview')
  const irMmNarrow = await mmCanvas('.vditor-ir__preview')
  // eslint-disable-next-line no-console
  console.log(
    `[IR] abc ${irAbcWide}->${irAbcNarrow}  mm ${irMmWide}->${irMmNarrow}`,
  )
  // abc notation scaled DOWN with the column (was clipped/static before the viewBox fix).
  expect(irAbcWide ?? 0).toBeGreaterThan(0)
  expect(irAbcNarrow ?? 999).toBeLessThan(irAbcWide ?? 0)
  // mindmap canvas shrank (reconstructed at the new width; resize() alone was a no-op).
  expect(irMmWide ?? 0).toBeGreaterThan(300)
  expect(irMmNarrow ?? 999).toBeLessThan(300)

  // ── WYSIWYG abc ──
  await workbox.setViewportSize({ width: 1400, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3500)))
  const wyAbcWide = await abcPath('.vditor-wysiwyg__preview')
  await workbox.setViewportSize({ width: 700, height: 900 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const wyAbcNarrow = await abcPath('.vditor-wysiwyg__preview')
  // eslint-disable-next-line no-console
  console.log(`[WY] abc ${wyAbcWide}->${wyAbcNarrow}`)
  expect(wyAbcWide ?? 0).toBeGreaterThan(0)
  expect(wyAbcNarrow ?? 999).toBeLessThan(wyAbcWide ?? 0)
})
