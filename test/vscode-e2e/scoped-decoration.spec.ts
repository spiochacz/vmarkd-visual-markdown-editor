import { wf } from './webview-helpers'
// Task 173/174 — the 3 synchronous, before-paint decorators (code-source.ts, callouts.ts,
// html-comment.ts) were changed to scope their re-decoration to the top-level block(s) a
// MutationObserver batch actually touched, instead of a whole-editor querySelectorAll on every
// keystroke (see mutation-scope.ts). The documented risk of scoping wrong is "silently loses
// decoration" on a block the observer never re-visits — this spec is the real-VS-Code check for
// exactly that: a heavy, multi-block document (3 callouts, 3 code blocks, 3 comments, TWO scattered
// link-reference-definitions) where editing ONE block must NOT disturb decoration anywhere else, and
// must still work correctly even while Vditor's own per-keystroke housekeeping (the link-ref-def
// merge-and-relocate-to-root-end, `ir/input.ts:205-231`) fires alongside — the scenario
// mutation-scope.ts's module doc calls out as the reason `record.target === root` can't drive
// scoping. See also the mutation-scope.test.ts unit tests, which cover the same fallback logic in
// isolation without a real webview.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'scoped-decoration.md')
const EMPTY_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'scoped-decoration-empty.md',
)

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
  fixture: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [fixture],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  return frame
}

// A snapshot of every decoration this spec cares about, read straight off the live IR DOM.
interface Snapshot {
  callouts: Array<{ type: string | null; title: string | null }>
  hljsCount: number
  codeSourceCount: number
  commentTexts: string[]
  linkRefDefCount: number
}

async function snapshot(
  frame: import('@playwright/test').FrameLocator,
): Promise<Snapshot> {
  return frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const callouts = Array.from(
      ir?.querySelectorAll('blockquote[data-callout]') ?? [],
    ).map((b) => ({
      type: b.getAttribute('data-callout'),
      title: b.getAttribute('data-callout-title'),
    }))
    // `.vditor-ir__marker--pre > code` ALSO matches html-block (comment) sources — same dual-node
    // shape, and code-source.ts tags them too (nothing in CUSTOM_LANGS excludes html-block). Exclude
    // those here so this count tracks just the 3 real (js/python/json) code blocks the fixture has.
    const codeSources = Array.from(
      ir?.querySelectorAll('.vditor-ir__marker--pre > code') ?? [],
    ).filter((c) => !c.closest('[data-type="html-block"]'))
    const comments = Array.from(
      ir?.querySelectorAll('.vmarkd-comment') ?? [],
    ).map((c) => c.textContent ?? '')
    return {
      callouts,
      hljsCount: codeSources.filter((c) => c.classList.contains('hljs')).length,
      codeSourceCount: codeSources.length,
      commentTexts: comments,
      linkRefDefCount:
        ir?.querySelectorAll("[data-type='link-ref-defs-block']").length ?? 0,
    }
  })
}

async function placeCaretAtEndOf(
  frame: import('@playwright/test').FrameLocator,
  textMatch: string,
): Promise<boolean> {
  // NOT stickySelection: this caret goes into an expanded IR source, whose node re-renders during
  // the helper's verification wait, so the keystrokes would land in the rendered preview instead.
  // Measured 2026-08-15 — see the vmarkd-testing skill's Gotchas. Type IMMEDIATELY after the caret lands.
  return frame.locator('body').evaluate((_b, match) => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const p = Array.from(ir?.querySelectorAll('p') ?? []).find((el) =>
      (el.textContent ?? '').includes(match),
    ) as HTMLElement | undefined
    if (!p) return false
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      last = n
      n = walker.nextNode() as Text | null
    }
    if (!last) return false
    const r = document.createRange()
    r.setStart(last, (last.textContent ?? '').length)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    ;(ir as HTMLElement)?.focus()
    return true
  }, textMatch)
}

test('editing one paragraph leaves callouts/code/comments elsewhere decorated, incl. across the link-ref-def relocation', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode, FIXTURE)
  const before = await snapshot(frame)
  expect(before.callouts.map((c) => c.type)).toEqual(['note', 'tip', 'warning'])
  expect(before.hljsCount).toBe(before.codeSourceCount)
  expect(before.codeSourceCount).toBe(3)
  expect(before.commentTexts).toHaveLength(3)
  // Both scattered link-ref-defs are present pre-edit (Lute parses each `[label]: url` line into its
  // own `link-ref-defs-block` before Vditor's first input() merges them — see ir/input.ts:198-213).
  expect(before.linkRefDefCount).toBeGreaterThan(0)

  const placed = await placeCaretAtEndOf(frame, 'edit-target paragraph')
  expect(placed, 'could not place caret in the edit target').toBe(true)
  await workbox.keyboard.type(' EDITED', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 700)))

  const after = await snapshot(frame)
  // The edit landed…
  const value = await frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
  expect(value).toContain('reliably by content match. EDITED')

  // …and NOTHING elsewhere silently lost its decoration: same 3 callouts (type + title unchanged),
  // same code-source .hljs tagging, same comment previews. Vditor's own per-keystroke link-ref-def
  // merge ran too (it's unconditional on every input()) — the scoping must survive that alongside
  // the real edit, per mutation-scope.ts's "never target-based" rule.
  expect(after.callouts).toEqual(before.callouts)
  expect(after.hljsCount).toBe(3)
  expect(after.codeSourceCount).toBe(3)
  expect(after.commentTexts).toEqual(before.commentTexts)
})

test('renaming one callout to an unknown type only clears that one — siblings keep their type/title', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode, FIXTURE)
  const before = await snapshot(frame)

  // Expand the middle ("tip") callout and put the caret right before the marker's closing "]", then
  // type a char — turns [!TIP] into the unknown [!TIPs], which must clear ONLY this callout.
  const placed = await frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const bq = ir?.querySelector(
      'blockquote[data-callout="tip"]',
    ) as HTMLElement | null
    if (!bq) return false
    bq.classList.add('vditor-ir__node--expand')
    const t = bq.querySelector(':scope > p')?.firstChild as Text | null
    const idx = t?.data.indexOf(']') ?? -1
    if (!t || idx < 0) return false
    ir?.focus()
    const range = document.createRange()
    range.setStart(t, idx)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    return true
  })
  expect(placed).toBe(true)
  await workbox.keyboard.type('s', { delay: 60 }) // [!TIP] → [!TIPs]
  // Move focus away so the caret-leave re-sync (task 179) settles the final render.
  await frame.locator('.vditor-ir').getByText('Trailing paragraph').click()
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 700)))

  const after = await snapshot(frame)
  expect(after.callouts.map((c) => c.type)).toEqual(['note', 'warning']) // "tip" cleared
  // the surviving two kept their EXACT prior title/type (scoping didn't touch/rebuild them)
  const notesBefore = before.callouts.filter((c) => c.type !== 'tip')
  expect(after.callouts).toEqual(notesBefore)
  // other observers untouched by this edit
  expect(after.hljsCount).toBe(3)
  expect(after.commentTexts).toEqual(before.commentTexts)
})

test('editing inside one code block source keeps ITS OWN + every other code source .hljs-tagged', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode, FIXTURE)
  // Page-level (Electron window) keyboard focus, not just a DOM-level target.focus() — a code-block
  // MARKER source does not pick up keyboard.type() from DOM focus alone (see the same note in
  // perf-observer-fleet.spec.ts: "the code-block source ... does not activate from a classList-expand
  // + DOM focus alone — the keystrokes never reach it"). Harness quirk, not product behaviour.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  const placed = await frame.locator('body').evaluate(() => {
    const ir = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    const code = Array.from(
      ir?.querySelectorAll('.vditor-ir__marker--pre > code') ?? [],
    ).find((c) => (c as HTMLElement).className.includes('language-python'))
    const node = code?.closest('.vditor-ir__node') as HTMLElement | null
    node?.classList.add('vditor-ir__node--expand')
    if (!code) return false
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    let n = walker.nextNode() as Text | null
    while (n) {
      last = n
      n = walker.nextNode() as Text | null
    }
    if (!last) return false
    const r = document.createRange()
    r.setStart(last, (last.textContent ?? '').length)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    ;(code as HTMLElement).focus()
    return true
  })
  expect(placed).toBe(true)
  await workbox.keyboard.type('\nz = 3', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 700)))

  const after = await snapshot(frame)
  expect(after.codeSourceCount).toBe(3)
  // Every source — including the FRESH `<code>` element the spin just rebuilt for the edited
  // block — is `.hljs`-tagged: the real regression risk of task 173 (a freshly recreated node
  // whose scoped re-tag pass resolved to the wrong/no block).
  expect(after.hljsCount).toBe(3)
  expect(after.callouts).toHaveLength(3) // unrelated observers undisturbed
  expect(after.commentTexts).toHaveLength(3)
  const value = await frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
  expect(value).toContain('z = 3')
})

test('typing the FIRST callout into a brand-new empty document still decorates correctly (isIRElement / whole-root replace path)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode, EMPTY_FIXTURE)
  await frame.locator('.vditor-ir').first().click()
  // The very first keystroke(s) into an empty IR editor have NO closest block yet (Vditor's
  // `hasClosestBlock` returns null) — Vditor routes that through `blockElement = vditor.ir.element`
  // (the `isIRElement` branch, `ir/input.ts:183`), i.e. a childList mutation whose target IS the
  // observed root itself. mutation-scope.ts widens to a full walk once that produces more than a
  // handful of new top-level children (see its FULL_WALK_BLOCK_THRESHOLD) rather than special-casing
  // `record.target === root` (proven NOT to be a reliable signal — see the module doc comment); this
  // is the real-webview check that the end state is still correct either way.
  await workbox.keyboard.type('> [!NOTE]', { delay: 40 })
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('fresh callout body', { delay: 40 })
  await frame.locator('.vditor-ir').click({ position: { x: 4, y: 200 } })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 700)))

  const after = await snapshot(frame)
  expect(after.callouts).toEqual([{ type: 'note', title: 'Note' }])
  const value = await frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
  expect(value).toContain('[!NOTE]')
  expect(value).toContain('fresh callout body')
})
