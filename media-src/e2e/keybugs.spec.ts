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
