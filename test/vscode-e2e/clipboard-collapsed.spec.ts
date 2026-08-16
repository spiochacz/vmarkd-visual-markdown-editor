import {
  type EvaluateInVSCode,
  docText,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 385 — Ctrl+C / Ctrl+X with nothing selected.
//
// Both defects were probe-confirmed in task 191 (`media-src/e2e/copy-cut-probes.spec.ts`) and left
// in place then. They are the shape of the report "copy/paste doesn't work": a collapsed Ctrl+C in
// split mode WIPED the clipboard (sv's copy handler wrote the empty selection to text/plain with no
// guard), and a collapsed Ctrl+X was a stealth backspace (cutEvent ran execCommand("delete")
// unconditionally, even after the copy half had bailed out).
//
// This asserts the VS Code contract instead: a collapsed copy takes the current line, a collapsed
// cut removes the line it copied, and neither ever destroys the clipboard or a character.
//
// Real keystrokes and the real VS Code clipboard — a synthetic ClipboardEvent proves nothing here,
// because the whole defect is in what the handlers do to the SYSTEM clipboard.
const SRC = path.join(__dirname, 'fixtures', 'torture.md')

async function open(evaluateInVSCode: EvaluateInVSCode, file: string) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
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

const readClip = (evaluateInVSCode: EvaluateInVSCode) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode')) => vscode.env.clipboard.readText(),
    [] as unknown as [string],
  ) as Promise<string>

const writeClip = (evaluateInVSCode: EvaluateInVSCode, text: string) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.env.clipboard.writeText(args[0])
    },
    [text] as [string],
  )

/** Collapsed caret in the middle of the paragraph holding `anchor`. */
async function caretIn(
  frame: ReturnType<typeof wf>,
  mode: string,
  anchor: string,
  offset = anchor.length,
) {
  await frame
    .locator(mode)
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [sel, needle, offset] = args as [string, string, number]
      const p = [...document.querySelectorAll(`${sel} p`)].find((x) =>
        x.textContent?.includes(needle),
      ) as HTMLElement | undefined
      if (!p) throw new Error(`anchor ${needle} not found`)
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(needle)
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n as Text, i + offset)
          r.collapse(true)
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          p.focus()
          return
        }
      }
      throw new Error('anchor text node not found')
    },
    [mode, anchor, offset] as [string, string, number],
  )
}

let bootCount = 0
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  name: string,
) {
  // A UNIQUE path per test. VS Code keeps a TextDocument alive per fsPath, so reusing a name
  // hands the next test the previous one's in-memory content however the file on disk is rewritten
  // — which is why these passed alone and failed whenever another test had run first.
  const tmp = path.join(TEMP_DIR, `${process.pid}-${bootCount++}-${name}`)
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  // Close what earlier tests left open. Every test here drives the webview by querying
  // `.vditor-ir` inside the frame, so a stale vMarkd tab from a previous test is another editor
  // answering to the same selector — which is exactly how these passed alone and failed in the
  // tier run.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  return { tmp, frame }
}

test('collapsed Ctrl+C copies a line and Ctrl+X cuts its complete block', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-clip-copy.md',
    )
    await writeClip(evaluateInVSCode, 'SENTINEL-do-not-lose-me')
    await caretIn(frame, '.vditor-ir', 'Anchor line BRAVO')
    await workbox.keyboard.press('Control+c')

    // Task 419 — poll the actual post-condition (the clipboard write landing) instead of a fixed
    // settle(): the previous fixed 1500ms bet on machine speed and flaked under load (see the task
    // for the reproduction data). expect.poll retries the read until it matches or the project's
    // default expect timeout (20s, generous headroom over the 1500ms this replaces) is exhausted, so
    // it fails fast and clearly if the copy genuinely never lands.
    await expect.soft
      .poll(() => readClip(evaluateInVSCode), {
        message: 'the current line reached the clipboard',
      })
      .toContain('Anchor line BRAVO')
    const clip = await readClip(evaluateInVSCode)
    // …and the clipboard was never wiped on the way (the split-mode defect).
    expect
      .soft(clip, 'the clipboard was not clobbered with an empty string')
      .not.toBe('')
    rmSync(tmp, { force: true })
  }
  // These two were `test.fixme` and were blamed on a harness flake. That diagnosis was WRONG, and the
  // instrumentation that settled it is worth keeping in mind: there was never a stale webview (one
  // `iframe.webview`, one tab, every time) and the live selection was always exactly what the test
  // set. The editor really was eating a character — VS Code's webview clipboard bridge answers Ctrl+X
  // by calling `document.execCommand("cut")` from a host-message handler, which leaves the selection
  // reporting `collapsed === false`, so the guard read "not collapsed" and let the delete through.
  // The intent is now recorded on keydown instead. See tasks/385.
  // PROBE-15's defect, stated as a contract. Vditor ran `execCommand("delete")` on every cut, even
  // when the copy half had bailed out on the empty selection, so Ctrl+X with nothing selected was a
  // silent one-character backspace. It now removes the complete current block.
  //
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-clip-cut.md',
    )
    const before = await docText(evaluateInVSCode, tmp)
    expect.soft(before).toContain('Anchor line BRAVO with a second sentence.')

    await caretIn(frame, '.vditor-ir', 'Anchor line BRAVO')
    await workbox.keyboard.press('Control+x')

    await expect.soft
      .poll(() => docText(evaluateInVSCode, tmp), {
        message: 'the current block is removed',
      })
      .not.toContain('Anchor line BRAVO with a second sentence.')
    await expect.soft
      .poll(() => readClip(evaluateInVSCode), {
        message: 'the complete collapsed-cut block reaches the clipboard',
      })
      .toBe(
        'A paragraph with **bold**, *italic*, `inline code`, and a [link](https://example.com).\n' +
          'Anchor line BRAVO with a second sentence.',
      )
    const after = await docText(evaluateInVSCode, tmp)
    expect
      .soft(after, 'no fragment of the cut block remains')
      .not.toContain('Anchor line BRAVO with a second sentence.')
    expect
      .soft(after, 'the block prefix is removed too')
      .not.toContain('A paragraph with **bold**')
    expect.soft(after, 'surrounding content remains').not.toBe(before)
    rmSync(tmp, { force: true })
  }
})

test('formatted text still survives a later collapsed Ctrl+X as exact block Markdown', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Cross-feature regression: task 506 expands a collapsed caret to the word and task 505 routes
  // Ctrl+B through VS Code exactly once. A fresh collapsed caret in that newly edited paragraph
  // must still let task 385 cut the COMPLETE Markdown block — never rendered IR fragments.
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-format-then-cut.md',
  )
  await caretIn(frame, '.vditor-ir', 'BRAVO', 2)
  await workbox.keyboard.press('Control+b')

  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'the word-under-caret formatting reaches the Markdown document',
    })
    .toContain('Anchor line **BRAVO** with a second sentence.')

  // Formatting deliberately leaves its word selection alive so the next Ctrl+B toggles it off.
  // A normal click/caret move changes that to the real collapsed-cut path we are guarding here.
  await caretIn(frame, '.vditor-ir', 'second sentence', 3)
  await workbox.keyboard.press('Control+x')
  await expect
    .poll(() => readClip(evaluateInVSCode), {
      message: 'cut copies the formatted Markdown, not rendered IR text',
    })
    .toBe(
      'A paragraph with **bold**, *italic*, `inline code`, and a [link](https://example.com).\n' +
        'Anchor line **BRAVO** with a second sentence.',
    )
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'cut removes the formatted paragraph as one block',
    })
    .not.toContain('Anchor line **BRAVO** with a second sentence.')
  rmSync(tmp, { force: true })
})

// task 387 — FIXED. Cutting a selected multi-line paragraph in IR used to leave its LAST line
// behind: measured 85 of ~96 characters removed, "Anchor line BRAVO with a second sentence."
// still in the document. Deterministic on every retry, and pre-existing (not a regression from
// the collapsed-cut fix above).
//
// Root cause, measured (shared with task 393's paste bug, instrumented there): VS Code's webview
// clipboard bridge answers Ctrl+X by calling document.execCommand("cut") from a host-message
// handler, so the guarded execCommand("delete") above ran WITH execCommand already on the call
// stack — genuinely re-entrant, and Chromium silently REFUSES a re-entrant execCommand (proved by
// forcing it synchronous: returns false, nothing deleted). fixCut()'s setTimeout deferral let it
// fire eventually instead, a macrotask later, against whatever the selection had collapsed to —
// `deleteContentBackward`, not the cut range.
//
// Fixed by `patchCutDeleteSync` (esbuild-shared.mjs): a synchronous `range.deleteContents()`
// (never touches execCommand's recursion guard) followed by re-driving Vditor's own input pipeline
// by hand — `IRInput(vditor, range)` / `input(vditor, range)`, the exact pattern this same
// vendored file already uses elsewhere (fixCodeBlock's Enter handler) for "I mutated the DOM
// programmatically, now make Vditor treat it like a real edit."
test('a real selection still cuts normally', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // The control that proves the collapsed guard did not disable cut altogether.
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-clip-cut-real.md',
  )
  await writeClip(evaluateInVSCode, 'SENTINEL-should-be-overwritten')
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-ir p')].find((x) =>
        x.textContent?.includes('Anchor line BRAVO'),
      ) as HTMLElement
      const r = document.createRange()
      r.selectNodeContents(p)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p.focus()
    },
    null,
  )
  await workbox.keyboard.press('Control+x')

  // Task 419 — this is the reported flake (fails on attempt 1, passes on retry, reproducibly, even
  // on a quiet tree). Root cause: a fixed settle(2500) bet on the cut having fully landed by then,
  // which loses under load variance. Poll instead: retry the read until the document reaches its
  // final shape (both the removed paragraph AND the survivor text present at once — a partial
  // intermediate state, e.g. mid-cut, would fail one half of this and keep polling). Named object,
  // not a bare boolean: on a genuine timeout Playwright prints the received object, so the failure
  // names WHICH condition never landed instead of just "expected true, received false".
  await expect
    .poll(
      async () => {
        const t = await docText(evaluateInVSCode, tmp)
        return {
          bravoGone: !t.includes('Anchor line BRAVO with a second sentence.'),
          firstLineGone: !t.includes('A paragraph with'),
          zuluSurvives: t.includes('Anchor line ZULU'),
        }
      },
      {
        message: 'the cut settles: paragraph gone, rest of the document intact',
      },
    )
    .toEqual({ bravoGone: true, firstLineGone: true, zuluSurvives: true })

  const after = await docText(evaluateInVSCode, tmp)
  // The whole paragraph is gone — not 85 of 96 characters, all of it. A `toContain` guard alone
  // would pass on the old partial-cut result too (it also stopped containing the FULL sentence),
  // so also assert nothing of the paragraph's first line survives.
  expect(after, 'a selected block is still cut out').not.toContain(
    'Anchor line BRAVO with a second sentence.',
  )
  expect(
    after,
    'no stray fragment of the cut paragraph is left behind',
  ).not.toContain('A paragraph with')
  expect(after, 'the rest of the document survives').toContain(
    'Anchor line ZULU',
  )
  // The clipboard write and the document mutation are two independent host round-trips — poll it
  // separately rather than assume it landed in step with the document read above.
  await expect
    .poll(() => readClip(evaluateInVSCode), {
      message: 'the whole cut paragraph reached the clipboard',
    })
    .toBe(
      'A paragraph with **bold**, *italic*, `inline code`, and a [link](https://example.com).\n' +
        'Anchor line BRAVO with a second sentence.',
    )
  rmSync(tmp, { force: true })
})
