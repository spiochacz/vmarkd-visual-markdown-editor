import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'
import { composeAndCommit } from './ime-helpers'
import { gotoMouseops, setDoc, caretToEnd, getValue } from './mouseops-helpers'

// C5 (tasks/516, = task 455's highest-value dark item) — IME composition, driven for real via
// CDP `Input.imeSetComposition`/`Input.insertText` (see ime-helpers.ts for the fidelity caveat).
// Probe-first: this path was completely dark (zero `imeSetComposition` hits anywhere in the
// suite before this file), so a failure here is a FINDING, not a regression in something that
// used to work.
//
// FINDING: composing "にほんご" (4 kana) then committing to "日本語" (the IME's kanji
// conversion) does NOT duplicate the text (the classically-warned bug) — it LOSES most of the
// pre-edit and keeps only its LEADING characters, prefixed onto the committed text. This is
// DETERMINISTIC (pinned exact strings below, verified across repeated runs) and reproduces in
// BOTH surfaces this spec covers, so it is not specific to the WYSIWYG highlight machinery —
// but that machinery makes it WORSE (loses more of the pre-edit), see the RED-GREEN-RED note on
// the WYSIWYG test below.
//
// FOUR-LAYER TRACE (same discipline as the C7 finding, task 517):
//  1. Symptom: `getValue()` after a compose+commit contains a truncated pre-edit + the full
//     committed text glued together — not the clean committed text alone.
//  2. Control (below, `bare contenteditable`): the IDENTICAL CDP sequence against a plain
//     `contenteditable` div (no Vditor at all) commits CLEANLY — "Hello " + compose("にほんご")
//     + commit("日本語") -> "Hello日本語", byte-exact, every run. So this is NOT a CDP-fidelity
//     artifact; the corruption is specific to Vditor's/vmarkd's editable surface.
//  3. Mechanism (Vditor, node_modules/vditor/dist/index.js, ir/wysiwyg `compositionend`
//     listeners): on `compositionend` Vditor synchronously calls `input(vditor,
//     getSelection().getRangeAt(0).cloneRange())`, which re-serialises the block via
//     `SpinVditorIRDOM`/Lute — reading the DOM/selection at the instant the listener runs. The
//     deterministic (not flaky) partial retention across dozens of runs points at that read
//     racing the browser's own DOM mutation that applies the composition commit, rather than at
//     genuine nondeterminism — but this spec does NOT change Vditor's vendored code to confirm
//     that last step (out of scope for a probe; noted here for whoever picks up the fix).
//  4. vmarkd-specific amplification (WYSIWYG only): `observeWysiwygCodeHighlight`
//     (media-src/src/editing/wysiwyg-code-highlight.ts) re-highlights the code source on a
//     rAF-scheduled `MutationObserver` callback, gated by a `composing` flag set from the same
//     compositionstart/compositionend pair so it skips re-highlighting mid-composition. Verified
//     during this investigation (temporarily changed `if (composing) return` to `if (false &&
//     composing) return`, reran, reverted): with the gate disabled the corruption pattern
//     FLIPS from truncation ("...1に日本語...") to DUPLICATION ("...1にほんご日本語...", the
//     full pre-edit AND the full commit both survive) — so the gate is load-bearing (it's the
//     only thing standing between "loses text" and "duplicates text"), it just isn't sufficient
//     to make composition commit cleanly.

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

test('PROBE-C5-IR: composing then committing in IR prose loses part of the pre-edit (finding, not fixed here)', async ({
  page,
}) => {
  await gotoMouseops(page, 'ir')
  await setDoc(page, 'Hello ')
  await caretToEnd(page)
  await page.evaluate(() => {
    ;((window as any).__modeEl() as HTMLElement).focus()
  })
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })

  // Pins the OBSERVED (buggy) value: NOT "Hello日本語\n" (clean commit, what a correct editor
  // would produce — see the control above) and NOT "Helloにほんご日本語\n" (duplication, the
  // classic composition bug this journey exists to catch). It's a THIRD shape: partial loss.
  expect(await getValue(page)).toBe('Helloにほ日本語\n')
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
  await page.evaluate(() => {
    const code = document.querySelector(
      '.vditor-wysiwyg__block[data-type="code-block"] pre.vditor-wysiwyg__pre > code',
    ) as HTMLElement
    const r = document.createRange()
    r.selectNodeContents(code)
    r.collapse(false)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    code.focus()
  })
}

test('PROBE-C5-WYSIWYG: composing then committing inside a highlighted code block loses MORE of the pre-edit than plain IR (finding, not fixed here)', async ({
  page,
}) => {
  await gotoWysiwygHighlight(page)
  await focusCodeBlockEnd(page)
  await composeAndCommit(page, { preedit: 'にほんご', committed: '日本語' })

  // Same corruption CLASS as the IR probe (partial pre-edit retention, not duplication), but
  // MORE loss here: IR kept 2 of the 4 pre-edit chars ("にほ"), this surface keeps only 1
  // ("に") — consistent with the highlight observer's rAF/MutationObserver churn adding more
  // opportunity for the race described in the header trace, even though its `composing` gate
  // (wysiwyg-code-highlight.ts) is what keeps this from being FULL duplication instead (see the
  // RED-GREEN-RED note below).
  const value = await page.evaluate(() => (window as any).__getValue())
  expect(value).toBe(
    'text before\n\n```js\nconst a = 1に日本語\n```\n\ntext after\n',
  )

  // Despite the text corruption, the surrounding markdown structure and the live-highlight
  // machinery itself stay intact: exactly one clean fenced block (wrapLuteFlatten did its job —
  // no leaked `hljs`/`<span` reaching getValue()), and the block is still actively highlighted.
  expect(value.match(/```js/g)?.length).toBe(1)
  expect(value.match(/```/g)?.length).toBe(2)
  expect(value).not.toContain('<span')
  expect(value).not.toMatch(/\bhljs\b/)
  const tokenClasses = await page.evaluate(() =>
    (window as any).__sourceTokenClasses(),
  )
  expect(tokenClasses).toContain('hljs-keyword')
})
