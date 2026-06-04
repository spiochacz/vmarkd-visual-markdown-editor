import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e for Vditor's listToggle crash fix (task 56). The uncheck path iterates ALL
 * sibling <li> and called `.remove()` on a missing <input> — a checkbox-less
 * sibling threw. Fixed with `?.` (the fixListToggle patch); this asserts the
 * toggle no longer throws. (The sibling-scope behaviour is parked — see below.)
 */
async function gotoList(page: Page, list: 'plain' | 'mixed') {
  await page.goto(`/list.html?list=${list}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

// Toggle list type on the Nth <li>; returns {ok,error} from the harness.
function toggle(page: Page, liIndex: number, type: string) {
  return page.evaluate(
    ({ liIndex, type }) => (window as any).__listToggle(liIndex, type),
    { liIndex, type },
  )
}

test.describe('listToggle — crash fix (task 56)', () => {
  test('toggling list type on a mixed list does not throw on a checkbox-less sibling', async ({
    page,
  }) => {
    await gotoList(page, 'mixed')
    // Item 0 has a checkbox; the uncheck path iterates every sibling incl. the
    // plain bullet (index 2). Pre-fix this threw on `.remove()` of null.
    const res = await toggle(page, 0, 'list')
    expect(res.ok).toBe(true)
    expect(res.error).toBeNull()
  })
})

// Sibling-scope (task 56) is PARKED by decision: Vditor's listToggle mutates the
// WHOLE list (`itemElement.parentElement.querySelectorAll("li")`), so toggling
// "check"/"list" affects every sibling, not just the clicked item. We accept that
// upstream whole-list behaviour as-is and do NOT pursue the Aloklok per-item split
// rewrite. Only the crash (above) was fixed. See tasks/56 for the rationale.
