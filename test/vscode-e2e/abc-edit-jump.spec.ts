// abc diagram jumps centre→left while editing (task 161 follow-up) — real-VS-Code only.
//
// While typing in a diagram's source, edit-activity.ts shows the last render in a `.vmarkd-stale-overlay`
// (restoreOverlay, data-lang=<engine>). That overlay was UNCONDITIONALLY `text-align:center`, but abc
// (and graphviz/mermaid/markmap) render LEFT-aligned (no `text-align:center` wrapper). So a narrow abc
// score showed CENTRED under the overlay while typing, then snapped LEFT when the fresh render swapped
// in — the user's "skacze na środek a potem do lewej". main.css now aligns the abc/graphviz/mermaid/
// markmap overlay LEFT to match their real layout. This asserts, in the real webview, that an abc
// overlay hugs the left while a centred engine's overlay stays centred.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('the typing overlay aligns abc LEFT (matches its render) — no centre→left jump', async ({
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
    .locator('.vditor-ir__preview .language-abc svg')
    .first()
    .waitFor({ timeout: 60_000 })

  const r = await frame.locator('body').evaluate(() => {
    // Build the overlay exactly like edit-activity.ts restoreOverlay (a .vmarkd-stale-overlay div with
    // a data-lang), holding a NARROW svg, inside a preview; measure the svg's left offset within it.
    // left-aligned → offset ≈ 0; centred → offset = (width − svgWidth)/2 ≫ 0.
    const probe = (lang: string) => {
      const preview = document
        .querySelector(`.vditor-ir__preview .language-${lang}`)
        ?.closest('.vditor-ir__preview') as HTMLElement | null
      if (!preview) return null
      const overlay = document.createElement('div')
      overlay.className = 'vmarkd-stale-overlay'
      overlay.setAttribute('data-render', '1')
      overlay.setAttribute('data-lang', lang)
      overlay.innerHTML =
        '<svg width="30" height="20" xmlns="http://www.w3.org/2000/svg"></svg>'
      preview.appendChild(overlay)
      const svg = overlay.querySelector('svg') as SVGElement
      const align = getComputedStyle(overlay).textAlign
      const offset =
        svg.getBoundingClientRect().left - overlay.getBoundingClientRect().left
      const width = overlay.getBoundingClientRect().width
      overlay.remove()
      return { align, offset, width }
    }
    return { abc: probe('abc'), flow: probe('flowchart') }
  })
  // eslint-disable-next-line no-console
  console.log(`[abc-jump] ${JSON.stringify(r)}`)

  expect(r.abc).not.toBeNull()
  // abc overlay is LEFT-aligned → the cached svg hugs the left edge (no centre shift while typing)
  expect(r.abc?.align).toBe('left')
  expect(r.abc?.offset ?? 999).toBeLessThan(8)
  // control: a centred engine's overlay stays centred (we didn't break the centred diagrams)
  if (r.flow && (r.flow.width ?? 0) > 80) {
    expect(r.flow.align).toBe('center')
    expect(r.flow.offset ?? 0).toBeGreaterThan(8)
  }
})
