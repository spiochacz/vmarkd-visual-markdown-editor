import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'
import { composeAndCommit } from './ime-helpers'
import { gotoMouseops, setDoc, getValue } from './mouseops-helpers'

// C5 (tasks/516, = task 455's highest-value dark item) — IME composition, driven for real via
// CDP `Input.imeSetComposition`/`Input.insertText` (see ime-helpers.ts for the fidelity caveat).
//
// TASK 518 UPDATE — premise correction. The original probe pinned a truncation finding
// ("Helloにほ日本語" instead of "Hello日本語") and framed it as a defect in Vditor's/vmarkd's
// editable surface (see tasks/518-ime-composition-corrupts-text.md's original root-cause trace).
// Root-causing it for the fix turned up a different story:
//
//  1. The corruption is already present in the BROWSER's own native DOM mutation for the
//     `input` event carrying the composition commit — before Vditor's `compositionend` handler
//     (the thing the original trace blamed) ever runs. A patch that defers that handler by one
//     animation frame changed nothing (proven: the pinned broken string was byte-identical
//     before and after).
//  2. Bisecting what actually flips the result found ONE variable: how the caret was placed
//     BEFORE composing started, not anything downstream of it.
//       - The old `caretToEnd()` helper (mouseops-helpers.ts) does
//         `range.selectNodeContents(modeEl); range.collapse(false)` where `modeEl` is the WHOLE
//         editable ROOT — a coarse, container-level collapsed range that lands between top-level
//         block children, not adjacent to actual text. The WYSIWYG probe's old
//         `focusCodeBlockEnd()` did the equivalent one level down (`selectNodeContents(code)`).
//       - Re-doing the identical operation scoped to the actual paragraph/code element, OR
//         placing the caret via genuine `page.keyboard` input (native browser caret, exactly
//         what a real user's typing/mouse-click produces) → clean commit, both surfaces, every
//         run.
//       - A bare `<pre><p>Hello</p></pre>` with NO Vditor loaded, given the SAME coarse
//         placement, stays clean — so Vditor's own listeners are a necessary co-factor for
//         turning the coarse anchor into visible corruption. But nothing in vmarkd's real caret
//         code (`caret.ts`, ADR-0007) or Vditor's own internal caret restoration
//         (`setRangeByWbr`) ever produces that coarse container-level shape — those are always
//         text-node/character-offset precise, by design (task 439). Real typing, real clicks,
//         and every programmatic caret write vmarkd ships are all precise.
//  3. The ORIGINAL control below (`bare contenteditable`) used a flat single-text-child `<div>`,
//     where a coarse `selectNodeContents(container)` happens to be geometrically IDENTICAL to a
//     precise position (the container's only child already IS the text). So the control
//     validated CDP fidelity but never controlled for caret coarseness — it couldn't have caught
//     this, and its clean result created the (wrong) impression that the corruption was
//     Vditor-specific.
//
// Conclusion: no real user — real IME, real keyboard, real mouse click, or any of vmarkd's own
// caret-placement code — can reach the state that triggers this. It is not reachable via any
// actual product code path, so it is not a product bug. The two probes below are corrected to
// assert the CLEAN commit, using caret placement a real user's input would actually produce.
// `PROBE-C5-HARNESS-ARTIFACT` (new, below) keeps the coarse-placement repro alive as a documented
// harness gotcha, so nobody re-discovers "composition looks broken" from `caretToEnd()` without
// this context.
//
// The real-OS-IME manual check stays on task 516's checklist regardless (CDP composition is not
// a real IME — see ime-helpers.ts).

async function bareContentEditable(page: Page): Promise<void> {
  await page.setContent('<div id="ed" contenteditable="true">Hello </div>')
  await page.evaluate(() => {
    const el = document.getElementById('ed') as HTMLElement
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  })
}

// CONTROL (not a vmarkd assertion — establishes that CDP composition itself is clean, so the
// probes below are pinning a real editor-surface bug, not a harness artifact).
test('control: the same CDP composition sequence commits cleanly on a bare contenteditable', async ({
  page,
}) => {
  await bareContentEditable(page)
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })
  const text = await page.evaluate(
    () => document.getElementById('ed')!.textContent,
  )
  expect(text).toBe('Hello日本語')
})

test('PROBE-C5-IR: composing then committing in IR prose at a genuinely-placed caret commits cleanly', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await page.evaluate(() => ((window as any).__modeEl() as HTMLElement).focus())
  // Real keyboard input, not caretToEnd()'s coarse selectNodeContents(root).collapse(false) —
  // see the header note. This is how a real user's caret ends up positioned before they start
  // composing: native, text-node-precise.
  await page.keyboard.type('Hello')
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })

  expect(await getValue(page)).toBe('Hello日本語\n')
})

async function gotoWysiwygHighlight(page: Page): Promise<void> {
  await page.goto('/wysiwyg-highlight.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForFunction(
    () => typeof (window as any).hljs?.highlight === 'function',
    undefined,
    { timeout: 10_000 },
  )
}

async function focusCodeBlockEnd(page: Page): Promise<void> {
  await page
    .locator('.vditor-wysiwyg__block[data-type="code-block"]')
    .first()
    .click()
  await page.waitForFunction(() => {
    const pre = document.querySelector(
      '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre',
    ) as HTMLElement | null
    return !!pre && getComputedStyle(pre).display !== 'none'
  })
  // Native End-key navigation, not selectNodeContents(code).collapse(false) — see the header
  // note. The click above already lands the caret inside the code source; End moves it to the
  // true end of the line the same way a real user's keyboard would.
  await page.keyboard.press('End')
}

test('PROBE-C5-WYSIWYG: composing then committing inside a highlighted code block at a genuinely-placed caret commits cleanly', async ({
  page,
}) => {
  await gotoWysiwygHighlight(page)
  await focusCodeBlockEnd(page)
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })

  const value = await page.evaluate(() => (window as any).__getValue())
  expect(value).toBe(
    'text before\n\n```js\nconst a = 1日本語\n```\n\ntext after\n',
  )

  // Markdown structure and the live-highlight machinery stay intact: exactly one clean fenced
  // block (wrapLuteFlatten did its job — no leaked `hljs`/`<span` reaching getValue()), and the
  // block is still actively highlighted.
  expect(value.match(/```js/g)?.length).toBe(1)
  expect(value.match(/```/g)?.length).toBe(2)
  expect(value).not.toContain('<span')
  expect(value).not.toMatch(/\bhljs\b/)
  const tokenClasses = await page.evaluate(() =>
    (window as any).__sourceTokenClasses(),
  )
  expect(tokenClasses).toContain('hljs-keyword')
})

// HARNESS ARTIFACT (not a vmarkd assertion) — keeps today's coarse-placement repro alive as a
// documented gotcha rather than letting it silently vanish when the two probes above flipped. If
// this ever starts failing, something changed about `caretToEnd()`'s placement or Chromium's
// composition-range handling for it — re-investigate before assuming it's a real regression, and
// see the header note for the full trace of why this shape (and only this shape) corrupts.
test('PROBE-C5-HARNESS-ARTIFACT: caretToEnd()-style coarse placement (selectNodeContents(root).collapse(false)) still corrupts composition — this is the harness gotcha the two probes above used to conflate with a product bug, not something a real user can reach', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await setDoc(page, 'Hello ')
  await page.evaluate(() => {
    const el = (window as any).__modeEl() as HTMLElement
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el) // coarse: the whole editable root, not the paragraph
    r.collapse(false)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  })
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })

  expect(await getValue(page)).toBe('Helloにほ日本語\n')
})
