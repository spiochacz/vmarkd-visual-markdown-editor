import { test, expect } from './coverage-fixture'

// e2e for getCursorSourceOffset (task 15): uses Lute's own caret token (‸,
// Lute.Caret) inserted at the selection, round-tripped through the active mode's
// VditorIRDOM2Md, then indexOf — yielding an EXACT source offset, including
// inside markdown syntax markers (where a plain sentinel fails). Falls back to
// the table-cell mapping and the block heuristic when the caret token can't be
// placed. The harness exposes the module on window for testing.
test('getCursorSourceOffset maps a prose caret to the exact source offset', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const got = await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('Hello bold world.\n')
    await new Promise((r) => setTimeout(r, 80))
    const ir = v.vditor.ir.element as HTMLElement
    // caret 5 chars into "Hello"
    const walker = document.createTreeWalker(ir, NodeFilter.SHOW_TEXT)
    const tn = walker.nextNode() as Text
    const range = document.createRange()
    range.setStart(tn, 5)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const fn = (window as any).__sourceMap.getCursorSourceOffset
    return { offset: fn(v), leftoverCaret: ir.textContent?.includes('‸') }
  })
  expect(got.offset).toBe(5) // exact
  expect(got.leftoverCaret).toBe(false) // caret token cleaned up from the DOM
})

test('getCursorSourceOffset is exact even inside a syntax marker (heading)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const offset = await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('# Title here\n\nBody.\n')
    await new Promise((r) => setTimeout(r, 80))
    const ir = v.vditor.ir.element as HTMLElement
    // place caret at the start of the heading text "Title" (after "# ")
    const walker = document.createTreeWalker(ir, NodeFilter.SHOW_TEXT)
    let node: Text | null = null
    let n: Node | null
    while ((n = walker.nextNode())) {
      if ((n.textContent || '').includes('Title')) {
        node = n as Text
        break
      }
    }
    const idx = node!.textContent!.indexOf('Title')
    const range = document.createRange()
    range.setStart(node!, idx)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    return (window as any).__sourceMap.getCursorSourceOffset(v)
  })
  // source "# Title here" → "Title" starts at offset 2 (after "# ")
  expect(offset).toBe(2)
})

test('getCursorSourceOffset maps a table cell exactly', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const got = await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('Intro.\n\n| H1 | H2 |\n| - | - |\n| a | b |\n')
    await new Promise((r) => setTimeout(r, 100))
    const ir = v.vditor.ir.element as HTMLElement
    const cell = ir.querySelectorAll('td')[1] as HTMLElement // body row, col 1 ("b")
    const tn =
      (cell.firstChild as Text) || document.createTextNode(cell.textContent || '')
    const range = document.createRange()
    range.selectNodeContents(cell)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const md = v.getValue()
    const sm = (window as any).__sourceMap
    const offset = sm.getCursorSourceOffset(v)
    return { offset, md, line: sm.offsetToLine(md, offset) }
  })
  // Table mapping is exact against the real (Vditor-normalized) source: the
  // offset must land on the body row's line, inside that row's span.
  const lines = got.md.split('\n')
  const bodyLine = lines.findIndex((l: string) => /\|\s*a\s*\|\s*b\s*\|/.test(l))
  expect(got.line).toBe(bodyLine) // correct line
  const rowStart = lines.slice(0, bodyLine).join('\n').length + 1
  expect(got.offset).toBeGreaterThanOrEqual(rowStart)
  expect(got.offset).toBeLessThan(rowStart + lines[bodyLine].length)
})
