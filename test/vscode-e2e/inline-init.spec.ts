// Task 38: the editor boots Vditor synchronously from an inlined `#vmark-init` JSON data island
// (non-wiki, non-huge docs) instead of the serial `ready→init` host roundtrip. Real-VS-Code-only —
// the inline payload + nonce + custom-editor resource pipeline only exist in the actual webview.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'inline-init.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('boots from the inlined #vmark-init payload', async ({
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
  // settle (the host also re-sends the no-op init echo)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const info = await frame.locator('body').evaluate(() => {
    const el = document.getElementById('vmark-init')
    let parsed: { type?: string; content?: string } | null = null
    try {
      parsed = el?.textContent ? JSON.parse(el.textContent) : null
    } catch {
      parsed = null
    }
    return {
      hasInit: !!el,
      scriptType: el?.getAttribute('type') ?? null,
      initType: parsed?.type ?? null,
      contentHasMarker:
        typeof parsed?.content === 'string' &&
        parsed.content.includes('INLINEINITMARKER42'),
      irText:
        (document.querySelector('.vditor-ir') as HTMLElement | null)
          ?.innerText ?? '',
    }
  })

  // the host inlined the payload (only happens for non-wiki, non-huge docs)
  expect(info.hasInit).toBe(true)
  expect(info.scriptType).toBe('application/json')
  expect(info.initType).toBe('init')
  expect(info.contentHasMarker).toBe(true)
  // …and the editor actually rendered that content
  expect(info.irText).toContain('INLINEINITMARKER42')
})
