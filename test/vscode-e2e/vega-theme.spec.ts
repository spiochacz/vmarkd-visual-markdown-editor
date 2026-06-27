// Vega / Vega-Lite is paired with the content theme (task 102): vega-embed bakes the axis/label/
// legend/title colours from getComputedStyle(wrapper).color at render time. On a LIVE theme flip the
// content-theme <link> applies asynchronously and can settle LATE, so the previous fixed-delay
// re-render baked a STALE colour — the axis numbers/ticks kept the old theme's colour until the file
// was reopened (user report). reThemeVega() now POLLS the foreground and re-renders when it actually
// changes. Assert the axis text colour tracks a live flip. Real-VS-Code-only (vega SVG render).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('vega axis colour follows the content theme on a live flip', async ({
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
    .locator('.vditor-ir__preview .language-vega-lite svg text')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  // The fill on a vega axis/title <text> = config.axis.labelColor / title.color = the themed
  // foreground. Read the first <text> that carries a fill, plus the wrapper's computed colour.
  const measure = () =>
    frame.locator('body').evaluate(() => {
      const el = document.querySelector(
        '.vditor-ir__preview .language-vega-lite',
      ) as HTMLElement | null
      const svg = el?.querySelector('svg')
      const texts = svg ? [...svg.querySelectorAll('text')] : []
      const fillOf = (t: SVGElement) =>
        (t.getAttribute('fill') || getComputedStyle(t).fill || '').toLowerCase()
      const fills = texts.map(fillOf).filter((f) => f && f !== 'none')
      return {
        fg: el ? getComputedStyle(el).color : '',
        textCount: texts.length,
        firstFill: fills[0] || '',
      }
    })

  // rgb(r,g,b) → #rrggbb so a vega fill (which may be rgb() or hex) compares to the computed fg.
  const toHex = (c: string) => {
    if (c.startsWith('#')) return c
    const m = c.match(/\d+/g)
    return m
      ? '#' +
          m
            .slice(0, 3)
            .map((n) => Number(n).toString(16).padStart(2, '0'))
            .join('')
      : c
  }

  const dark = await measure()
  // eslint-disable-next-line no-console
  console.log(`[vega github-dark] ${JSON.stringify(dark)}`)
  expect(dark.textCount).toBeGreaterThan(0)
  expect(dark.firstFill).not.toBe('')
  // On a dark theme the axis text is the (light) foreground — matches the wrapper's computed colour.
  expect(toHex(dark.firstFill)).toBe(toHex(dark.fg))

  // Live flip to a light content theme → reThemeVega re-renders vega in the new (dark) foreground.
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
  console.log(`[vega github-light] ${JSON.stringify(light)}`)
  expect(toHex(light.firstFill)).toBe(toHex(light.fg))
  // The core regression guard: the axis colour actually CHANGED on the live flip (it used to stay the
  // old theme's colour until reopen).
  expect(toHex(light.firstFill)).not.toBe(toHex(dark.firstFill))
})
