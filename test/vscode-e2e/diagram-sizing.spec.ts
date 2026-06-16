// Remaining diagram-sizing guarantees from this session:
//   • mindmap canvas height = content (≈ leaf count), not the tall stock ~420px → no big vertical gaps.
//   • abc is capped at its NATURAL size on a WIDE column (not upscaled to fill it) — "max nie większy
//     niż wcześniej".
//   • the FULL Preview pane scales abc + graphviz too (the CSS scoping must match `.vditor-preview`,
//     whose nesting is `.vditor-preview > .vditor-reset`, the opposite of IR/WYSIWYG).
// Real-VS-Code-only → headless via `xvfb-run -a npx playwright test diagram-sizing.spec`.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('mindmap height fits content, abc capped at natural size, Preview pane scales abc/graphviz', async ({
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
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
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

  const m = await frame.locator('body').evaluate(() => {
    const pre = (sel: string) =>
      document.querySelector(`.vditor-wysiwyg__preview ${sel}`)
    const mmCanvas = pre('.language-mindmap canvas') as HTMLElement | null
    const abcSvg = pre('.language-abc svg') as SVGSVGElement | null
    const col = (
      document.querySelector('.vditor-wysiwyg__preview') as HTMLElement
    )?.clientWidth
    return {
      col,
      mmH: mmCanvas
        ? Math.round(mmCanvas.getBoundingClientRect().height)
        : null,
      abcW: abcSvg ? Math.round(abcSvg.getBoundingClientRect().width) : null,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[sizing] ${JSON.stringify(m)}`)
  // mindmap (3-leaf fixture → ~216px) must be short, NOT the ~420 stock canvas (no big gaps).
  expect(m.mmH ?? 999).toBeLessThan(320)
  // abc renders at its natural size (~455) — NOT upscaled to fill the column (would be ~col), NOT
  // clipped tiny. So it sits in a natural band well below the column width.
  expect(m.abcW ?? 0).toBeGreaterThan(360)
  expect(m.abcW ?? 9999).toBeLessThan((m.col ?? 0) * 0.92)

  // ── full Preview pane: abc + graphviz must scale (CSS scoped to .vditor-preview) ──
  await frame.locator('body').evaluate(() => {
    ;(
      document.querySelector(
        '.vditor-toolbar [data-type="preview"]',
      ) as HTMLElement | null
    )?.click()
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))
  const pw = (sel: string) =>
    frame.locator('body').evaluate((_el, s) => {
      const svg = document.querySelector(`.vditor-preview .language-${s} svg`)
      const cs = svg ? getComputedStyle(svg) : null
      return {
        w: svg ? Math.round(svg.getBoundingClientRect().width) : null,
        maxW: cs?.maxWidth ?? null,
      }
    }, sel)
  const pAbc = await pw('abc')
  const pGv = await pw('graphviz')
  // eslint-disable-next-line no-console
  console.log(`[preview] abc=${JSON.stringify(pAbc)} gv=${JSON.stringify(pGv)}`)
  // the CSS now applies in the Preview pane (was max-width:none before the scoping fix)
  expect(pAbc.maxW).toBe('100%')
  expect(pGv.maxW).toBe('100%')

  // narrow → both shrink to fit the preview column (no overflow/clip)
  await workbox.setViewportSize({ width: 700, height: 950 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const narrow = await frame.locator('body').evaluate(() => {
    const col = (document.querySelector('.vditor-preview') as HTMLElement)
      ?.clientWidth
    const w = (s: string) => {
      const svg = document.querySelector(`.vditor-preview .language-${s} svg`)
      return svg ? Math.round(svg.getBoundingClientRect().width) : null
    }
    return { col, abc: w('abc'), graphviz: w('graphviz') }
  })
  // eslint-disable-next-line no-console
  console.log(`[preview narrow] ${JSON.stringify(narrow)}`)
  expect(narrow.abc ?? 9999).toBeLessThanOrEqual((narrow.col ?? 0) + 1)
  expect(narrow.graphviz ?? 9999).toBeLessThanOrEqual((narrow.col ?? 0) + 1)
})
