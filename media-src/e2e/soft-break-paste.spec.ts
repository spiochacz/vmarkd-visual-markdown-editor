import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 83 regression — Vditor's undo.recordFirstPosition (run on the FIRST keydown of a freshly opened
 * document, incl. the Ctrl of Ctrl+V) inserts a <wbr> at the caret to snapshot it and strips it again
 * WITHOUT restoring the selection. A caret at offset 0 of a text node is left in the now-EMPTY pre-split
 * half. The soft-break observer ran next (microtask) and its selection carry resolved that empty node to
 * the END of the previous text, a different block, so the following paste / typed key landed there
 * (a list item's paste ended up outside the list). The edit must land where the caret was, with the
 * decorator on and off. The harness' undo stack is not in the "first keydown" state, so the snapshot is
 * driven directly (the same private method Vditor calls).
 */

const TIGHT =
  '# List\n\n1. Analysis of email threads\n   * first entry\n   * second entry\n'

async function load(page: Page, reflow: boolean, md: string) {
  await page.goto(
    `/list.html?mode=ir&reflow=${reflow ? 1 : 0}&md=${encodeURIComponent(md)}`,
  )
  await page.waitForFunction(() => (window as any).__ready === true)
}

async function recordFirstPosition(page: Page) {
  await page.evaluate(() => {
    const v = (window as any).vditor.vditor
    v.undo.addCaret(v)
  })
}

async function caretBeforeThenSnapshot(page: Page, needle: string) {
  await page.evaluate(
    ([needle]) => {
      const el = document.querySelector(
        '.vditor-ir > .vditor-reset',
      ) as HTMLElement
      el.focus()
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = (n as Text).data.indexOf(needle)
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.collapse(true)
        const s = getSelection()!
        s.removeAllRanges()
        s.addRange(r)
        break
      }
    },
    [needle],
  )
  await recordFirstPosition(page)
}

const value = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)

for (const reflow of [false, true]) {
  test(`paste of two paragraphs into a tight list item (reflow ${reflow})`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await load(page, reflow, TIGHT)
    await caretBeforeThenSnapshot(page, 'first entry')
    await page.evaluate(() =>
      navigator.clipboard.writeText('para one\n\npara two'),
    )
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(400)
    expect(await value(page)).toContain('para one\n\n   para two')
  })
}

for (const reflow of [false, true]) {
  test(`typing at the start of a list item after the first-keydown snapshot (reflow ${reflow})`, async ({
    page,
  }) => {
    await load(page, reflow, TIGHT)
    await caretBeforeThenSnapshot(page, 'first entry')
    await page.keyboard.type('Z')
    await page.waitForTimeout(300)
    expect(await value(page)).toContain('* Zfirst entry')
  })
}
