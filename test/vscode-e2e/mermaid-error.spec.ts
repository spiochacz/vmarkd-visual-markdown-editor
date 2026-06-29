// Clean mermaid parse-error box (esbuild patchMermaidErrorRender) — real-VS-Code only.
//
// Vditor's mermaidRender.ts catch otherwise dumps mermaid's "bomb" error SVG + a raw, single-newline-
// mashed message (and crashes if the bomb element is null). We set `suppressErrorRendering: true` (no
// bomb; render() just throws) and render a compact themed `.vmarkd-mermaid-error` box whose <pre>
// preserves every newline. This asserts, in the real webview, that a broken mermaid block produces the
// box (not the bomb) — the error path runs through mermaid's real WASM-free render, not reproducible in
// the chromium harness with the host/CSP pipeline.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'mermaid-error.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('a broken mermaid block renders the themed error box, not the bomb SVG', async ({
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
  // mermaid lazy-loads, then the catch injects our box (shared .vmarkd-diagram-error class, task 178)
  await frame
    .locator('.language-mermaid .vmarkd-diagram-error')
    .first()
    .waitFor({ timeout: 60_000 })

  const info = await frame.locator('body').evaluate(() => {
    const box = document.querySelector(
      '.language-mermaid .vmarkd-diagram-error',
    )
    const title = box?.querySelector('.vmarkd-diagram-error__title')
    const msg = box?.querySelector('.vmarkd-diagram-error__msg')
    return {
      hasBox: !!box,
      title: title?.textContent ?? null,
      msgTag: msg?.tagName ?? null,
      msgLen: (msg?.textContent ?? '').trim().length,
      msgMultiline: (msg?.textContent ?? '').includes('\n'),
      // mermaid's suppressed bomb graphic — must be absent
      bomb: document.querySelectorAll(
        '.language-mermaid svg[aria-roledescription="error"], .language-mermaid .error-icon',
      ).length,
      anySvg: document.querySelectorAll('.language-mermaid svg').length,
      processed: document
        .querySelector('.language-mermaid')
        ?.getAttribute('data-processed'),
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[mermaid-error] ${JSON.stringify(info)}`)

  expect(info.hasBox).toBe(true)
  expect(info.title).toBe('Mermaid')
  expect(info.msgTag).toBe('PRE') // <pre> → newlines + caret diagram preserved
  expect(info.msgLen).toBeGreaterThan(0) // a real message, not empty
  expect(info.bomb).toBe(0) // mermaid's error graphic is suppressed
  expect(info.anySvg).toBe(0) // no diagram + no bomb svg — only the themed box
})
