import { test, expect, Page } from '@playwright/test'
import type { TableAction } from '../src/table-hotkey'

const SEED = '| a | b |\n| - | - |\n| 1 | 2 |\n'

async function gotoEditor(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function getValue(page: Page) {
  return page.evaluate(() => (window as any).vditorTest.getValue() as string)
}

// place the caret in the first data cell so a table hotkey has cell context
async function selectFirstCell(page: Page) {
  await page.locator('.vditor-ir td').first().click()
  await page.waitForTimeout(100)
}

type Parsed = { cols: number; bodyRows: number; separator: string }
function parseTable(md: string): Parsed {
  const lines = md
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
  const cols = (lines[0]?.match(/\|/g)?.length ?? 1) - 1
  return { cols, bodyRows: Math.max(0, lines.length - 2), separator: lines[1] ?? '' }
}

// expected effect of each action relative to the seed table
const CHECKS: Record<TableAction, (before: Parsed, after: Parsed) => void> = {
  left: (_b, a) => expect(a.separator).toMatch(/:-(?!:)/),
  center: (_b, a) => expect(a.separator).toMatch(/:-+:/),
  right: (_b, a) => expect(a.separator).toMatch(/-:/),
  insertRowA: (b, a) => expect(a.bodyRows).toBe(b.bodyRows + 1),
  insertRowB: (b, a) => expect(a.bodyRows).toBe(b.bodyRows + 1),
  deleteRow: (b, a) => expect(a.bodyRows).toBe(b.bodyRows - 1),
  insertColumnL: (b, a) => expect(a.cols).toBe(b.cols + 1),
  insertColumnR: (b, a) => expect(a.cols).toBe(b.cols + 1),
  deleteColumn: (b, a) => expect(a.cols).toBe(b.cols - 1),
}

const ACTIONS = Object.keys(CHECKS) as TableAction[]

test.describe('dispatch-level: dispatchTableHotkey triggers the Vditor action', () => {
  for (const action of ACTIONS) {
    test(action, async ({ page }) => {
      await gotoEditor(page)
      const before = parseTable(await getValue(page))
      await selectFirstCell(page)
      await page.evaluate((a) => (window as any).__dispatchTableHotkey(a), action)
      await page.waitForTimeout(100)
      const after = parseTable(await getValue(page))
      CHECKS[action](before, after)
    })
  }
})

test('panel appears horizontally aligned with the clicked cell, not pinned far left', async ({
  page,
}) => {
  await gotoEditor(page)
  // click the second-column data cell, which sits well to the right
  await page.locator('.vditor-ir td').nth(1).click()
  await page.waitForTimeout(120)
  const { panelLeft, cellLeft } = await page.evaluate(() => {
    const cell = (window as any).vditor.vditor.ir.element.querySelectorAll(
      'td'
    )[1] as HTMLElement
    const panel = document
      .getElementById('fix-table-ir-wrapper')!
      .querySelector('.vditor-panel') as HTMLElement
    return {
      panelLeft: panel.getBoundingClientRect().left,
      cellLeft: cell.getBoundingClientRect().left,
    }
  })
  expect(Math.abs(panelLeft - cellLeft)).toBeLessThan(30)
})

test.describe('icon click: full flow through the table panel', () => {
  for (const action of ACTIONS) {
    test(action, async ({ page }) => {
      await gotoEditor(page)
      const before = parseTable(await getValue(page))
      await selectFirstCell(page) // reveals the collapsed "..." panel
      // hover expands the panel from "..." to the full icon row
      await page.locator('#fix-table-ir-wrapper .vditor-panel').hover()
      await page
        .locator(`#fix-table-ir-wrapper .vditor-icon[data-type="${action}"]`)
        .click()
      await page.waitForTimeout(100)
      const after = parseTable(await getValue(page))
      CHECKS[action](before, after)
    })
  }
})
