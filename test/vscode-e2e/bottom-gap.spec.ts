import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// End-of-file breathing room: the document must not end FLUSH against the bottom in the Preview
// pane. The content theme zeroes the last block's bottom margin (`> *:last-child`), so Preview
// glued the last block to the edge while IR kept a gap (its real last child is the collapsed
// trailing paragraph). main.css restores the gap in Preview; this checks both panes end with a
// comparable gap in the real webview.

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Visible gap below the last non-empty block when scrolled to the very bottom.
const GAP = `(sel => {
  const reset = document.querySelector(sel);
  if (!reset) return -1;
  reset.scrollTop = reset.scrollHeight;
  const kids = Array.from(reset.children).filter(el => el.getBoundingClientRect().height > 0.5);
  const last = kids[kids.length - 1];
  if (!last) return -1;
  return Math.round(reset.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
})`

test('the document ends with a gap in BOTH IR and Preview (last block not glued)', async ({
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

  const irGap = (await frame
    .locator('body')
    .evaluate(
      (_e, s) =>
        new Function('sel', `return (${s})(sel)`)('.vditor-ir .vditor-reset'),
      GAP,
    )) as number

  await frame.locator('body').evaluate(() => {
    const inst = (window as any).vditor
    const v = inst.vditor
    v.preview.element.style.display = 'block'
    v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
    v.preview.render(v)
  })
  await expect(frame.locator('.vditor-preview code.hljs').first()).toBeVisible({
    timeout: 20_000,
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))

  const pvGap = (await frame
    .locator('body')
    .evaluate(
      (_e, s) =>
        new Function('sel', `return (${s})(sel)`)(
          '.vditor-preview .vditor-reset',
        ),
      GAP,
    )) as number

  expect(irGap).toBeGreaterThan(18) // IR keeps the last block's rhythm + padding
  expect(pvGap).toBeGreaterThan(18) // Preview now does too (was ~10 = glued)
  expect(Math.abs(irGap - pvGap)).toBeLessThanOrEqual(6) // and they match
})
