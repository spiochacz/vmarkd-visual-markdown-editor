import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// Task-65 keydown-bug repros, run against our build (vditor@3.11.2 + pinned master
// Lute). VERDICT: neither reproduces — the heading survives Enter-at-start, and a
// Backspace over a selection spanning a soft line break deletes exactly the selection
// (content stays valid). These were fixed upstream / targeted an older fork base. Kept
// as GUARDS so a future Vditor/Lute change can't silently regress them.
async function goto(page: Page, mode: 'ir' | 'wysiwyg') {
  await page.goto(`/keybugs.html?mode=${mode}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

// #5 (Ficus 908accc) — Enter at the very start of a heading must NOT mis-parse it.
test('🟢 #5: Enter at the start of an H1 keeps the heading intact (wysiwyg)', async ({
  page,
}) => {
  await goto(page, 'wysiwyg')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('# Heading one')
    await new Promise((r) => setTimeout(r, 50))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const tn = (el.querySelector('h1') as HTMLElement).firstChild as Node
    const r = document.createRange()
    r.setStart(tn, 0)
    r.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
  })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  const after = await page.evaluate(() => (window as any).vditor.getValue())
  // Heading text + marker survive (no corruption / mis-parse into a paragraph).
  expect(after).toContain('# Heading one')
})

// #1 (WizTeam 8cd9864d) — Backspace over a selection that spans a soft line break must
// delete exactly the selection, leaving valid content (no scramble, break consumed).
test('🟢 #1: Backspace over a cross-soft-break selection deletes cleanly (ir)', async ({
  page,
}) => {
  await goto(page, 'ir')
  const before = await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('line one\nline two trailing')
    await new Promise((r) => setTimeout(r, 50))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let target: Text | null = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data.includes('one')) {
        target = node as Text
        break
      }
    }
    if (!target) return null
    // select chars 6..15 of "line one\nline two trailing" = "ne\nline t" (spans the \n)
    const r = document.createRange()
    r.setStart(target, 6)
    r.setEnd(target, 15)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    return v.getValue()
  })
  expect(before).toBe('line one\nline two trailing\n')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(50)
  const after = await page.evaluate(() => (window as any).vditor.getValue())
  // Correct deletion of "ne\nline t": "line o" + "wo trailing". Valid, soft break gone,
  // nothing scrambled. (A regression here would no longer equal this.)
  expect(after).toBe('line owo trailing\n')
})

// ── Task-65 batch: the remaining fork-hunt candidates, verified against our build
// (vditor@3.11.2 + pinned Lute). NONE reproduce — they were fixed upstream / targeted an
// older fork base — so these are GUARDS asserting the correct behavior, kept so a future
// Vditor/Lute bump can't silently regress them. (#1/#5 above; #1476 in the backend
// fidelity suite.)

// #2 (WizTeam 299880c4) — Enter inside a code block must keep typing INSIDE the block
// (the reported bug jumped the cursor out to the wrong position).
test('🟢 #2: Enter in a code block keeps the cursor inside the block (ir)', async ({
  page,
}) => {
  await goto(page, 'ir')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('```js\nconst a = 1\n```')
    await new Promise((r) => setTimeout(r, 60))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('const a')) {
        t = n as Text
        break
      }
    }
    const r = document.createRange()
    r.setStart(t!, t!.data.length)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('const b = 2')
  await page.waitForTimeout(50)
  const value = await page.evaluate(() => (window as any).vditor.getValue())
  // The new text stays within the fences (cursor didn't jump out into a new paragraph).
  expect(value).toContain('const b = 2\n```')
  expect(value.startsWith('```js')).toBe(true)
})

// #3 (WizTeam 8f217158) — after Select-All, an arrow key must collapse the selection
// (the reported bug trapped Ctrl+A so you couldn't deselect). Our key layer only binds
// undo/redo, so there's no trap.
test('🟢 #3: Select-all then ArrowRight collapses the selection (ir)', async ({
  page,
}) => {
  await goto(page, 'ir')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('line one\nline two\nline three')
    await new Promise((r) => setTimeout(r, 60))
    ;(window as any).__modeEl().focus()
  })
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(30)
  const selected = await page.evaluate(
    () => window.getSelection()!.toString().length,
  )
  expect(selected).toBeGreaterThan(10) // everything is selected
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(30)
  const collapsed = await page.evaluate(
    () => window.getSelection()!.getRangeAt(0).collapsed,
  )
  expect(collapsed).toBe(true) // deselected
})

// #4 (WizTeam 2d9c7b2a) — clicking elsewhere must collapse an expanded inline marker
// (the reported bug left the markers expanded).
test('🟢 #4: clicking elsewhere collapses an expanded inline marker (ir)', async ({
  page,
}) => {
  await goto(page, 'ir')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('text **bold** here\n\nsecond paragraph here')
    await new Promise((r) => setTimeout(r, 60))
    ;(window as any).__modeEl().focus()
  })
  const expanded = await page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    const strong = el.querySelector('[data-type="strong"] strong')!
      .firstChild as Text
    const r = document.createRange()
    r.setStart(strong, 1)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return el.querySelectorAll('.vditor-ir__node--expand').length
  })
  expect(expanded).toBe(1) // marker expanded while the caret is inside it
  const collapsed = await page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('second')) {
        t = n as Text
        break
      }
    }
    const r = document.createRange()
    r.setStart(t!, 2)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return el.querySelectorAll('.vditor-ir__node--expand').length
  })
  expect(collapsed).toBe(0) // collapsed after the caret moved away
})

// #6 (Ficus 03f5ac4/197a88f) — Backspace at the start of the paragraph after a
// front-matter block must NOT throw (the unguarded querySelter at ir/processKeydown.ts
// is only reached for code/math blocks, which always have the marker code child;
// front-matter is data-type "yaml-front-matter", outside that branch).
test('🟢 #6: Backspace after a front-matter block does not throw (ir)', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  await goto(page, 'ir')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('---\ntitle: hi\n---\n\npara after')
    await new Promise((r) => setTimeout(r, 60))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('para after')) {
        t = n as Text
        break
      }
    }
    const r = document.createRange()
    r.setStart(t!, 0)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(50)
  expect(errors).toEqual([])
})

// #7 (Ficus 37230dc) — a toolbar-inserted inline code in WYSIWYG round-trips correctly
// and self-heals its data-marker on the next input (the reported bug broke later editing
// because the inserted <code> lacked data-marker).
test('🟢 #7: toolbar inline-code round-trips + self-heals data-marker (wysiwyg)', async ({
  page,
}) => {
  await page.goto('/keybugs.html?mode=wysiwyg&toolbar=1')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('hello world')
    await new Promise((r) => setTimeout(r, 60))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('world')) {
        t = n as Text
        break
      }
    }
    const idx = t!.data.indexOf('world')
    const r = document.createRange()
    r.setStart(t!, idx)
    r.setEnd(t!, idx + 5)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.click('.vditor-toolbar button[data-type="inline-code"]')
  await page.waitForTimeout(80)
  const value = await page.evaluate(() => (window as any).vditor.getValue())
  expect(value).toBe('hello `world`\n') // backticks present despite the missing marker
})

// #1912 — setValue rebuilds the DOM and would drop the caret to the top. Our external
// update path wraps it in preserveCaretAndScroll, which re-derives the caret at the same
// text offset. After an external update the caret must stay where the user was editing.
test('🟢 #1912: caret survives an external setValue (ir)', async ({ page }) => {
  await goto(page, 'ir')
  const res = await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('alpha\n\nbeta\n\ngamma')
    await new Promise((r) => setTimeout(r, 60))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('gamma')) {
        t = n as Text
        break
      }
    }
    const r = document.createRange()
    r.setStart(t!, 3) // caret after "gam"
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
    // an external update arrives mid-edit (production wraps setValue this way)
    ;(window as any).__preserveCaretAndScroll(() =>
      v.setValue('alpha\n\nbeta\n\ngamma!'),
    )
    await new Promise((r) => setTimeout(r, 30))
    const rng = window.getSelection()!.getRangeAt(0)
    const c = rng.startContainer
    return {
      text: c.nodeType === 3 ? (c as Text).data : (c as HTMLElement).tagName,
      offset: rng.startOffset,
    }
  })
  expect(res.text).toBe('gamma!') // caret stayed in the same word (not reset to the top)
  expect(res.offset).toBe(3)
})

// #1925 — 🔴 KNOWN BUG (parked): Enter in a blockquote nested inside a list item escapes
// BOTH the quote and the list — the typed text lands in a new list item instead of
// continuing the quote. The fix is high-risk surgery on Vditor's core Enter/list handler
// with no upstream reference and a rare trigger (no data loss), so it's parked. This
// tripwire asserts the CURRENT (buggy) output; when a future Vditor/Lute bump fixes it,
// the assertion flips and we turn it into a correctness test. See task 72.
test('🔴 #1925: Enter in a list+blockquote escapes to a new list item (ir, known bug)', async ({
  page,
}) => {
  await goto(page, 'ir')
  await page.evaluate(async () => {
    const v = (window as any).vditor
    v.setValue('- item one\n- > quoted text')
    await new Promise((r) => setTimeout(r, 60))
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let t: Text | null = null
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n as Text).data.includes('quoted')) {
        t = n as Text
        break
      }
    }
    const r = document.createRange()
    r.setStart(t!, t!.data.length)
    r.collapse(true)
    const s = window.getSelection()!
    s.removeAllRanges()
    s.addRange(r)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('more quote')
  await page.waitForTimeout(50)
  const value = await page.evaluate(() => (window as any).vditor.getValue())
  // BUG: "more quote" escapes to a new list item instead of continuing the quote.
  // When fixed it should be a quote continuation (e.g. "  > more quote") and NOT this.
  expect(value).toContain('- more quote')
})
