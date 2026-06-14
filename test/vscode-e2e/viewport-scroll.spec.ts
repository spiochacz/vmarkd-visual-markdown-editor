import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// The webview must have a SINGLE scroller: Vditor's bounded `.vditor-reset` (overflow:auto). The
// iframe viewport (html/body/#app) is clamped `overflow:hidden`, so a transient height/focus shift
// (e.g. caret in the last line + scroll) can't surface a SECOND (viewport) scrollbar beside the
// editor's own. This asserts: the viewport never overflows, AND the reset still scrolls all its
// content (clamp doesn't clip) — in BOTH narrow and full-width.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('viewport never shows a 2nd scrollbar; reset scrolls fully (narrow + full-width)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('editor.fullWidth', false, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = webviewFrame(workbox)
  await frame
    .locator('.vditor-ir__node[data-type="code-block"]')
    .first()
    .waitFor({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const measure = () =>
    frame.locator('body').evaluate(() => {
      const reset = document.querySelector(
        '.vditor-ir .vditor-reset',
      ) as HTMLElement
      reset.scrollTop = reset.scrollHeight
      const h = document.documentElement
      const b = document.body
      return {
        viewportOverflow: Math.max(
          h.scrollHeight - h.clientHeight,
          b.scrollHeight - b.clientHeight,
        ),
        resetScrollable: reset.scrollHeight - reset.clientHeight,
        reachedBottom: reset.scrollTop, // should equal resetScrollable if fully scrollable
      }
    })

  const narrow = await measure()
  // eslint-disable-next-line no-console
  console.log(`[vp] narrow=${JSON.stringify(narrow)}`)
  expect(narrow.viewportOverflow).toBe(0) // no second (viewport) scrollbar
  expect(narrow.resetScrollable).toBeGreaterThan(100) // doc is long → reset scrolls
  expect(Math.abs(narrow.reachedBottom - narrow.resetScrollable)).toBeLessThan(
    4,
  ) // not clipped

  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('editor.fullWidth', true, true)
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const full = await measure()
  // eslint-disable-next-line no-console
  console.log(`[vp] full=${JSON.stringify(full)}`)
  expect(full.viewportOverflow).toBe(0)
  expect(Math.abs(full.reachedBottom - full.resetScrollable)).toBeLessThan(4)
})
