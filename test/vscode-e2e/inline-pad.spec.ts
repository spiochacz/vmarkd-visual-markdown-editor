import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// REAL-webview guard: inline-code h-padding must MATCH between IR and WYSIWYG. Vditor's
// index.css zeroes WYSIWYG inline-code h-padding (`0 !important`); build.mjs patchVditorIndexCss
// rewrites it to `var(--vmarkd-code-px, .4em)`. The editor now loads that SINGLE patched
// media/vditor/dist/index.css via a <link> (not a bundled-from-node_modules copy — ADR-0004),
// the same copy the harness loads, so editor and harness can't drift. This proves IR == WYSIWYG
// in the actual VS Code webview — the surface a bundled-vs-copied mismatch used to break silently.
const FIXTURE = path.join(__dirname, 'fixtures', 'inline.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('inline-code h-padding matches IR vs WYSIWYG (real webview)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('theme.content', 'vscode-dark-2026', true)
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = webviewFrame(workbox)
  const body = frame.locator('body')
  await body.locator('.vditor-reset code').first().waitFor({ timeout: 45_000 })
  await workbox.waitForTimeout(1500)

  const pad = () =>
    body.evaluate(() => {
      const code = (
        Array.from(document.querySelectorAll('code')) as HTMLElement[]
      )
        .filter((c) => !c.classList.contains('hljs'))
        .find((c) => (c.offsetWidth || 0) > 0)
      if (!code) return 'NO-INLINE-CODE'
      const cs = getComputedStyle(code)
      return `${cs.paddingLeft}/${cs.paddingRight}`
    })

  const ir = await pad()
  await body
    .locator('button[data-mode="wysiwyg"]')
    .evaluate((b) => (b as HTMLElement).click())
  await workbox.waitForTimeout(1500)
  const wys = await pad()

  expect(ir).toBe('3px/3px') // vscode-2026: VS Code's 1px 3px
  expect(wys).toBe(ir) // WYSIWYG must match IR (not Vditor's cached 0px)
})
