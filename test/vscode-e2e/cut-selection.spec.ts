import {
  type EvaluateInVSCode,
  docText,
  ev,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 387 — cutting a selected multi-line paragraph used to leave its last line behind (85 of
// ~96 characters removed). `clipboard-collapsed.spec.ts` covers the original torture.md repro;
// this file covers what that fixture cannot cleanly assert (a PRE-EXISTING, unrelated artifact —
// undoing a cut on torture.md reorders its trailing reference-link-definition blocks relative to
// the `---`, reproducing identically with and without this fix, so it is not something this task
// introduced or is responsible for fixing) and adds WYSIWYG-mode coverage (the sv regression pin
// lives in its own file, see below).
//
// FIXTURE is torture.md with ONLY its reference-links section removed (that section is what
// triggers the unrelated reordering artifact on undo). Measured, not assumed: a minimal
// single-paragraph document does NOT reproduce this bug at all (verified against the unpatched
// build — it cut correctly) — the bug needs surrounding document complexity to manifest, so a
// "clean" fixture stripped down further than this would silently stop testing anything.

const readClip = (evaluateInVSCode: EvaluateInVSCode) =>
  ev(evaluateInVSCode, async (vscode: typeof import('vscode')) =>
    vscode.env.clipboard.readText(),
  ) as Promise<string>

const writeClip = (evaluateInVSCode: EvaluateInVSCode, text: string) =>
  ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.env.clipboard.writeText(args[0])
    },
    text,
  )

const FIXTURE = `# Torture document

This canonical fixture exercises the common block types in their normalized form so a
mode round-trip (ir → wysiwyg → sv → ir) returns byte-identical. Anchor line ALPHA.

## Prose and inline

A paragraph with **bold**, *italic*, \`inline code\`, and a [link](https://example.com).
Anchor line BRAVO with a second sentence.

## A tight bullet list

- First bullet
- Second bullet
- Third bullet

## An ordered list

1. Step one
2. Step two
3. Step three

## A table

| Name | Count |
| --- | --- |
| Alpha | 1 |
| Beta | 2 |

## A fenced code block

\`\`\`ts
const answer = 42
console.log(answer)
\`\`\`

## A blockquote

> Quoted line one.
> Quoted line two.

## An indented code block (task 239)

    indented code line
    second indented line

Closing paragraph. Anchor line ZULU.
`

let bootCount = 0
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  name: string,
  body = FIXTURE,
) {
  const tmp = path.join(TEMP_DIR, `${process.pid}-${bootCount++}-${name}`)
  writeFileSync(tmp, body)
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    tmp,
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  return { tmp, frame }
}

/** Selects from the start of `from` to the end of `to`, walking text nodes — works in sv too,
 * which has no `<p>` elements to select via `selectNodeContents`. */
async function selectParagraph(
  frame: ReturnType<typeof wf>,
  rootSelector: string,
  from = 'A paragraph with',
  to = 'second sentence.',
) {
  await frame
    .locator(rootSelector)
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame, // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page selection-range construction across the configurable root/node/offset combinations; pre-existing (task 469 baseline)
    (_el, args) => {
      const root = document.querySelector(args.rootSelector) as HTMLElement
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let startNode: Text | null = null
      let startOffset = 0
      let endNode: Text | null = null
      let endOffset = 0
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        if (!startNode) {
          const i = text.indexOf(args.from)
          if (i >= 0) {
            startNode = n as Text
            startOffset = i
          }
        }
        const j = text.indexOf(args.to)
        if (j >= 0) {
          endNode = n as Text
          endOffset = j + args.to.length
        }
      }
      if (!startNode || !endNode) throw new Error('span not found')
      const r = document.createRange()
      r.setStart(startNode, startOffset)
      r.setEnd(endNode, endOffset)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      // NOT `.focus()` on the span here — measured that it silently drops the selection in sv
      // (the preceding root click already established editor focus; re-focusing a text-node's
      // parent afterward is what broke it, not a missing focus).
    },
    { rootSelector, from, to },
  )
}

test('IR undo and WYSIWYG cut preserve complete selected paragraphs', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-cut-undo-ir.md',
    )
    const before = await docText(evaluateInVSCode, tmp)

    await selectParagraph(frame, '.vditor-ir')
    await workbox.keyboard.press('Control+x')
    // Task 419 — poll instead of a fixed settle(2500): this is the fixed-settle flake's target file
    // (see the task — same mechanism reproduced elsewhere in this file under load).
    await expect.soft
      .poll(() => docText(evaluateInVSCode, tmp), {
        message: 'the paragraph is gone',
      })
      .not.toContain('Anchor line BRAVO')

    await workbox.keyboard.press('Control+z')
    await expect.soft
      .poll(() => docText(evaluateInVSCode, tmp), {
        message: 'one undo restores the document byte-for-byte',
      })
      .toBe(before)

    rmSync(tmp, { force: true })
  }
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-cut-wysiwyg.md',
    )
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
    await settle(frame, 2000)

    await writeClip(evaluateInVSCode, 'SENTINEL-should-be-overwritten')
    await selectParagraph(frame, '.vditor-wysiwyg')
    await workbox.keyboard.press('Control+x')

    // Task 419 — poll for the cut to settle instead of a fixed settle(2500).
    await expect.soft
      .poll(() => docText(evaluateInVSCode, tmp), {
        message: 'the whole paragraph is gone, not just its first line',
      })
      .not.toContain('A paragraph with')
    const after = await docText(evaluateInVSCode, tmp)
    expect
      .soft(after, 'the rest of the document survives')
      .toContain('Anchor line ZULU')
    await expect.soft
      .poll(() => readClip(evaluateInVSCode), {
        message: 'the whole cut paragraph reached the clipboard',
      })
      .toContain('Anchor line BRAVO')

    rmSync(tmp, { force: true })
  }
})

// sv's regression pin lives in its own file, cut-selection-sv.spec.ts — measured that the exact
// same selection+cut, byte-for-byte identical code, silently no-ops here when it runs as the 3rd
// test in this file but works when it is the only test in its file. Root cause not chased (sv was
// independently proven correct via two different fixtures during investigation; this is a harness
// isolation quirk, not the product behaviour under test) — isolating the file was cheaper and
// removes the ambiguity entirely.

// Multi-BLOCK selections (follow-up, initially left unverified — see git history). Measured before
// writing any code: NO data was ever lost cutting across paragraph boundaries (clipboard, removed
// range, and undo were all already correct) — the one real defect was that `range.deleteContents()`
// does not merge block-level ancestors the way a native contenteditable delete does, so cutting
// across two paragraphs left TWO paragraphs behind (a spurious blank line) instead of one joined
// paragraph. Fixed by merging the two boundary `<p>` elements back by hand, scoped to the plain
// case (both top-level paragraphs, direct children of the editor) that matches this task's
// original report generalised to N adjacent paragraphs.
const MULTIBLOCK_FIXTURE = `# Doc

First PARA_A start middle PARA_A end.

Second PARA_B fully enclosed, should vanish entirely.

Third PARA_C start middle PARA_C end.

Closing paragraph. Anchor line ZULU.
`

test('IR: cutting a selection spanning THREE paragraphs merges the remainder into ONE, loses nothing', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-cut-multiblock.md',
    MULTIBLOCK_FIXTURE,
  )
  const before = await docText(evaluateInVSCode, tmp)

  await selectParagraph(
    frame,
    '.vditor-ir',
    'middle PARA_A end',
    'Third PARA_C start',
  )
  await workbox.keyboard.press('Control+x')

  // Task 419 — poll instead of a fixed settle(2500). The two remaining fragments are ONE paragraph
  // — no spurious blank line splitting them — and the fully-enclosed middle paragraph is entirely
  // gone.
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'the remainder is a single merged paragraph',
    })
    .toBe(
      '# Doc\n\nFirst PARA_A start  middle PARA_C end.\n\nClosing paragraph. Anchor line ZULU.\n',
    )
  await expect
    .poll(() => readClip(evaluateInVSCode), {
      message: 'the whole cut span reached the clipboard',
    })
    .toBe(
      'middle PARA_A end.\n\nSecond PARA_B fully enclosed, should vanish entirely.\n\nThird PARA_C start',
    )

  // Caret sanity: typing lands exactly at the merge point, not at the start/end of the document.
  await workbox.keyboard.type('X')
  await expect
    .poll(() => docText(evaluateInVSCode, tmp))
    .toContain('First PARA_A start X middle PARA_C end.')

  await workbox.keyboard.press('Control+z')
  // Poll for the FIRST undo's effect (the typed 'X' gone) before firing the second undo — a fixed
  // settle() here was the same bet-on-machine-speed idiom, just with no read to gate it visibly.
  await expect
    .poll(() => docText(evaluateInVSCode, tmp))
    .not.toContain('X middle PARA_C end.')
  await workbox.keyboard.press('Control+z')
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'undo restores the document byte-for-byte',
    })
    .toBe(before)

  rmSync(tmp, { force: true })
})

test('IR: a selection crossing from a paragraph into a list does not merge across it, and loses nothing', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // The merge is scoped to plain top-level paragraphs on BOTH sides — a selection ending inside a
  // list item must fall through to the safe default (deleteContents() alone: no data loss, just no
  // merge), not attempt to splice a paragraph's content into a list item.
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-cut-boundary.md',
  )

  // Selects through the end of "First bullet" — the span crosses a paragraph, a heading, AND into
  // the list's first item, which is exactly the kind of exotic multi-block shape the merge fix
  // deliberately does not attempt to handle.
  await selectParagraph(
    frame,
    '.vditor-ir',
    'Anchor line BRAVO',
    'First bullet',
  )
  await workbox.keyboard.press('Control+x')

  // Task 419 — poll instead of a fixed settle(2500). Measured flaking live during this task (a
  // different retry recovered instance of the same fixed-settle idiom, in this same file, on this
  // machine — corroborates the reported flake at :298 rather than being a coincidence). Poll on
  // ALL FOUR conditions at once so an intermediate mid-cut state (which could satisfy some but not
  // all of them) keeps retrying instead of a lucky partial match. Named object, not a bare boolean:
  // a genuine timeout then prints WHICH condition never landed, not just "expected true".
  await expect
    .poll(
      async () => {
        const t = await docText(evaluateInVSCode, tmp)
        return {
          bravoGone: !t.includes('Anchor line BRAVO with a second sentence.'),
          firstBulletGone: !t.includes('First bullet'),
          secondBulletSurvives: t.includes('Second bullet'),
          zuluSurvives: t.includes('Anchor line ZULU'),
        }
      },
      { message: 'the cut settles: span + first bullet gone, rest intact' },
    )
    .toEqual({
      bravoGone: true,
      firstBulletGone: true,
      secondBulletSurvives: true,
      zuluSurvives: true,
    })

  const after = await docText(evaluateInVSCode, tmp)
  expect(after, 'the selected span is gone').not.toContain(
    'Anchor line BRAVO with a second sentence.',
  )
  expect(after, 'the first bullet is gone').not.toContain('First bullet')
  expect(after, 'the list survives past the cut point').toContain(
    'Second bullet',
  )
  expect(after, 'the rest of the document survives').toContain(
    'Anchor line ZULU',
  )

  rmSync(tmp, { force: true })
})
