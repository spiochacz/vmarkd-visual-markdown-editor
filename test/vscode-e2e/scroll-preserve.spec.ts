import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Scroll preservation IR → full Preview, in the REAL webview. This is where the harness lied: the
// preview's scroll container differs by environment — `.vditor-preview` (the wrapper) scrolls in
// the Playwright harness, but in the real VS Code webview it's `overflow:hidden` and the inner
// `.vditor-reset` is the scroller. preview-scroll-preserve.ts resolves it with `findScroller`; this
// test guards that the real scroller's position is kept (was: jumped to the top).

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
function webviewFrame(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Nearest scrollable ancestor (mirrors findScroller in toolbar-scroll-guard.ts).
const FIND_SCROLLER = `function findScroller(start){let el=start;while(el&&el!==document.body){const oy=getComputedStyle(el).overflowY;if((oy==='auto'||oy==='scroll'||oy==='overlay')&&el.scrollHeight>el.clientHeight+1)return el;el=el.parentElement;}return document.scrollingElement||document.documentElement;}`

test('IR scroll position is preserved when toggling to Preview', async ({
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

  // Scroll the IR editor to ~50%.
  const irFrac = await frame.locator('body').evaluate((_el, fs) => {
    new Function(`${fs}; window.__findScroller = findScroller`)()
    const reset = document.querySelector(
      '.vditor-ir .vditor-reset',
    ) as HTMLElement
    const sc = (window as any).__findScroller(reset) as HTMLElement
    sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * 0.5)
    return sc.scrollTop / (sc.scrollHeight - sc.clientHeight)
  }, FIND_SCROLLER)
  expect(irFrac).toBeGreaterThan(0.4)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 200)))

  // Toggle the full Preview overlay (same as the toolbar button) + let the pin settle.
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
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  // The REAL preview scroller (its inner reset here) must NOT be at the top — the position carried.
  const pvFrac = await frame.locator('body').evaluate((_el, fs) => {
    new Function(`${fs}; window.__findScroller = findScroller`)()
    const reset = document.querySelector(
      '.vditor-preview .vditor-reset',
    ) as HTMLElement
    const sc = (window as any).__findScroller(reset) as HTMLElement
    return sc.scrollTop / (sc.scrollHeight - sc.clientHeight)
  }, FIND_SCROLLER)
  // Heading-anchored mapping (IR & Preview have different total heights), so not exactly 0.5 —
  // but clearly preserved, not reset to the top.
  expect(pvFrac).toBeGreaterThan(0.3)
})
