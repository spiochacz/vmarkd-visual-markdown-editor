import { stickySelection, wf } from './webview-helpers'
// NET (task 368) — arrowing down through a tall table must keep the caret on screen.
//
// Vditor's table-cell up/down navigation sets the selection directly (setSelectionFocus) and never
// scrolls, so the caret walks off-screen while the view stands still; caret-scroll.ts nudges the
// scroller on keyup to compensate.
//
// This lives in the REAL-VS-Code suite, not the Playwright harness, because the harness cannot
// express the precondition: nothing there constrains the editor's height, so `.vditor-reset` grows
// to fit its content and the page has NO scroller at all — measured `scrollHeight === clientHeight`
// on every ancestor up to <html>. With nothing scrollable, "the view did not move" is true no matter
// what the product does. The real webview constrains the pane, which is the situation the fix exists
// for.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'table-nav.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })

const FIND_SCROLLER = `function findScroller(el) {
  let n = el;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'overlay') && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}`

// Scroll position + whether the caret's cell is inside the scroller's viewport.
const STATE = `((fs) => {
  new Function(fs + '; window.__fs = findScroller')();
  const v = window.vditor
  const el = v.vditor[v.getCurrentMode()].element
  const sc = window.__fs(el)
  const sel = window.getSelection()
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  const node = range ? (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) : null
  const cell = node ? node.closest('td, th') : null
  const cr = cell ? cell.getBoundingClientRect() : null
  const sr = sc.getBoundingClientRect()
  return {
    scrollTop: Math.round(sc.scrollTop),
    canScroll: sc.scrollHeight > sc.clientHeight + 1,
    cellText: cell ? (cell.textContent || '').trim() : null,
    // The whole point: is the row the caret sits in actually on screen?
    caretVisible: cr ? cr.top >= sr.top - 1 && cr.bottom <= sr.bottom + 1 : null,
  }
})(${JSON.stringify(FIND_SCROLLER)})`

test('arrowing down a tall table keeps the caret on screen', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3_000)))

  // Focus the pane at page level — a DOM-level focus() inside the webview iframe loses the race
  // against workbox.keyboard, which dispatches to the top Electron window.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  // Put the caret in the first body cell.
  await stickySelection(
    frame,
    () => {
      const v = (window as any).vditor
      const el = v.vditor[v.getCurrentMode()].element as HTMLElement
      const cell = el.querySelector('td') as HTMLElement
      const r = document.createRange()
      r.selectNodeContents(cell)
      r.collapse(true)
      const s = window.getSelection() as Selection
      s.removeAllRanges()
      s.addRange(r)
    },
    null,
  )

  const before = (await frame.locator('body').evaluate(STATE)) as {
    scrollTop: number
    canScroll: boolean
    cellText: string | null
    caretVisible: boolean | null
  }
  // The precondition the harness could not provide. If this is false the test proves nothing.
  expect(
    before.canScroll,
    'the editor pane is not scrollable — nothing to keep on screen',
  ).toBe(true)
  expect(before.cellText).toBe('r0a')

  for (let i = 0; i < 40; i++) {
    await workbox.keyboard.press('ArrowDown')
    await workbox.waitForTimeout(20)
  }

  const after = (await frame.locator('body').evaluate(STATE)) as typeof before
  // The caret really did travel (otherwise a stationary view would be correct).
  expect(after.cellText, 'arrow-down did not move between cells').not.toBe(
    'r0a',
  )
  expect(
    after.scrollTop,
    'the view never followed the caret down the table',
  ).toBeGreaterThan(before.scrollTop)
  expect(after.caretVisible, 'the caret row ended up off screen').toBe(true)
})
