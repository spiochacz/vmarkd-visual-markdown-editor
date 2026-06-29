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

// Task 179 — typing inside a callout used to blank the text + eject the caret. Each keystroke runs
// SpinVditorIRDOM (rebuilds the blockquote, dropping `--expand`) → observeCallouts re-decorated it
// SYNCHRONOUSLY, collapsing the dual-node before Vditor re-expanded it: the source went display:none
// (typed text "disappeared") and the caret fell out. The fix drives expand/collapse off the live
// selection + skips the preview rebuild for the callout being typed in. This types REAL keystrokes.
test('typing inside the callout keeps the text + the caret inside (no eject, no blank)', async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__focusBodyEnd())
  await page.keyboard.type(' EDITED', { delay: 30 })
  await page.waitForTimeout(250)

  const st = await page.evaluate(() => (window as any).__state())
  expect(st.srcText).toContain('body text of the note EDITED') // the text persisted…
  expect(st.caretInCallout).toBe(true) // …the caret did NOT get ejected…
  expect(st.srcVisible).toBe(true) // …the source stayed visible (not collapsed to display:none)…
  expect(st.expanded).toBe(true) // …the dual-node stayed expanded while editing…
  expect(st.editing).toBe(true) // …and is flagged as being edited.
  expect(st.value).toContain('> body text of the note EDITED') // round-trips through Lute
})

test('leaving the callout after editing re-syncs the preview to the final source', async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__focusBodyEnd())
  await page.keyboard.type(' AFTER-LEAVE', { delay: 30 })
  await page.waitForTimeout(200)
  // move the caret OUT (trailing paragraph) → the callout collapses + its preview rebuilds
  await page.evaluate(() => (window as any).__caretOutside())
  await page.waitForTimeout(250)

  const r = await page.evaluate(() => {
    const bq = (window as any).__bq() as HTMLElement
    const preview = bq.querySelector(
      ':scope > .vmarkd-callout__preview',
    ) as HTMLElement | null
    return {
      expanded: bq.classList.contains('vditor-ir__node--expand'),
      editing: bq.hasAttribute('data-callout-editing'),
      previewText: preview?.textContent ?? null,
    }
  })
  expect(r.expanded).toBe(false) // collapsed after leaving
  expect(r.editing).toBe(false) // editing flag cleared
  expect(r.previewText).toContain('body text of the note AFTER-LEAVE') // preview shows the edit
})
