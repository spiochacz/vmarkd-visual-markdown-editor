import type { Page } from '@playwright/test'

// CDP-driven synthetic IME composition (task 516 C5, = task 455's highest-value dark item —
// grepped 2026-08 for `imeSetComposition` across the whole suite before this file: zero hits).
//
// FIDELITY CAVEAT — repeat this in every consuming spec's own comment too, per the brief: this
// drives the BROWSER's real composition machinery via CDP `Input.imeSetComposition` (sets/updates
// the pre-edit) + `Input.insertText` (the commit) — genuine compositionstart/compositionupdate/
// compositionend + beforeinput/input events fire, unlike hand-dispatched `new CompositionEvent(…)`
// objects (which never touch the browser's internal IME/selection/range state at all, so they
// can't reproduce a commit-time corruption like the one this file's specs pin). It is still NOT a
// real OS-level IME: a native IME's IPC/candidate-window timing isn't replicated by CDP, which is
// why task 516's manual QA checklist keeps a real-OS-IME item regardless of this coverage.
export async function composeAndCommit(
  page: Page,
  opts: { preedit: string; committed: string; settleMs?: number },
): Promise<void> {
  const settle = opts.settleMs ?? 150
  const client = await page.context().newCDPSession(page)
  await client.send('Input.imeSetComposition', {
    text: opts.preedit,
    selectionStart: opts.preedit.length,
    selectionEnd: opts.preedit.length,
  })
  await page.waitForTimeout(settle)
  // Chromium's commit path for an ACTIVE composition: insertText replaces the current
  // composition (fires a final compositionupdate with the committed text, then compositionend) —
  // it is not a separate insertText-after-cancel. Confirmed by listening to the composition/input
  // events while building this helper (see the spec files' header comments for the trace).
  await client.send('Input.insertText', { text: opts.committed })
  await page.waitForTimeout(settle)
}
