import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// The maintained EOF trailing paragraph (gap-paragraph.ts `data-vmarkd-trailing`) must be INVISIBLE
// (zero height) until the caret is inside it, then expand — like the transient gap paragraphs
// between blocks. This is a CSS behaviour (collapse unless `.vmarkd-trailing--active`), so it's
// guarded in the REAL webview with the real theme; markTrailingActive's class toggle is unit-tested.

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('EOF trailing paragraph is hidden until the caret enters it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = webviewFrame(workbox)
  await expect(
    frame.locator('.vditor-ir__node[data-type="code-block"]').first(),
  ).toBeVisible({ timeout: 45_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  // (the fixture ends in a blockquote → an atomic last block → a maintained trailing paragraph)
  const idle = await frame.locator('body').evaluate(() => {
    const reset = document.querySelector(
      '.vditor-ir .vditor-reset',
    ) as HTMLElement
    const tp = reset.querySelector(
      ':scope > p[data-vmarkd-trailing]',
    ) as HTMLElement | null
    return tp ? Math.round(tp.getBoundingClientRect().height) : -1
  })
  expect(idle).toBe(0) // present in the DOM but collapsed (caret elsewhere)

  // Put the caret inside it (as ArrowDown-into-trailing does) → it reveals.
  const active = await frame.locator('body').evaluate(() => {
    const reset = document.querySelector(
      '.vditor-ir .vditor-reset',
    ) as HTMLElement
    const tp = reset.querySelector(
      ':scope > p[data-vmarkd-trailing]',
    ) as HTMLElement
    const r = document.createRange()
    r.selectNodeContents(tp)
    r.collapse(true)
    const sel = getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    document.dispatchEvent(new Event('selectionchange'))
    return new Promise<number>((res) =>
      setTimeout(() => res(Math.round(tp.getBoundingClientRect().height)), 150),
    )
  })
  expect(active).toBeGreaterThan(10) // expanded to a normal line once the caret is inside
})
