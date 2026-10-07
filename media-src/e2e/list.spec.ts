import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e for Vditor's listToggle crash fix (task 56). The uncheck path iterates ALL
 * sibling <li> and called `.remove()` on a missing <input> — a checkbox-less
 * sibling threw. Fixed with `?.` (the fixListToggle patch); this asserts the
 * toggle no longer throws. (The sibling-scope behaviour is parked — see below.)
 */
async function gotoList(
  page: Page,
  list: 'plain' | 'mixed' | 'ops' | 'nested',
  options: { fix?: boolean } = {},
) {
  const query = options.fix ? `list=${list}&fix=1` : `list=${list}`
  await page.goto(`/list.html?${query}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

// Toggle list type on the Nth <li>; returns {ok,error} from the harness.
function toggle(page: Page, liIndex: number, type: string) {
  return page.evaluate(
    ({ liIndex, type }) => (window as any).__listToggle(liIndex, type),
    { liIndex, type },
  )
}

// Places a collapsed caret at the very start of the first `<li>` (under `rootSelector` — `.vditor-ir`
// or `.vditor-wysiwyg`) whose text starts with `needle`. Shared by all tasks-461/462 Backspace specs
// below (IR and WYSIWYG alike) — same tree shape, only the editing surface's root class differs.
async function caretAtItemStart(
  page: Page,
  rootSelector: string,
  needle: string,
) {
  await page.evaluate(
    ({ rootSelector, needle }) => {
      const li = [...document.querySelectorAll(`${rootSelector} li`)].find(
        (x) => x.textContent?.trim().startsWith(needle),
      ) as HTMLElement | undefined
      if (!li) throw new Error(`${needle} not found under ${rootSelector}`)
      const textNode = [...li.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE,
      ) as Text | undefined
      const r = document.createRange()
      if (textNode) r.setStart(textNode, 0)
      else r.selectNodeContents(li)
      r.collapse(true)
      const s = getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      li.focus()
    },
    { rootSelector, needle },
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

// Task 453 — migrated from test/vscode-e2e/list-ops.spec.ts (NET, task 190 P1): list editing
// round-trips to correct markdown. Continuing a list with Enter is the common op; asserts the
// serialized getValue() (what actually saves). Pure Vditor + Lute, no host API touched — the
// real-VS-Code original's only non-portable bit was a webview-iframe focus quirk (documented
// there as a harness artifact, not product behaviour), which doesn't exist in this plain-page
// harness.
test.describe('list editing — Enter continues a list (task 190 P1)', () => {
  test('continuing a bullet list with Enter serializes a new sibling item', async ({
    page,
  }) => {
    await gotoList(page, 'ops')

    const getValue = () =>
      page.evaluate(
        () => (window as any).vditor.getValue() as string,
      ) as Promise<string>

    // Sanity: the list loaded and serializes on open.
    const initial = await getValue()
    expect(initial, 'task list present on open').toMatch(/- \[ \]\s+task one/)
    expect(initial, 'bullet list present on open').toContain('- bullet B')

    // Place the caret at the end of "bullet B", Enter to continue the list, type a new item.
    await page.evaluate(() => {
      const li = [...document.querySelectorAll('.vditor-ir li')].find((x) =>
        x.textContent?.includes('bullet B'),
      ) as HTMLElement | undefined
      if (!li) throw new Error('bullet B not found')
      const r = document.createRange()
      r.selectNodeContents(li)
      r.collapse(false)
      const s = getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      li.focus()
    })
    await page.keyboard.press('Enter')
    await page.keyboard.type('bullet NEW', { delay: 40 })
    await page.waitForTimeout(500)

    const afterEnter = await getValue()
    // eslint-disable-next-line no-console
    console.log(
      `[list] afterEnter tail=${JSON.stringify(afterEnter.slice(-90))}`,
    )
    // The new text is its own bullet item (a "- " line), and bullet B is preserved.
    expect(afterEnter, 'Enter created a new bullet item').toMatch(
      /- bullet NEW/,
    )
    expect(afterEnter, 'original bullet B preserved').toContain('- bullet B')
    // The task list above was not disturbed by editing the bullet list below.
    expect(afterEnter, 'task list intact').toMatch(/- \[ \]\s+task one/)
  })
})

// Tasks 461/462 — this harness bundles Vditor from source through the SAME `vditorSourceConfig` /
// `VDITOR_TS_PATCHES` plugin the production build and every other harness use (ADR-0004), so
// `patchFixListOutdent` is ALWAYS baked in here — there is no way to get literally pre-patch Vditor
// out of a running build. What this test can still isolate: `?list=nested` (no `?fix=1`) never calls
// `installListBackspace()`, so `window.__vmarkdListKeydown` is unset — the degenerate case of
// our OWN patched `fixList` with the seam it calls into missing. Before this patch existed, that same
// scenario (unmodified Vditor, task 461/462's original "stock Vditor" probe) reproduced task 391's
// `CORRUPTED` fixture BYTE-FOR-BYTE (recorded in tasks/461 and tasks/462 — that finding is what
// justified the patch's shape and is not re-asserted here, since this build can no longer produce it).
// What IS still worth asserting, and is the regression net for `patchFixListOutdent` itself: even with
// the seam missing, patched `fixList` no longer produces the tight-list `<p>`-corruption, because its
// first-item branch is now gated to top-level-only and simply does nothing for a nested item — Backspace
// falls all the way through to the browser's plain default merge (the SAME residual gap task 428
// originally described for a non-first item, now also covering the nested-first case when the seam
// isn't installed — a real gap, but a lesser and pre-existing one, not the `data-tight` contradiction).
test.describe('patched fixList — nested first item Backspace, seam NOT installed (tasks 461/462)', () => {
  test('no tight-list <p>-corruption even without the outdent seam (degenerate case)', async ({
    page,
  }) => {
    await gotoList(page, 'nested')

    // Caret at the start of "first entry"'s text (the nested list's first <li>, no
    // previousElementSibling) — the same anchor shape as list-tight.test.ts's CORRUPTED fixture.
    await caretAtItemStart(page, '.vditor-ir', 'first entry')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    const html = await page.evaluate(
      () => document.querySelector('.vditor-ir')?.innerHTML ?? '',
    )
    // eslint-disable-next-line no-console
    console.log(`[list-461-462] seam-absent post-Backspace innerHTML:\n${html}`)

    const value = await page.evaluate(
      () => (window as any).vditor.getValue() as string,
    )
    // eslint-disable-next-line no-console
    console.log(`[list-461-462] seam-absent getValue():\n${value}`)

    // The specific structural corruption `patchFixListOutdent` exists to prevent: a `data-tight="true"`
    // list with a lone-<p> item. Gone regardless of seam registration, because the gate is on fixList's
    // OWN branch, not on the seam being called.
    expect(html, 'no stray <p> sibling inside the parent <li>').not.toContain(
      '<p data-block="0">first entry</p>',
    )
    expect(value, 'no blank line — never went loose').not.toMatch(
      /Analysis of email threads\n\n/,
    )
    // Documented, not asserted-good: the browser's plain default merge is still reachable when the
    // seam is missing (same class of gap task 428 always had for a non-first item) — production never
    // hits this because finish-init.ts always calls installListBackspace().
    expect(value, 'residual: falls through to the plain merge').toContain(
      'Analysis of email threadsfirst entry',
    )
  })
})

// Tasks 461/462 — WITH `list-backspace.ts`'s seam wired (`?fix=1`, mirrors what
// `finish-init.ts`'s `installListBackspace()` call does in production). Deliberately does NOT wire
// `list-tight.ts`'s `observeTightLists` — `__tightListCorruption()` (list-harness.ts) re-implements
// task 391's invariant check locally (a DETECTOR, not the repair) as a PROBE instead, so these tests
// check for persistent corruption straight from the source, not "did an observer happen to mask it"
// (an observer firing zero times would look identical to "no corruption occurred" from outside — the
// probe can't be fooled that way, and has zero dependency on `list-tight.ts` either way). Answers
// task 461's premise: is Backspace-on-a-nested-item (first OR non-first) still the tight-list
// corruption trigger with `list-backspace.ts`'s outdent active? And confirms 462's guard-overlap
// finding end-to-end: `list-backspace.ts`'s broader guard (not gated on top-level-ness) is what
// prevents the corruption the seam-absent test above reproduces.
test.describe('list-backspace.ts seam wired in (tasks 461/462)', () => {
  test('Backspace on the nested FIRST item outdents cleanly and leaves no lone-<p> corruption', async ({
    page,
  }) => {
    await gotoList(page, 'nested', { fix: true })

    await caretAtItemStart(page, '.vditor-ir', 'first entry')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    const corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    const value = await page.evaluate(
      () => (window as any).vditor.getValue() as string,
    )
    // eslint-disable-next-line no-console
    console.log(
      `[list-461-462-fixed] nested-first getValue():\n${value}\ncorrupted=${corrupted}`,
    )

    expect(corrupted, 'no lone-<p> corruption left behind').toBe(0)
    expect(value, 'no text-merge into the parent').not.toContain(
      'Analysis of email threadsfirst entry',
    )
    // Outdenting into the ENCLOSING ordered list adopts its marker type (real-editor behaviour —
    // Word/Docs do the same: a promoted item takes the surrounding list's numbering, not its old
    // bullet), so this is `2. first entry`, not `* first entry`. Task 525 #4: it used to read
    // `1. first entry` — the stale `data-marker` of the outdented item, since listOutdent only
    // re-spun the immediate sub-list; it now follows `1. Analysis of email threads` as number 2.
    expect(value, 'first entry survives as its own outdented item').toMatch(
      /^2\. first entry$/m,
    )
  })

  test('Backspace on a nested NON-first item outdents cleanly (task 428 case, re-confirmed here)', async ({
    page,
  }) => {
    await gotoList(page, 'nested', { fix: true })

    await caretAtItemStart(page, '.vditor-ir', 'second entry')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    const corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    const value = await page.evaluate(
      () => (window as any).vditor.getValue() as string,
    )
    // eslint-disable-next-line no-console
    console.log(
      `[list-461-462-fixed] nested-non-first getValue():\n${value}\ncorrupted=${corrupted}`,
    )

    expect(corrupted, 'no lone-<p> corruption left behind').toBe(0)
    expect(value, 'no text-merge into the previous sibling').not.toContain(
      'first entrysecond entry',
    )
  })

  test('Tab / Shift+Tab list indent-outdent (a DIFFERENT code path than Backspace) leaves no lone-<p> corruption', async ({
    page,
  }) => {
    await gotoList(page, 'nested', { fix: true })

    // Indent "second entry" under "first entry" (Tab at start of its text), then outdent it back
    // (Shift+Tab) — list-backspace.ts only touches Backspace, so this exercises fixList's Tab
    // branch (listIndent/listOutdent) completely unintercepted, per list-tight.ts's own claim that
    // "any code path that block-wraps an item… is fixed by the same rule" — Tab is the most obvious
    // untested candidate for a second trigger.
    await caretAtItemStart(page, '.vditor-ir', 'second entry')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(200)
    let corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    expect(corrupted, 'Tab-indent left no lone-<p> corruption').toBe(0)

    await caretAtItemStart(page, '.vditor-ir', 'second entry')
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(200)
    corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    expect(corrupted, 'Shift+Tab-outdent left no lone-<p> corruption').toBe(0)
  })

  test('Enter splitting a nested item leaves no lone-<p> corruption', async ({
    page,
  }) => {
    await gotoList(page, 'nested', { fix: true })

    // Caret mid-word in "first entry" (after "first"), Enter splits the item in two.
    await page.evaluate(() => {
      const li = [...document.querySelectorAll('.vditor-ir li')].find((x) =>
        x.textContent?.trim().startsWith('first entry'),
      ) as HTMLElement
      const textNode = [...li.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE,
      ) as Text
      const r = document.createRange()
      r.setStart(textNode, 'first'.length)
      r.collapse(true)
      const s = getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      li.focus()
    })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)

    const corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    expect(corrupted, 'Enter-split left no lone-<p> corruption').toBe(0)
  })

  // Task 461's own steps flag the WYSIWYG half (commit a164aa2) as unchecked for this question —
  // list-backspace.ts uses SpinVditorDOM (not SpinVditorIRDOM) in WYSIWYG, a genuinely different
  // code path, so the IR-only checks above don't cover it.
  test('WYSIWYG: Backspace on the nested FIRST item leaves no lone-<p> corruption', async ({
    page,
  }) => {
    await gotoList(page, 'nested', { fix: true })

    await page.evaluate(() => {
      const v = (window as any).vditor.vditor
      v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      document
        .querySelector('button[data-mode="wysiwyg"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.locator('.vditor-wysiwyg').first().waitFor({ timeout: 10_000 })
    await page.waitForTimeout(300)

    await caretAtItemStart(page, '.vditor-wysiwyg', 'first entry')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    const corrupted = await page.evaluate(() =>
      (window as any).__tightListCorruption(),
    )
    const value = await page.evaluate(
      () => (window as any).vditor.getValue() as string,
    )
    // eslint-disable-next-line no-console
    console.log(
      `[list-461-462-fixed] WYSIWYG nested-first getValue():\n${value}\ncorrupted=${corrupted}`,
    )
    expect(corrupted, 'WYSIWYG: no lone-<p> corruption left behind').toBe(0)
    expect(value, 'WYSIWYG: no text-merge into the parent').not.toContain(
      'Analysis of email threadsfirst entry',
    )
  })
})
