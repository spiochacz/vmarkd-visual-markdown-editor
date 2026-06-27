// D2 feature parity (task 124) in the REAL VS Code webview — the renderer path that the Playwright
// harness can't exercise (Vditor's .language-d2 + the real resource/CSP pipeline). Verifies the
// features that are SVG-structural (shape:text/code, connection styles + animation, shape:image,
// decorative icons, tooltip <title>) AND the one thing that is real-VS-Code-only: an SVG <a> link is
// intercepted by fixLinkClick on click (its href is an SVGAnimatedString — the bug fixed in utils.ts).
//
// Drives the section-18 D2 blocks in fixtures/all-renderers.md. Run: xvfb-run -a npm run test:vscode.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('D2 feature parity renders in the real VS Code webview', async ({
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
  // d2 compiles via WASM + lays out + renders SVG asynchronously — wait for at least one, then settle.
  await frame.locator('.language-d2 svg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 4000)))

  // Aggregate every rendered d2 SVG's markup; the section-18 blocks together exercise all features.
  const d2 = await frame.locator('body').evaluate(() => {
    const svgs = [...document.querySelectorAll('.language-d2 svg')]
    const html = svgs.map((s) => s.outerHTML).join('\n')
    return {
      svgCount: svgs.length,
      // shape:text / code (task 124 #2)
      hasTspan: /<tspan/.test(html),
      hasMonoFont: /font-family="ui-monospace/.test(html),
      // a STYLED text shape (|md| / text label + explicit fill) paints a box — real-d2 parity, not
      // borderless; regression: md-label nodes with a class fill were invisible on a dark theme.
      hasStyledTextBox: /fill="#2bd4a8"/.test(html),
      // connection styles (task 124 #1)
      hasRedStroke: /stroke="#e03131"/.test(html),
      hasDash: /stroke-dasharray=/.test(html),
      hasAnimClass: /class="d2-anim"/.test(html),
      hasAnimKeyframes: /@keyframes d2dash/.test(html),
      hasReducedMotion: /prefers-reduced-motion/.test(html),
      // shape:image + decorative icon (task 124 #3) — the fixture uses data: URIs
      imageCount: (html.match(/<image\b/g) || []).length,
      hasDataImg: /href="data:image\/svg\+xml/.test(html),
      // tooltip + link (task 124 #5)
      hasTooltip: /<title>The main API server<\/title>/.test(html),
      hasDbTooltip: /<title>Postgres 16<\/title>/.test(html),
      hasLinkAnchor: /<a[^>]*href="https:\/\/example\.com\/docs"/.test(html),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[d2-parity] ${JSON.stringify(d2, null, 2)}`)

  expect(d2.svgCount).toBeGreaterThan(0)
  // #2 text/code
  expect(d2.hasTspan).toBe(true)
  expect(d2.hasMonoFont).toBe(true)
  expect(d2.hasStyledTextBox).toBe(true)
  // #1 connection styles + accessible animation
  expect(d2.hasRedStroke).toBe(true)
  expect(d2.hasDash).toBe(true)
  expect(d2.hasAnimClass).toBe(true)
  expect(d2.hasAnimKeyframes).toBe(true)
  expect(d2.hasReducedMotion).toBe(true)
  // #3 image + icon
  expect(d2.imageCount).toBeGreaterThan(0)
  expect(d2.hasDataImg).toBe(true)
  // #5 tooltip + link
  expect(d2.hasTooltip).toBe(true)
  expect(d2.hasDbTooltip).toBe(true)
  expect(d2.hasLinkAnchor).toBe(true)

  // The real-VS-Code-only check: clicking the SVG <a> must be intercepted by fixLinkClick (it reads
  // the href off an SVGAnimatedString and preventDefaults so the panel never navigates). A plain click
  // always preventDefaults once the anchor+href is found, regardless of the edit/modifier policy.
  const click = await frame.locator('body').evaluate(() => {
    const a = document.querySelector(
      '.language-d2 svg a[href="https://example.com/docs"]',
    ) as SVGAElement | null
    if (!a) return { found: false, defaultPrevented: false }
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(ev)
    return { found: true, defaultPrevented: ev.defaultPrevented }
  })
  // eslint-disable-next-line no-console
  console.log(`[d2-parity] link click: ${JSON.stringify(click)}`)
  expect(click.found).toBe(true)
  expect(click.defaultPrevented).toBe(true) // fixLinkClick caught the SVG anchor (routed to host)
})
