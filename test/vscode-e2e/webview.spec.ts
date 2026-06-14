import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Smoke + geometry in the REAL VS Code webview. Opens the fixture in the vmarkd.editor custom
// editor and reaches the (double-nested) webview iframe to assert the editor booted and the
// collapsed code-block phantom-height fix holds where it actually matters (VS Code injects its
// own default CSS + runs the real pipeline — the thing the Playwright harness can't reproduce).
//
// ONE test, opened ONCE: reopening the custom editor per-test leaves stale webview frames, and
// `frameLocator('iframe.webview')` would then resolve a detached/hidden one. The numeric guard
// here mirrors blockbg.spec (which already proves it has teeth when the fix is reverted) — this
// is the REAL-ENVIRONMENT parity check, not the primary regression net.

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.md')

// VS Code custom-editor webview = outer `iframe.webview` → inner `iframe#active-frame`.
// (Selectors are stable across recent VS Code.)
function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('boots + collapsed code block == its rendered preview height (real webview)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    // Activate the extension BEFORE opening — otherwise `openWith` can race the custom-editor
    // provider registration on a cold VS Code (the webview then stalls until it eventually
    // re-resolves, or times out).
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = webviewFrame(workbox)
  // Wait for the LIVE Vditor IR structure — the code-block dual-node only exists once Vditor has
  // booted and replaced the static prerender overlay (whose `.vditor-reset` would otherwise match
  // and then detach mid-boot → a flake). This is the real "editor booted" signal.
  const codeNode = frame.locator('.vditor-ir__node[data-type="code-block"]')
  await expect(codeNode).toHaveCount(1, { timeout: 45_000 })
  await expect(frame.locator('blockquote[data-callout]')).toHaveCount(1)

  // let highlight.js settle, then measure the collapsed code block's phantom delta
  await expect(
    frame.locator('.vditor-ir__preview code.hljs').first(),
  ).toBeVisible({ timeout: 20_000 })
  const delta = await codeNode.first().evaluate((node) => {
    const pv = node.querySelector('.vditor-ir__preview') as HTMLElement
    return (
      node.getBoundingClientRect().height - pv.getBoundingClientRect().height
    )
  })
  // the dual-node ::before/::after + h:0 marker line boxes are collapsed → node == render
  expect(Math.abs(delta)).toBeLessThan(4)
})
