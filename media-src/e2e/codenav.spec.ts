import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Code-block arrow navigation. Arrowing DOWN past the END of a code block must land the caret in
// a paragraph AFTER the closing ``` (Vditor's natural splice) so you can start a new line there —
// BUT that landing is TRANSIENT: there is NO persistent empty paragraph after a code block (code
// is excluded from the trailing-paragraph invariant), and the landing is reclaimed once the caret
// moves on (cleanupGapParagraphs), so the markdown never keeps a stray blank line.
// Document: paragraph, code A (const a = 1), code B (const b = 2). B ends the file.

async function open(page: Page) {
  await page.goto('/codenav.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForTimeout(250) // let highlight.js settle
}

const getValue = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)

const placeAtEndOfCode = async (page: Page, needle: string) => {
  const ok = await page.evaluate(
    (n) => (window as any).__placeAtEndOfCode(n),
    needle,
  )
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

const emptyParagraphs = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    return Array.from(el.querySelectorAll(':scope > p')).filter(
      (p) =>
        (p as HTMLElement).childElementCount === 0 &&
        (p.textContent || '').replace(/​/g, '').trim() === '',
    ).length
  })

// is the caret currently inside a <p> that sits AFTER a code block?
const caretInParagraphAfterCode = (page: Page) =>
  page.evaluate(() => {
    const el = (window as any).__el() as HTMLElement
    const sel = window.getSelection()
    if (!sel?.rangeCount) return false
    let n: Node | null = sel.getRangeAt(0).startContainer
    while (n && n.parentElement !== el) n = n.parentElement
    const block = n as HTMLElement | null
    return (
      !!block &&
      block.tagName === 'P' &&
      block.previousElementSibling?.getAttribute('data-type') === 'code-block'
    )
  })

test('a document ending with a code block has NO trailing paragraph on load', async ({
  page,
}) => {
  await open(page)
  const trailing = await page.evaluate(
    () =>
      (window as any)
        .__el()
        .querySelectorAll(':scope > p[data-vmarkd-trailing]').length,
  )
  expect(trailing).toBe(0)
  expect(await emptyParagraphs(page)).toBe(0)
})

test('ArrowDown past the end of the last code block lands the caret in a paragraph AFTER the ```', async ({
  page,
}) => {
  await open(page)
  await placeAtEndOfCode(page, 'const b')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  // a landing paragraph now exists right after the code block, and the caret is in it
  expect(await caretInParagraphAfterCode(page)).toBe(true)
})

test('the transient landing is reclaimed when the caret moves back up (markdown stays clean)', async ({
  page,
}) => {
  await open(page)
  const before = await getValue(page)
  await placeAtEndOfCode(page, 'const b')
  await page.keyboard.press('ArrowDown') // splice the landing, caret in it
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowUp') // leave it empty → reclaimed
  await page.waitForTimeout(200)
  expect(await emptyParagraphs(page)).toBe(0)
  // no stray trailing blank line in the markdown
  expect(await getValue(page)).toBe(before)
})

test('typing in the landing keeps a paragraph AFTER the code block', async ({
  page,
}) => {
  await open(page)
  await placeAtEndOfCode(page, 'const b')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  await page.keyboard.type('after code')
  await page.waitForTimeout(200)
  const md = await getValue(page)
  expect(md).toContain('after code')
  // it's a separate block AFTER the code (the closing fence comes first)
  expect(md.indexOf('const b = 2')).toBeLessThan(md.indexOf('after code'))
  expect(md).toMatch(/const b = 2[\s\S]*```[\s\S]*after code/)
})
