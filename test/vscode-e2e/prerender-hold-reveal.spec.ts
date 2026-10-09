// The instant-paint overlay is held `visibility:hidden` until every <head> stylesheet has loaded
// (html-builder.ts, "Hold-until-styled": VS Code's webview document.write()s the page, so the
// stylesheet links are NOT render-blocking there — measured). The chromium spec overlay-fouc.spec.ts
// proves no unstyled frame under slow CSS; this one proves the REVEAL works in the real webview
// (CSP nonce, link events): the hold <style> is gone and the overlay, held past boot by
// VMARKD_PRERENDER_PARITY_HOLD, is visible and styled — never stuck hidden.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.md')

test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})
test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('the held overlay is revealed, styled, once the stylesheets loaded', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('#app .vditor-ir').first().waitFor({ state: 'attached' })
  const state = await frame.locator('body').evaluate(() => {
    const o = document.getElementById('vmarkd-prerender') as HTMLElement
    const reset = getComputedStyle(
      o.querySelector('pre.vditor-reset') as Element,
    )
    return {
      hold: document.getElementById('vmarkd-prerender-hold') !== null,
      visibility: getComputedStyle(o).visibility,
      monospace: reset.fontFamily === 'monospace',
      paddingLeft: Number.parseFloat(reset.paddingLeft),
    }
  })
  expect(state.hold).toBe(false)
  expect(state.visibility).toBe('visible')
  expect(state.monospace).toBe(false)
  expect(state.paddingLeft).toBeGreaterThan(0)
})
