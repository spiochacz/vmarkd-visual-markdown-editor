import { test, expect } from './coverage-fixture'

// e2e for the git-gutter DOM rendering (task 17). renderDiffMarkers reads the
// live block geometry of the active mode element, maps each block to its source
// lines, and appends an absolutely-positioned bar for blocks overlapping a
// change. clearDiffMarkers removes them. The bars are contenteditable=false and
// themed by type.
test('renderDiffMarkers adds a themed bar on the changed block and clears it', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)

  const result = await page.evaluate(async () => {
    const v = (window as any).vditor
    const dm = (window as any).__diffMarkers
    v.setValue('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n')
    await new Promise((r) => setTimeout(r, 100))

    // "Second paragraph." is source line 2 → mark it as added
    const changes = [{ startLine: 2, endLine: 3, type: 'added' }]
    const count = dm.renderDiffMarkers(v, changes)

    const bars = Array.from(
      document.querySelectorAll('.me-diff-marker')
    ) as HTMLElement[]
    const editor = v.vditor.ir.element as HTMLElement
    const info = bars.map((b) => ({
      cls: b.className,
      editable: b.getAttribute('contenteditable'),
      position: getComputedStyle(b).position,
      hasTop: b.style.top.endsWith('px'),
      inEditor: editor.contains(b),
    }))

    dm.clearDiffMarkers(editor)
    const afterClear = document.querySelectorAll('.me-diff-marker').length

    return { count, info, afterClear, editorPosition: getComputedStyle(editor).position }
  })

  expect(result.count).toBe(1)
  expect(result.info).toHaveLength(1)
  expect(result.info[0].cls).toContain('me-diff-marker--added')
  expect(result.info[0].editable).toBe('false')
  expect(result.info[0].position).toBe('absolute')
  expect(result.info[0].hasTop).toBe(true)
  expect(result.info[0].inEditor).toBe(true)
  expect(result.editorPosition).toBe('relative') // editor made a positioning context
  expect(result.afterClear).toBe(0)
})

test('renderDiffMarkers with no changes renders nothing and clears prior bars', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const result = await page.evaluate(async () => {
    const v = (window as any).vditor
    const dm = (window as any).__diffMarkers
    v.setValue('Alpha.\n\nBeta.\n')
    await new Promise((r) => setTimeout(r, 80))
    dm.renderDiffMarkers(v, [{ startLine: 0, endLine: 1, type: 'modified' }])
    const before = document.querySelectorAll('.me-diff-marker').length
    const count = dm.renderDiffMarkers(v, []) // empty → clears
    const after = document.querySelectorAll('.me-diff-marker').length
    return { before, count, after }
  })
  expect(result.before).toBeGreaterThanOrEqual(1)
  expect(result.count).toBe(0)
  expect(result.after).toBe(0)
})
