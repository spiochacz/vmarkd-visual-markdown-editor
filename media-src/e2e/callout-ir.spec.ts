import { test, expect } from './coverage-fixture'

// Callout dual-node in a real Vditor IR (task 106 v2): the callout is tagged `vditor-ir__node` +
// gets an injected non-editable preview; Vditor's expandMarker toggles `--expand` on caret, and our
// CSS swaps source⇄preview. Caret outside → clean render; caret inside → raw source. The markdown
// round-trips off the editable source (Lute ignores the injected preview).

test.beforeEach(async ({ page }) => {
  await page.goto('/callout-ir.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // observeCallouts (rAF-debounced) injects the preview + tags the blockquote
  await page.waitForFunction(
    () =>
      !!(window as any)
        .__bq()
        ?.querySelector(':scope > .vmarkd-callout__preview'),
    undefined,
    { timeout: 10000 },
  )
})

test('the callout blockquote is tagged + has a non-editable preview', async ({
  page,
}) => {
  const info = await page.evaluate(() => {
    const bq = (window as any).__bq() as HTMLElement
    const pv = bq.querySelector(':scope > .vmarkd-callout__preview')
    return {
      node: bq.classList.contains('vditor-ir__node'),
      ce: pv?.getAttribute('contenteditable'),
      title: pv?.querySelector('.vmarkd-callout__title')?.textContent,
    }
  })
  expect(info.node).toBe(true)
  expect(info.ce).toBe('false')
  expect(info.title).toBe('Note')
})

test('caret outside → render shown, source hidden; caret inside → source shown, render hidden', async ({
  page,
}) => {
  // default: caret not in the callout → collapsed (render shown, source hidden)
  await page.evaluate(() => (window as any).__caretOutside())
  let vis = await page.evaluate(() => {
    const bq = (window as any).__bq() as HTMLElement
    const src = bq.querySelector(':scope > p')
    const pv = bq.querySelector(':scope > .vmarkd-callout__preview')
    const d = (el: Element | null) =>
      el ? getComputedStyle(el).display : 'missing'
    return { src: d(src), pv: d(pv) }
  })
  expect(vis.src).toBe('none') // source hidden
  expect(vis.pv).not.toBe('none') // render shown

  // caret inside → expanded (source shown, render hidden)
  await page.evaluate(() => (window as any).__caretInside())
  vis = await page.evaluate(() => {
    const bq = (window as any).__bq() as HTMLElement
    const src = bq.querySelector(':scope > p')
    const pv = bq.querySelector(':scope > .vmarkd-callout__preview')
    const d = (el: Element | null) =>
      el ? getComputedStyle(el).display : 'missing'
    return { src: d(src), pv: d(pv) }
  })
  expect(vis.src).not.toBe('none') // source shown for editing
  expect(vis.pv).toBe('none') // render hidden
})

test('the markdown round-trips (Lute ignores the injected preview)', async ({
  page,
}) => {
  const md = await page.evaluate(() => (window as any).__getValue())
  expect(md).toContain('> [!NOTE]')
  expect(md).toContain('body text of the note')
  // the rendered title text isn't duplicated into the source
  expect(md).not.toContain('vmarkd-callout')
})

// Size parity: entering a callout must NOT change its box (same line count, no margin
// asymmetry). The expanded source's last block used to keep the theme's 16px paragraph
// margin (the preview zeroes its own) and the preview title carried a 4px gap the
// one-paragraph source has no equivalent of — the callout visibly grew on caret-enter.
test('the callout keeps its exact size when the caret enters (collapse⇄expand)', async ({
  page,
}) => {
  const height = () =>
    page.evaluate(
      () =>
        Math.round((window as any).__bq().getBoundingClientRect().height * 10) /
        10,
    )
  const collapsed = await height()
  await page.evaluate(() => (window as any).__caretInside())
  await page.waitForTimeout(150)
  const expanded = await height()
  expect(Math.abs(expanded - collapsed)).toBeLessThanOrEqual(1)
  // and back out — no drift
  await page.evaluate(() => (window as any).__caretOutside())
  await page.waitForTimeout(150)
  expect(Math.abs((await height()) - collapsed)).toBeLessThanOrEqual(1)
})
