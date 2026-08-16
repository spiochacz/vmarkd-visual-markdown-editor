import {
  type EvaluateInVSCode,
  docText,
  ev,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// Task 392 — pasting a URL produces a markdown link.
//
// The REAL clipboard and a REAL Ctrl+V, because that is the mechanism under test: VS Code's webview
// clipboard bridge is what delivers the paste, and a synthetic ClipboardEvent would prove nothing
// about it. Asserted against the document ON DISK — the markdown is what the user keeps.
//
// Half of this was already Vditor's: with text selected it wraps the selection. That half is
// asserted here too, as a guard — it is easy to break while adding the other one.
//
// Task 450 — collapsed from 8 test()s (one VS Code boot each, task 448) into 2: the 6 IR-mode
// cases share one boot(), the 2 mode-parity cases (wysiwyg/sv) share another. Each case still
// calls `boot()` — a close-all + reopen against its OWN fresh tmp file, seconds, not a new VS Code
// launch — because each needs different starting content/clipboard/selection; that reopen is the
// technique the task calls out explicitly for exactly this shape. `expect.soft()` throughout, and
// every poll that could otherwise throw is `.catch()`-guarded, so one case's failure/timeout can't
// abort the cases after it (verified: see the task file — an assertion was deliberately broken and
// the other cases' soft assertions still ran and reported).

// `vmarkd.paste.urlAsLink` is toggled off then back to undefined mid-test (inside a try/finally, so
// the next case in the SAME test sees the right default) — that inline reset must stay. This is a
// belt-and-suspenders safety net for the case the settings-helpers.ts header warns about: a test
// timeout aborting execution before the `finally` block runs.
useSettingsRestore(test, ['vmarkd.paste.urlAsLink'])

const writeClip = (evaluateInVSCode: EvaluateInVSCode, text: string) =>
  ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.env.clipboard.writeText(args[0])
    },
    text,
  )

let bootCount = 0

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  name: string,
  body: string,
) {
  // A unique path per call — VS Code keeps a TextDocument alive per fsPath, so a reused name hands
  // the next open the previous one's in-memory content whatever is written to disk. Called once
  // per case (see header) — this reopen, not a fresh VS Code launch, is what gives each case a
  // clean starting document.
  const tmp = path.join(tmpdir(), `${process.pid}-${bootCount++}-${name}`)
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

/** Collapsed caret right after `anchor`, or a selection of `select` when given. */
async function caretAt(
  frame: ReturnType<typeof wf>,
  anchor: string,
  select?: string,
) {
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [needle, sel] = args as [string, string]
      const root = document.querySelector('.vditor-ir') as HTMLElement
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? ''
        const i = text.indexOf(needle)
        if (i < 0) continue
        const r = document.createRange()
        if (sel) {
          const j = text.indexOf(sel)
          if (j < 0) continue
          r.setStart(n as Text, j)
          r.setEnd(n as Text, j + sel.length)
        } else {
          r.setStart(n as Text, i + needle.length)
          r.collapse(true)
        }
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(n.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`anchor ${needle} not found`)
    },
    [anchor, select ?? ''] as [string, string],
  )
}

const URL = 'https://example.com/a-paper'

// Best-effort poll: a timeout here must not throw (it would abort every case AFTER it in the
// shared test() below) — the `expect.soft()` calls that follow each call site report the real
// pass/fail with full diagnostics regardless of whether this settled in time.
async function settleDoc(
  evaluateInVSCode: EvaluateInVSCode,
  tmp: string,
  contains: string,
  message: string,
) {
  // Explicit 5s (not the inherited 20s default): this is only a settle heuristic backed by the
  // hard-checked `expect.soft` immediately after each call site, so a slow/failing case shouldn't
  // get to spend a full 20s here on top of the shared test's own timeout budget (see below).
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), { message, timeout: 5_000 })
    .toContain(contains)
    .catch(() => {
      /* deliberate — see the function comment above */
    })
}

test('paste-URL core behaviours (IR)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // 6 cases, each with a swallowed `settleDoc` poll that can legitimately eat its own timeout on a
  // genuine failure, plus its own `boot()`. At the default 90s test timeout, 3-4 failing cases
  // could exhaust the budget and have Playwright kill the test mid-loop — silently dropping the
  // soft-failure reports for every case after that point, the exact failure-isolation loss task
  // 450 requires NOT to happen. Bounded to 5 min so all 6 cases always get to report.
  test.setTimeout(300_000)
  // Case 1 — no selection: the URL becomes both the link text and the destination.
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-url.md',
      '# Notes\n\nSee also: \n',
    )
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'See also:')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      `[${URL}](${URL})`,
      'no-selection paste becomes a link',
    )
    expect
      .soft(
        await docText(evaluateInVSCode, tmp),
        'no-selection: the URL is both text and destination',
      )
      .toContain(`[${URL}](${URL})`)
    rmSync(tmp, { force: true })
  }

  // Case 2 — over a selection: Vditor's own behaviour (wraps the selection), pinned so the new
  // no-selection branch above cannot swallow it.
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-url-sel.md',
      '# Notes\n\nRead the paper today.\n',
    )
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'the paper', 'the paper')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      `[the paper](${URL})`,
      'over-selection paste keeps the selection as link text',
    )
    expect
      .soft(
        await docText(evaluateInVSCode, tmp),
        'over-selection: the selection became the link text',
      )
      .toContain(`[the paper](${URL})`)
    rmSync(tmp, { force: true })
  }

  // Case 3 — a data-loss guard, not a feature test: Lute's IsValidLinkDest and ours disagree on
  // `mailto:` — reject it here, and the previous cut of this patch replaced the selection with a
  // link built from the clipboard. Deliberately does NOT assert the selection survives whole
  // (pasting plain text over a selection mangles it in stock Vditor too — task 393, unrelated).
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-mailto-sel.md',
      '# Notes\n\nRead the paper today.\n',
    )
    await writeClip(evaluateInVSCode, 'mailto:me@example.com')
    await caretAt(frame, 'the paper', 'the paper')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      'mailto:me@example.com',
      'mailto paste settles',
    )
    const after = await docText(evaluateInVSCode, tmp)
    expect
      .soft(
        after,
        'mailto: the clipboard was pasted as text, not turned into a link of its own',
      )
      .not.toContain('[mailto:me@example.com](')
    expect
      .soft(after, 'mailto: the address itself did arrive')
      .toContain('mailto:me@example.com')
    rmSync(tmp, { force: true })
  }

  // Case 4 — the guard that matters most: a false positive would silently rewrite an ordinary
  // paste.
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-text.md',
      '# Notes\n\nSee also: \n',
    )
    await writeClip(evaluateInVSCode, 'just some words')
    await caretAt(frame, 'See also:')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      'just some words',
      'ordinary-text paste settles',
    )
    const after = await docText(evaluateInVSCode, tmp)
    // No leading space in the expectation: markdown serialization drops the fixture's trailing
    // space, so the pasted text lands flush against the colon. What matters is the second
    // assertion — the text was NOT turned into a link.
    expect.soft(after, 'ordinary text: it arrived').toContain('just some words')
    expect
      .soft(after, 'ordinary text: it was not turned into a link')
      .not.toContain('](')
    rmSync(tmp, { force: true })
  }

  // Case 5 — code is excluded upstream (the code branch runs before the text branch), but
  // "excluded by construction" is not evidence — a URL turning into markdown inside a code block
  // would be corruption.
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-code.md',
      '# Notes\n\n```sh\ncurl \n```\n',
    )
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'curl')
    await workbox.keyboard.press('Control+v')
    await settleDoc(evaluateInVSCode, tmp, URL, 'code-block paste settles')
    const after = await docText(evaluateInVSCode, tmp)
    expect
      .soft(after, 'in a code block: the URL landed as plain text')
      .toContain(URL)
    expect
      .soft(after, 'in a code block: it was NOT turned into a link')
      .not.toContain(`[${URL}](`)
    rmSync(tmp, { force: true })
  }
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('vmarkd')
      .update('paste.urlAsLink', false, true)
  })
  try {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-url-sel-off.md',
      '# Notes\n\nRead the paper today.\n',
    )
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'the paper', 'the paper')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      URL,
      'setting-off over-selection paste settles',
    )
    const after = await docText(evaluateInVSCode, tmp)
    expect
      .soft(
        after,
        'setting OFF: the selection was replaced by the bare URL, not wrapped',
      )
      .not.toContain(`[the paper](${URL})`)
    expect.soft(after, 'setting OFF: the URL itself did arrive').toContain(URL)
    rmSync(tmp, { force: true })
  } finally {
    // Reset before the next case (and any spec sharing this VS Code instance) — a leaked `false`
    // would silently disable a shipped feature for everything after. `undefined` REMOVES the
    // override rather than pinning an explicit `true`, so later specs still see the real shipped
    // default (true) instead of a value this spec happened to set.
    await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('paste.urlAsLink', undefined, true)
    })
  }
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-url-sel-on.md',
      '# Notes\n\nRead the paper today.\n',
    )
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'the paper', 'the paper')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      `[the paper](${URL})`,
      'setting-on over-selection paste settles',
    )
    expect
      .soft(
        await docText(evaluateInVSCode, tmp),
        'setting ON (explicit, not just the default): the selection wraps as a link',
      )
      .toContain(`[the paper](${URL})`)
    rmSync(tmp, { force: true })
  }

  // Case 6 — pasting is a reflex, so undoing it must be one too: a link that needs two undos is
  // worse than the convenience is worth.
  {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      'vmarkd-paste-undo.md',
      '# Notes\n\nSee also: \n',
    )
    const before = await docText(evaluateInVSCode, tmp)
    await writeClip(evaluateInVSCode, URL)
    await caretAt(frame, 'See also:')
    await workbox.keyboard.press('Control+v')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      `[${URL}](${URL})`,
      'undo: paste settles',
    )
    expect
      .soft(await docText(evaluateInVSCode, tmp), 'undo: the link landed first')
      .toContain(`[${URL}](${URL})`)

    await workbox.keyboard.press('Control+z')
    await settleDoc(
      evaluateInVSCode,
      tmp,
      before,
      'undo: restores byte-for-byte',
    )
    expect
      .soft(
        await docText(evaluateInVSCode, tmp),
        'undo: one undo restores the document byte-for-byte',
      )
      .toBe(before)
    rmSync(tmp, { force: true })
  }
})

test('pasting a URL over an existing link replaces only its href (IR)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-paste-url-existing-link.md',
    '[old label](https://old.example.com)\n',
  )
  await writeClip(evaluateInVSCode, 'https://new.example.com')
  await caretAt(frame, 'old label', 'old label')
  await workbox.keyboard.press('Control+v')
  await settleDoc(
    evaluateInVSCode,
    tmp,
    '[old label](https://new.example.com)',
    'existing-link href replacement settles',
  )
  const after = await docText(evaluateInVSCode, tmp)
  expect
    .soft(after, 'existing-link paste keeps the label and replaces href')
    .toContain('[old label](https://new.example.com)')
  expect
    .soft(after, 'existing-link paste removes the old href')
    .not.toContain('https://old.example.com')
  rmSync(tmp, { force: true })
})

// The rewrite happens before Vditor branches on the mode, so it is mode-agnostic by construction —
// which is a claim, not evidence. WYSIWYG and split get the same assertion as IR.
//
// task 450 — measured, not assumed: this is the ONE case in this file where the task's own escape
// hatch ("the mode-parameterised leg can stay separate if it needs a reopen") applies. Looping both
// modes through a second `boot()` inside a single shared test() reproduced a real, consistent
// failure across 3 independent runs — the second `boot()` call's `.vditor-ir` wait timed out
// (`locator resolved to hidden <div class="vditor-ir">`), because closing the first mode's panel
// and opening a fresh one back-to-back races VS Code's own panel disposal (a second, still-closing
// webview iframe left the locator ambiguous/hidden — the same class of issue
// `prerender-first-open.spec.ts` already documents and guards with `.last()`). Rather than chase a
// disposal race under this task's time budget, kept these as 2 separate test()s (8 → 3 total for
// this file, not 8 → 2 — still within the task's own suggested "2–3" range) — each is its own
// clean boot, no back-to-back reopen, no race.
for (const mode of ['wysiwyg', 'sv'] as const) {
  test(`pasting a URL works the same in ${mode}`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    const { tmp, frame } = await boot(
      evaluateInVSCode,
      workbox,
      `vmarkd-paste-url-${mode}.md`,
      '# Notes\n\nSee also: \n',
    )
    await frame.locator('body').evaluate((_el, target) => {
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
        .querySelector(`button[data-mode="${target}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, mode)
    await frame.locator(`.vditor-${mode}`).first().waitFor({ timeout: 30_000 })
    await settle(frame, 2500)

    await writeClip(evaluateInVSCode, URL)
    // Click into the surface, then put the caret at the end of the anchor line.
    await frame
      .locator(`.vditor-${mode}`)
      .first()
      .click({ position: { x: 4, y: 4 } })
    await stickySelection(
      frame,
      (_el, sel) => {
        const root = document.querySelector(sel as string) as HTMLElement
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = (n.textContent ?? '').indexOf('See also:')
          if (i < 0) continue
          const r = document.createRange()
          r.setStart(n as Text, i + 'See also:'.length)
          r.collapse(true)
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          ;(n.parentElement as HTMLElement | null)?.focus()
          return
        }
        throw new Error('anchor not found')
      },
      `.vditor-${mode}`,
    )
    await workbox.keyboard.press('Control+v')

    await expect
      .poll(() => docText(evaluateInVSCode, tmp), {
        message: `${mode}: paste settles`,
      })
      .toContain(`[${URL}](${URL})`)

    rmSync(tmp, { force: true })
  })
}
