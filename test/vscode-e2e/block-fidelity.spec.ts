import {
  type EvaluateInVSCode,
  docText,
  placeCaretAtEndOf,
  stickySelection,
  wf,
} from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Tasks 239 + 240 — editing anywhere in a document must not destroy blocks elsewhere in it.
//
// Both defects live in Lute's md → editable-DOM direction, which only exists inside the webview, so
// the real editor is the only place the contract can be checked end to end. The shape of each test
// is the user's own accident: open the file, type ONE character in a paragraph that has nothing to
// do with the fragile block, and read back the TextDocument.
//
// 239: an indented code block came back as PROSE — the indent gone, the code re-parsed as a
//      paragraph. IR is the default mode, so this hit every legacy / pandoc / email markdown.
// 240: a reference definition's title was dropped, and for an image reference it was injected into
//      the body text as literal garbage (`![alt][r]"T"`).
const SRC = path.join(__dirname, 'fixtures', 'block-fidelity.md')
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function open(evaluateInVSCode: EvaluateInVSCode, file: string) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file] as [string],
  )
}

// task 451: was a blind 1500ms sleep after `.vditor-ir` first appeared, at all 4 call sites below.
// The container existing is not the same as Lute finishing the initial md→DOM build — poll for BOTH
// things the next steps need: the code blocks rendered as `pre code` (what `IR: typing elsewhere…`
// hard-asserts right after) AND the TYPE-HERE anchor paragraph existing (what `typeElsewhere` needs
// right after that) — a single synchronous parse pass produces both together, but polling for both
// removes any doubt rather than assuming their relative order.
async function waitForInitialRender(frame: ReturnType<typeof wf>) {
  await expect
    .poll(
      () =>
        frame.locator('body').evaluate(() => ({
          code: document.querySelectorAll('.vditor-ir pre code').length > 0,
          anchor: [...document.querySelectorAll('.vditor-ir p')].some((p) =>
            p.textContent?.includes('TYPE-HERE'),
          ),
        })),
      {
        message:
          'the initial IR render finished (code rendered, anchor paragraph present)',
      },
    )
    .toEqual({ code: true, anchor: true })
}

// task 451: was a blind 2500ms sleep at each `typeElsewhere`/`typeElsewhereSv` call site, waiting
// for the keystroke to reach `vscode.workspace.textDocuments` (the writeback debounce is 250ms —
// edit-sync.ts — so 2500ms was a 10x margin). Poll for the exact suffix the caller's own assertion
// checks next, then do one more real read so the caller gets a value it can pass to
// `assertBlocksSurvived` — the poll's return is a boolean, not the document text.
async function waitForDocText(
  evaluateInVSCode: EvaluateInVSCode,
  tmp: string,
  suffix: string,
) {
  await expect
    .poll(async () => (await docText(evaluateInVSCode, tmp)).includes(suffix), {
      message: `the keystroke reached the saved TextDocument (expected "...${suffix}")`,
    })
    .toBe(true)
  return docText(evaluateInVSCode, tmp)
}

/**
 * Type one character at the end of the TYPE-HERE paragraph — a block that shares nothing with the
 * code blocks and definitions under test.
 *
 * This used to click the editor container at a fixed `{ x: 4, y: 4 }` and then write a `Range` into
 * the TYPE-HERE paragraph via `stickySelection`. That click planted the editor's own click-intent in
 * whatever block sits at that corner — a DIFFERENT block from the one the Range targeted — and
 * Vditor re-resolves its declarative caret intent every animation frame, so it kept reverting the
 * caret back to the click position. `stickySelection` verifies the write BEFORE the keystroke, which
 * cannot catch a revert that happens after it returns; measured at 1 failure in 5 chain replays, all
 * with the keystroke landing in the clicked block instead of the anchor paragraph. `placeCaretAtEndOf`
 * closes that gap by clicking the TARGET element itself — so the click-intent and the test's target
 * are the same block — then pressing `End` and re-verifying the caret landed before it returns.
 *
 * task 451: this also used to end with a blind 2500ms sleep waiting for the keystroke to reach
 * `vscode.workspace.textDocuments` (the writeback debounce is 250ms — edit-sync.ts — so 2500ms was
 * a 10x margin). That settle is now a poll AT EACH CALL SITE instead of in here: it needs
 * `evaluateInVSCode` + the temp file path, neither of which this helper has, and the exact string
 * to poll for differs per call site (the stable-doc test polls for `.ZY` on its second call). Every
 * call site polls `docText(...)` for the expected suffix before reading it for real.
 */
async function typeElsewhere(
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
  mode: '.vditor-ir' | '.vditor-wysiwyg',
) {
  await placeCaretAtEndOf(frame, workbox, `${mode} p`, 'TYPE-HERE')
  await workbox.keyboard.type('Z', { delay: 40 })
}

/**
 * The sv equivalent of `typeElsewhere`. Split mode has no `<p>` — the source view is a flat span
 * soup — so the anchor is found by walking text nodes instead of by block selector.
 */
async function typeElsewhereSv(
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
) {
  await frame
    .locator('.vditor-sv')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const sv = document.querySelector('.vditor-sv') as HTMLElement | null
      if (!sv) throw new Error('.vditor-sv not found')
      const walker = document.createTreeWalker(sv, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        const i = text.indexOf('TYPE-HERE anchor paragraph.')
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i + 'TYPE-HERE anchor paragraph.'.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        sv.focus()
        return
      }
      throw new Error('TYPE-HERE anchor not found in sv')
    },
    null,
  )
  await workbox.keyboard.type('Z', { delay: 40 })
}

// task 451: `waitForInitialRender` (below) went from a blind 1500ms sleep to a poll that resolves
// as soon as the IR content is parsed — much sooner than 1500ms. That exposed a real race:
// dispatching the edit-mode toolbar click too soon after produces a LOST click — `.vditor-wysiwyg`/
// `.vditor-sv` then never appears and the subsequent `.waitFor` times out on a permanently-hidden
// element. Tried polling for a completion marker first (the toolbar panel + mode button existing in
// the DOM, per this file's own doctrine elsewhere) — that did NOT fix it: still flaked once in a
// 39-test FAST-tier run after the poll was in place, on top of the original 1/11 solo flake. Root
// cause investigated in `EditMode.ts` (vendored vditor) and ruled OUT: `setEditMode`'s early-return
// guard (`currentMode === type`) can't fire on a first switch; the panel-open handler
// `stopPropagation()`s so it can't be an outside-click race; `dispatchEvent` on a CSS-hidden button
// still runs its listener synchronously, so DOM presence isn't the gate. The actual cause is still
// unidentified — kept as an empirically-necessary sleep, not a fix. Left load-bearing on purpose;
// do not re-attempt a poll-based conversion without first tracing what happens between the click and
// `setEditMode` actually running (see task 451's "block-fidelity" section for the full investigation
// and both flake counts).
const MODE_SWITCH_CLICK_SETTLE = () => new Promise((r) => setTimeout(r, 1500))

/** Switch to WYSIWYG through the edit-mode toolbar panel — the user's own path. */
async function switchToWysiwyg(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(MODE_SWITCH_CLICK_SETTLE)
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  // task 451: was a blind 2500ms sleep after the container appeared. The container mounting is not
  // the same as Lute finishing the md→DOM rebuild into it — poll for the EXACT thing `typeElsewhere`
  // needs next (the TYPE-HERE paragraph existing), so "settled" means "ready for the next step",
  // not "some fixed margin elapsed".
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(() =>
            [...document.querySelectorAll('.vditor-wysiwyg p')].some((p) =>
              p.textContent?.includes('TYPE-HERE'),
            ),
          ),
      { message: 'WYSIWYG finished rebuilding the document from source' },
    )
    .toBe(true)
}

/** Same path, into split mode. */
async function switchToSv(frame: ReturnType<typeof wf>) {
  // task 451: see MODE_SWITCH_CLICK_SETTLE's comment above switchToWysiwyg — same lost-click risk,
  // same unresolved cause, same empirical fix.
  await frame.locator('body').evaluate(MODE_SWITCH_CLICK_SETTLE)
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="sv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-sv').first().waitFor({ timeout: 30_000 })
  // task 451: was a blind 2500ms sleep — same reasoning as switchToWysiwyg above, poll for
  // `typeElsewhereSv`'s own precondition (the anchor text findable by its text-node walk).
  await expect
    .poll(
      () =>
        frame.locator('body').evaluate(() => {
          const sv = document.querySelector('.vditor-sv')
          return (
            !!sv &&
            (sv.textContent ?? '').includes('TYPE-HERE anchor paragraph.')
          )
        }),
      { message: 'split (sv) finished rebuilding the document from source' },
    )
    .toBe(true)
}

/** Everything both modes must guarantee about the saved file. */
function assertBlocksSurvived(after: string) {
  const check = expect.soft
  // 239 — still a code block. It may be a fence rather than four spaces (the repair makes IR agree
  // with WYSIWYG, which has always fenced), but the CONTENT and its block-ness must be intact.
  // What must never appear again is the content sitting at column 0 as ordinary prose.
  check(after, 'the indented block is still code').toMatch(
    /(?:^ {4}indented code line|```\n?indented code line)/m,
  )
  check(after, 'the block did not degrade to prose').not.toMatch(
    /^indented code line$/m,
  )
  check(after, 'its second line came along').toContain('second indented line')
  // The block whose content holds a fence must not have been split into several blocks.
  check(after, 'the inner fence is still inside one block').toMatch(
    /(?:^ {4}inner fence|````\n```\ninner fence)/m,
  )

  // 240 — the definition titles are still on the definitions.
  check(after, 'the link definition kept its title').toContain(
    '[ref]: https://example.com "Ref Title"',
  )
  check(after, 'the image definition kept its title').toContain(
    "[imgref]: pic.png 'Image Title'",
  )
  // …and the image title did NOT leak into the prose as literal text.
  check(after, 'no title injected into the body').not.toContain(
    '![the image][imgref]"',
  )
  check(after, 'the image reference is unchanged').toContain(
    '![the image][imgref]',
  )
  // An untitled definition must not gain one.
  check(after, 'an untitled definition stays untitled').toContain(
    '[plainref]: https://plain.example\n',
  )
}

test('IR preserves fragile blocks and stays stable across a second edit', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-block-fidelity-ir.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await waitForInitialRender(frame)

  // The code block must already be rendered as code — the parse is where it used to die.
  expect
    .soft(
      await frame.locator('.vditor-ir pre code').count(),
      'the indented blocks render as code, not paragraphs',
    )
    .toBeGreaterThan(0)

  await typeElsewhere(frame, workbox, '.vditor-ir')
  const after = await waitForDocText(
    evaluateInVSCode,
    tmp,
    'TYPE-HERE anchor paragraph.Z',
  )
  assertBlocksSurvived(after)
  await workbox.keyboard.type('Y', { delay: 40 })
  const second = await waitForDocText(
    evaluateInVSCode,
    tmp,
    'TYPE-HERE anchor paragraph.ZY',
  )
  expect
    .soft(
      second.replace('.ZY', '.Z'),
      'the second edit adds one char, nothing else',
    )
    .toBe(after)
  assertBlocksSurvived(second)
  rmSync(tmp, { force: true })
})

test('WYSIWYG: the same document survives a mode switch and a keystroke', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-block-fidelity-wy.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await waitForInitialRender(frame)
  await switchToWysiwyg(frame)

  await typeElsewhere(frame, workbox, '.vditor-wysiwyg')
  const after = await waitForDocText(
    evaluateInVSCode,
    tmp,
    'TYPE-HERE anchor paragraph.Z',
  )
  assertBlocksSurvived(after)
  rmSync(tmp, { force: true })
})

test('SPLIT (sv): the same document survives a mode switch and a keystroke', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Added after the full suite caught 239/240 shipping with sv untouched. sv is a SOURCE view whose
  // markdown is `element.textContent` verbatim, so a defect in the DOM Lute builds for it lands
  // straight in the file — and split mode had BOTH defects: it dropped the definition titles, leaked
  // the image title into the prose, and hardcoded ``` around an indented block whose content holds
  // its own fence (one block re-parsing as three). This is sv's `block-fidelity` net; it had none.
  const tmp = path.join(TEMP_DIR, 'vmarkd-block-fidelity-sv.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await waitForInitialRender(frame)
  await switchToSv(frame)

  await typeElsewhereSv(frame, workbox)
  const after = await waitForDocText(
    evaluateInVSCode,
    tmp,
    'TYPE-HERE anchor paragraph.Z',
  )
  assertBlocksSurvived(after)
  rmSync(tmp, { force: true })
})
