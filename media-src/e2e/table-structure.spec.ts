import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'
import type { TableAction } from '../src/editing/table-hotkey'

// C1 (tasks/516) — table structure editing via the REAL panel (fix-table-ir.ts's icon row,
// not the raw hotkey dispatch — though both converge on the same Vditor internals). Task 190's
// own matrix scored the existing coverage (table-hotkey.spec.ts) "dispatch pinned, md never
// asserted": those tests check STRUCTURAL COUNTS (column/row counts via a hand-rolled parser)
// after each action, never the exact SERIALIZED MARKDOWN — so a bug that shifts cell content
// into the wrong column, or corrupts the alignment row's colon placement, would pass every
// existing check. This file closes that gap: every op asserts the FULL exact markdown string,
// and a dedicated test proves undo actually restores the prior markdown.
//
// Seed table has DISTINGUISHABLE per-cell content (a1/b1/c1/a2/b2/c2, not generic placeholders)
// so a content-shifted-into-the-wrong-column bug is visible in a byte-diff, not just a count.
const SEED =
  '| A | B | C |\n| - | - | - |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n'
// Vditor's IR table serializer column-pads every cell to the widest content in its column
// (verified empirically against the real harness before writing these assertions — this is
// not a guess). The seed re-serializes with that padding even before any edit:
const SEED_SERIALIZED =
  '| A  | B  | C  |\n| -- | -- | -- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n'

async function gotoEditor(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function getValue(page: Page) {
  return page.evaluate(() => (window as any).vditorTest.getValue() as string)
}

async function setSeed(page: Page) {
  await page.evaluate((v) => (window as any).vditor.setValue(v), SEED)
  await page.waitForTimeout(150)
}

// Click the cell whose text is exactly `text` — gives every op the SAME cell context (a1)
// regardless of how many rows/columns exist, so intra-suite results are directly comparable.
async function clickCell(page: Page, text: string) {
  const cells = page.locator('.vditor-ir td')
  const n = await cells.count()
  for (let i = 0; i < n; i++) {
    if ((await cells.nth(i).textContent())?.trim() === text) {
      await cells.nth(i).click()
      return
    }
  }
  throw new Error(`cell "${text}" not found`)
}

// The REAL user path: reveal the collapsed panel, hover to expand it, click the icon — not
// the raw synthetic-keydown dispatch table-hotkey.spec.ts's first describe block uses.
async function clickPanelIcon(page: Page, action: TableAction) {
  await page.locator('#fix-table-ir-wrapper .vditor-panel').hover()
  await page
    .locator(`#fix-table-ir-wrapper .vditor-icon[data-type="${action}"]`)
    .click()
  await page.waitForTimeout(150)
}

// Exact expected markdown per action, from the seed, cell context = a1 (verified against the
// real harness while writing this file — see the header comment on column padding).
const EXPECTED: Record<TableAction, string> = {
  insertRowA:
    '| A  | B  | C  |\n| -- | -- | -- |\n|    |    |    |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n',
  insertRowB:
    '| A  | B  | C  |\n| -- | -- | -- |\n| a1 | b1 | c1 |\n|    |    |    |\n| a2 | b2 | c2 |\n',
  deleteRow: '| A  | B  | C  |\n| -- | -- | -- |\n| a2 | b2 | c2 |\n',
  insertColumnL:
    '|  | A  | B  | C  |\n| - | -- | -- | -- |\n|  | a1 | b1 | c1 |\n|  | a2 | b2 | c2 |\n',
  insertColumnR:
    '| A  |  | B  | C  |\n| -- | - | -- | -- |\n| a1 |  | b1 | c1 |\n| a2 |  | b2 | c2 |\n',
  deleteColumn: '| B  | C  |\n| -- | -- |\n| b1 | c1 |\n| b2 | c2 |\n',
  left: '| A  | B  | C  |\n| :- | -- | -- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n',
  center:
    '| A | B  | C  |\n| :-: | -- | -- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n',
  right:
    '|  A | B  | C  |\n| -: | -- | -- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n',
}

test.describe('table structure edits serialize the correct markdown (not just correct counts)', () => {
  for (const action of Object.keys(EXPECTED) as TableAction[]) {
    test(action, async ({ page }) => {
      await gotoEditor(page)
      await setSeed(page)
      expect(await getValue(page)).toBe(SEED_SERIALIZED)
      await clickCell(page, 'a1')
      await clickPanelIcon(page, action)
      // The FULL exact string — pipe structure, alignment markers, and every OTHER cell's
      // content still in its original column (nothing lost or shifted by the op).
      expect(await getValue(page)).toBe(EXPECTED[action])
    })
  }
})

// Undo: table mutations (insertRowAbove/insertColumn/deleteRow/… in node_modules/vditor/dist/
// index.js) call `execAfterRender(vditor)` at the end, same as ordinary typed input — which
// routes to IR's `process_processAfterRender` and DEBOUNCES a `vditor.undo.addToUndoStack` call
// (`vditor.options.undoDelay`, default 800ms). An EARLIER version of this test asserted the
// stack never grew and reported that as a finding — that was wrong: it measured immediately
// after the click, before the debounce had time to fire. Waiting past `undoDelay` (verified
// against the real harness before writing this) shows the entry lands correctly. Uses the same
// UNDO_DEBOUNCE_MS / direct-API-call pattern list-normalize.spec.ts established: a bare harness
// like this one doesn't wire vMarkd's own capture-phase Ctrl+Z listener (undo-keybind.ts), only
// Vditor's internals, so `vditor.undo.undo(vditor)` — the exact call that listener's
// `runVditorHistory` makes — is what a real Ctrl+Z resolves to here, not
// `page.keyboard.press('Control+z')` (which would test harness plumbing this module doesn't own).
const UNDO_DEBOUNCE_MS = 900 // > Vditor's default undoDelay (800ms)

function undoOnce(page: Page) {
  return page.evaluate(() => {
    const v = (window as any).vditorTest.vditor
    v.undo.undo(v)
  })
}

test('one undo step restores the markdown from before a table structure edit', async ({
  page,
}) => {
  await gotoEditor(page)
  await setSeed(page)
  await page.waitForTimeout(UNDO_DEBOUNCE_MS) // let setSeed's own snapshot settle first
  await clickCell(page, 'a1')

  await clickPanelIcon(page, 'insertRowA')
  const afterTableOp = await getValue(page)
  expect(afterTableOp).not.toBe(SEED_SERIALIZED) // the op actually changed the document
  await page.waitForTimeout(UNDO_DEBOUNCE_MS) // let the op's own snapshot settle before undoing

  await undoOnce(page)
  await page.waitForTimeout(200)
  expect(await getValue(page)).toBe(SEED_SERIALIZED) // back to exactly the pre-op markdown
})
