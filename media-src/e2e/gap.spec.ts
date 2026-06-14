import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Self-cleaning gap paragraph (gap-paragraph.ts). Vditor splices an empty <p> when you arrow
// off a block toward an adjacent code block so you CAN type between them; pure navigation
// then used to leave that empty paragraph behind (a blank markdown line + visible gap). The
// observer reclaims it once the caret leaves it empty, but keeps it the moment you type.

async function open(page: Page) {
  await page.goto('/gap.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  // let highlight.js settle so the code block is in its final shape
  await page.waitForTimeout(250)
}

const placeInFirstBlockquote = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    const bq = el.querySelector('blockquote') as HTMLElement
    const r = document.createRange()
    r.selectNodeContents(bq)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })

const emptyGapCount = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    // the maintained trailing paragraph (data-vmarkd-trailing) is not a "gap"
    return Array.from(
      el.querySelectorAll(':scope > p:not([data-vmarkd-trailing])'),
    ).filter(
      (p) =>
        (p as HTMLElement).childElementCount === 0 &&
        (p.textContent || '').replace(/​/g, '').trim() === '',
    ).length
  })

test('arrowing into the gap gives an editable paragraph; arrowing through reclaims it (markdown unchanged)', async ({
  page,
}) => {
  await open(page)
  const before = await page.evaluate(() => (window as any).vditor.getValue())
  await placeInFirstBlockquote(page)
  // 1st ArrowDown: Vditor splices a gap paragraph and parks the caret in it (you can type).
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  expect(await emptyGapCount(page)).toBe(1)
  // 2nd ArrowDown: caret moves into the code block; the now-empty gap is reclaimed.
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect(await emptyGapCount(page)).toBe(0)
  expect(await page.evaluate(() => (window as any).vditor.getValue())).toBe(
    before,
  )
})

test('typing in the gap keeps the paragraph and its content', async ({
  page,
}) => {
  await open(page)
  await placeInFirstBlockquote(page)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  await page.keyboard.type('inserted between')
  await page.waitForTimeout(150)
  expect(
    await page.evaluate(() => (window as any).vditor.getValue()),
  ).toContain('inserted between')
  // it is NOT reclaimed once the caret leaves (it now holds content)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect(
    await page.evaluate(() => (window as any).vditor.getValue()),
  ).toContain('inserted between')
})

// ---- callouts (fixCalloutArrowNav patch): adjacent callouts + end-of-file --------------
// Caret at the END of a callout's editable content via the harness helper (expandMarker —
// what a real caret move calls — then the caret into the now-visible source).
const placeAtEndOfCallout = async (page: Page, marker: string) => {
  const expanded = await page.evaluate(
    (m) => (window as any).__placeEndOfCallout(m),
    marker,
  )
  expect(expanded).toBe(true)
  await page.waitForTimeout(150)
}

// The gap sits directly between the two callouts (not just "somewhere").
const gapBetweenCallouts = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    const bqs = el.querySelectorAll('blockquote[data-callout]')
    const next = bqs[0]?.nextElementSibling
    return (
      !!next &&
      next.tagName === 'P' &&
      (next.textContent || '').replace(/​/g, '').trim() === ''
    )
  })

test('arrowing between two adjacent callouts splices a reclaimable gap paragraph', async ({
  page,
}) => {
  await open(page)
  const before = await page.evaluate(() => (window as any).vditor.getValue())
  await placeAtEndOfCallout(page, 'alpha callout')
  // ArrowDown: the patched insertAfterBlock splices a gap paragraph between the callouts.
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  expect(await gapBetweenCallouts(page)).toBe(true)
  // Move back up into the callout without typing → the empty gap is reclaimed,
  // markdown byte-identical.
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(250)
  expect(await gapBetweenCallouts(page)).toBe(false)
  expect(await page.evaluate(() => (window as any).vditor.getValue())).toBe(
    before,
  )
})

test('typing between two adjacent callouts keeps the paragraph', async ({
  page,
}) => {
  await open(page)
  await placeAtEndOfCallout(page, 'alpha callout')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  await page.keyboard.type('between callouts')
  await page.waitForTimeout(150)
  const md = await page.evaluate(() => (window as any).vditor.getValue())
  expect(md).toContain('between callouts')
  // …between the two callouts, not inside either
  expect(md.indexOf('between callouts')).toBeGreaterThan(
    md.indexOf('alpha callout'),
  )
  expect(md.indexOf('between callouts')).toBeLessThan(
    md.indexOf('beta callout'),
  )
})

test('ArrowDown at end-of-file below a trailing callout gives a paragraph you can type in', async ({
  page,
}) => {
  await open(page)
  // 'beta callout' is the LAST block of the document.
  await placeAtEndOfCallout(page, 'beta callout')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  await page.keyboard.type('after the last callout')
  await page.waitForTimeout(150)
  const md = await page.evaluate(() => (window as any).vditor.getValue())
  // …as its OWN paragraph after the callout — not appended to the quote (`> …after`),
  // which is what happened pre-patch when the ArrowDown escape never fired.
  expect(md).toMatch(/\n\nafter the last callout/)
  expect(md).not.toMatch(/> .*after the last callout/)
})

// ---- callout-nav (setupCalloutArrowNav): arrows must ENTER collapsed callouts ----------
// A collapsed callout's source is display:none and its preview contenteditable=false, so
// native caret movement skipped callouts / dropped the selection (the "cursor jumps to the
// top" EOF bug). These drive KEYBOARD-ONLY journeys with the callouts collapsed, exactly
// like a user arrowing through the document.
const calloutState = (page: Page, marker: string) =>
  page.evaluate((m) => {
    const el = (window as any).__el() as HTMLElement
    const bq = Array.from(
      el.querySelectorAll<HTMLElement>('blockquote[data-callout]'),
    ).find((b) => (b.textContent || '').includes(m))
    if (!bq) return { expanded: false, caretInside: false }
    const sel = window.getSelection()
    const caretInside =
      !!sel?.rangeCount && bq.contains(sel.getRangeAt(0).startContainer)
    return {
      expanded: bq.classList.contains('vditor-ir__node--expand'),
      caretInside,
    }
  }, marker)

const pressDown = async (page: Page, times: number) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(180)
  }
}

test('keyboard-only: ArrowDown travels INTO collapsed callouts (expands them, markdown unchanged)', async ({
  page,
}) => {
  await open(page)
  const before = await page.evaluate(() => (window as any).vditor.getValue())
  // caret at the end of the plain 'quote below' blockquote (visible, placeable)
  await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    const bq = Array.from(el.querySelectorAll<HTMLElement>('blockquote')).find(
      (b) =>
        (b.textContent || '').includes('quote below') &&
        !b.hasAttribute('data-callout'),
    )!
    const w = document.createTreeWalker(bq, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.trim() !== '') last = n as Text
    }
    const r = document.createRange()
    r.setStart(last!, last!.data.length)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.waitForTimeout(150)
  // Down #1 splices the gap before alpha; Down #2 must ENTER (and expand) collapsed alpha.
  await pressDown(page, 2)
  let st = await calloutState(page, 'alpha callout')
  expect(st.expanded).toBe(true)
  expect(st.caretInside).toBe(true)
  // Walk through alpha (2 source lines), splice the alpha↔beta gap, then ENTER beta.
  await pressDown(page, 3)
  st = await calloutState(page, 'beta callout')
  expect(st.expanded).toBe(true)
  expect(st.caretInside).toBe(true)
  // Pure navigation end-to-end: every transient gap reclaimed, markdown byte-identical.
  expect(await page.evaluate(() => (window as any).vditor.getValue())).toBe(
    before,
  )
})

test('keyboard-only: ArrowUp enters the collapsed callout above', async ({
  page,
}) => {
  await open(page)
  // start INSIDE beta (the helper expands it — alpha above stays collapsed)
  await page.evaluate(() => (window as any).__placeEndOfCallout('beta callout'))
  await page.waitForTimeout(200)
  // Up to beta's first line (3 source lines), splice the gap, then ENTER collapsed alpha.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(180)
  }
  const st = await calloutState(page, 'alpha callout')
  expect(st.expanded).toBe(true)
  expect(st.caretInside).toBe(true)
})

test('entering happens on KEYDOWN — no transient skip past the callout', async ({
  page,
}) => {
  await open(page)
  // Caret at the end of the plain 'quote below' (the block right above alpha).
  await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    const below = Array.from(
      el.querySelectorAll<HTMLElement>('blockquote'),
    ).find(
      (b) =>
        (b.textContent || '').includes('quote below') &&
        !b.hasAttribute('data-callout'),
    )!
    const w = document.createTreeWalker(below, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.trim() !== '') last = n as Text
    }
    const r = document.createRange()
    r.setStart(last!, last!.data.length)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown') // Vditor splices the gap before alpha
  await page.waitForTimeout(200)
  // From the gap: hold the key DOWN and assert the caret is ALREADY inside alpha before
  // keyup — the first cut entered on keyup only, so the caret visibly skipped past the
  // callout and was pulled back on key release (worse under key-repeat).
  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(80)
  const st = await calloutState(page, 'alpha callout')
  await page.keyboard.up('ArrowDown')
  expect(st.expanded).toBe(true)
  expect(st.caretInside).toBe(true)
})

// ---- trailing-paragraph invariant (observeTrailingParagraph) ---------------------------
test('a document ending with a block ALWAYS offers a trailing paragraph (serializer-invisible)', async ({
  page,
}) => {
  await open(page)
  // present immediately after load, tagged, empty
  const state = await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    const last = el.lastElementChild as HTMLElement
    return {
      tag: last?.tagName,
      tagged: last?.hasAttribute('data-vmarkd-trailing'),
      empty: (last?.textContent || '').replace(/​/g, '').trim() === '',
      md: (window as any).vditor.getValue() as string,
    }
  })
  expect(state.tag).toBe('P')
  expect(state.tagged).toBe(true)
  expect(state.empty).toBe(true)
  // …and INVISIBLE to the markdown: no ZWSP, no extra trailing blank line
  expect(state.md.includes('​')).toBe(false)
  expect(state.md.endsWith('second line beta\n')).toBe(true)
  // typing in it makes it real content (own paragraph after the callout)
  await page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    const p = el.lastElementChild as HTMLElement
    const r = document.createRange()
    r.setStart(p.firstChild!, 1)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.keyboard.type('typed at eof')
  await page.waitForTimeout(150)
  const md = await page.evaluate(() => (window as any).vditor.getValue())
  expect(md).toMatch(/\n\ntyped at eof/)
})

test('a stale trailing paragraph is reclaimed when blocks get appended after it (streaming)', async ({
  page,
}) => {
  await open(page)
  const res = await page.evaluate(async () => {
    const el = (window as any).__el() as HTMLElement
    const stale = el.lastElementChild as HTMLElement // the tagged trailing p
    // streaming-like append AFTER the trailing paragraph
    stale.insertAdjacentHTML(
      'afterend',
      '<blockquote data-block="0"><p>[!NOTE]\nappended later</p></blockquote>',
    )
    await new Promise((r) => setTimeout(r, 250)) // observers settle (rAF debounced)
    const ps = el.querySelectorAll(':scope > p[data-vmarkd-trailing]')
    const last = el.lastElementChild as HTMLElement
    return {
      staleConnected: stale.isConnected,
      taggedCount: ps.length,
      lastIsTrailingP:
        last.tagName === 'P' && last.hasAttribute('data-vmarkd-trailing'),
    }
  })
  expect(res.staleConnected).toBe(false) // mid-document empty trailing p reclaimed
  expect(res.taggedCount).toBe(1) // exactly one, after the NEW last block
  expect(res.lastIsTrailingP).toBe(true)
})
