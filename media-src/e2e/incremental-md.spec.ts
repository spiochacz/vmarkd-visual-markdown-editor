import { expect, test } from './coverage-fixture'

/**
 * E2e for the task-69 incremental IR serializer. Drives a REAL Vditor (IR) with real
 * keystrokes — so the DOM is produced by Vditor's own SpinVditorIRDOM, the path the
 * Node spike could not exercise — and after each edit asserts the incremental markdown
 * is byte-identical to the authoritative full `editor.getValue()` (VditorIRDOM2Md).
 */

async function gotoHarness(page: any) {
  await page.addInitScript(() => {
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/incremental-md.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

// Click into the IR editor near a piece of text so the caret lands in a real block.
async function clickInEditor(page: any, contains: string) {
  const handle = await page.evaluateHandle((text: string) => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let n: Node | null
    // biome-ignore lint/suspicious/noAssignInExpressions: tree-walk loop
    while ((n = walker.nextNode())) {
      if (n.textContent?.includes(text)) return n.parentElement
    }
    return el
  }, contains)
  const box = await handle.asElement()!.boundingBox()
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
}

async function expectConsistent(page: any) {
  const r = await page.evaluate(() => (window as any).__incrementalVsFull())
  expect(r.incr, `incremental != full\n--- incr ---\n${r.incr}\n--- full ---\n${r.full}`).toBe(r.full)
}

test('incremental markdown stays byte-identical to getValue across real edits', async ({
  page,
}) => {
  await gotoHarness(page)

  // baseline: cache must match the initial document
  await expectConsistent(page)

  // 1) in-block text edit (type into the intro paragraph)
  await clickInEditor(page, 'Intro paragraph')
  await page.keyboard.type(' EDITED')
  await expectConsistent(page)

  // 2) edit a list item
  await clickInEditor(page, 'two')
  await page.keyboard.type(' X')
  await expectConsistent(page)

  // 3) edit a table cell
  await clickInEditor(page, '2')
  await page.keyboard.type('9')
  await expectConsistent(page)

  // 4) structural: Enter to split the closing paragraph into two blocks
  await clickInEditor(page, 'Closing paragraph')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('A brand new paragraph.')
  await expectConsistent(page)

  // 5) structural: a fresh paragraph at the very end, then Backspace-merge it back
  await page.keyboard.press('Enter')
  await page.keyboard.type('temp line')
  await expectConsistent(page)
  for (const _ of 'temp line') await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace') // merge into the previous block
  await expectConsistent(page)
})

test('rebaselines correctly after the cache is invalidated', async ({ page }) => {
  await gotoHarness(page)
  await clickInEditor(page, 'Intro paragraph')
  await page.keyboard.type(' one')
  await expectConsistent(page)
  // Simulate a wholesale DOM rebuild (setValue/streaming) → invalidate, then edit again.
  await page.evaluate(() => (window as any).__invalidate())
  await page.keyboard.type(' two')
  await expectConsistent(page)
})
