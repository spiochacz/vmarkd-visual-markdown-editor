// PROBE, not fixed here (task 516 space-drop thread) — pins a REAL, general, real-webview-only
// bug: typing a markdown heading marker (`# `) followed by a word and a space, in one continuous
// keystroke stream, DROPS the space after the first word. `# Untitled journey` typed character-
// by-character at 60ms/char lands as `# Untitledjourney` in the actual TextDocument.
//
// Real-VS-Code only, by construction: does NOT reproduce anywhere in the chromium harness (10
// cells tried there: heading vs plain text x empty vs non-empty document, slower delays, the
// space as a separate keypress, the exact phrase, zero settle after boot — every space survived
// every time). So this is specific to something in the real webview pipeline the harness can't
// replicate — VS Code's injected CSS, the custom-editor CSP/resource pipeline, or a first-input
// timing interaction with a main.ts-only observer (focus-restore.ts, caret-scroll.ts, …) that
// the chromium harness doesn't wire.
//
// SCOPE, established with controls (a throwaway probe spec, deleted after use — see
// tasks/516-qa-journey-coverage-plan.md's "Open thread" for the narrative):
//   - General, not untitled-specific: reproduces identically on an ordinary `file:` document.
//   - Not empty-doc-specific: reproduces the same into a document that already has a paragraph
//     (typed into a fresh line after existing content).
//   - Not a boot-timing race: reproducing with an extra 2000ms settle after the editor mounts,
//     before typing starts, changes nothing.
//   - Not delay-sensitive: 150ms/char reproduces identically to 60ms/char.
//   - REFUTES the prepaint-scroll-capture hypothesis (media-src/e2e/prepaint-scroll.spec.ts's
//     family — the teaser's scroll-capture handler reads Space as PageDown, which would produce
//     exactly this symptom if a stray listener survived past editor mount): the teaser's own
//     `__vmarkdHadTeaser` flag was FALSE for both documents tested (a second doc opened later in
//     the same VS Code session reuses the already-warm extension host, so no teaser fires at
//     all) — the bug reproduced in BOTH regardless, so it does not depend on a teaser existing.
//   - IS heading-specific, not a general continuous-typing artifact: `alpha beta` (no leading
//     `#`) typed the SAME way (continuous type(), 60ms/char, into a blank document) lands intact
//     — no drop. Only the heading-promotion moment loses a character.
//   - A discrete `.press('Space')` right after typing `#` separately (NOT part of one continuous
//     type() stream) does NOT reproduce it — "# " + Space + "heading" typed as three separate
//     actions with settles between them lands as `# heading`, clean. So the bug needs the space
//     to arrive in the SAME tight keystroke burst as the character that triggers `# ` -> heading
//     promotion — consistent with a caret-restore race against the DOM rebuild
//     (SpinVditorIRDOM's `blockElement.innerHTML = html` swap) that fires at that exact moment,
//     though this spec does not patch product code to confirm that last step.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

type Vs = typeof import('vscode')

test('typing "# Untitled journey" char-by-char drops the space after the first word (task 519, pinned broken)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const target = path.join(
    tmpdir(),
    `vmarkd-heading-space-drop-${Date.now()}.md`,
  )
  writeFileSync(target, '')

  try {
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [target] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 300)

    await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })
    await settle(frame, 200)
    await workbox.keyboard.type('# Untitled journey', { delay: 60 })
    await settle(frame, 500)

    // Read the real, saved-doc-relevant TextDocument text (not just getValue()) — the same
    // discipline as checkbox-toggle.spec.ts, since this is what a user's file actually ends up
    // containing.
    const text = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '<not found>',
      [target] as [string],
    )
    // Pins the OBSERVED (buggy) value. If this ever starts failing because the space
    // survives, that is the fix landing — update this assertion deliberately, don't just widen
    // it to keep the spec green.
    expect(text).toBe('# Untitledjourney\n')
  } finally {
    rmSync(target, { force: true })
  }
})
