// FIXED (task 519). Was: typing a markdown heading marker (`# `) followed by a word and a space,
// in one continuous keystroke stream, DROPPED the space after the first word. `# Untitled
// journey` typed character-by-character at 60ms/char landed as `# Untitledjourney` in the actual
// TextDocument. Now asserts the CORRECT text.
//
// ROOT CAUSE, confirmed by wrapping Lute's own entry points at runtime (real webview) — see
// space-drop-caller-probe.spec.ts: the space was never eaten as a keystroke. It lands in the DOM,
// then a LATER `SpinVditorIRDOM` receives `<span class="vditor-ir__marker
// vditor-ir__marker--heading"># Untitled <wbr></span>` — the entire typed run sitting INSIDE the
// heading-marker span — and correctly re-splits that into marker `# ` + text `Untitled`,
// consuming the boundary space as the delimiter. So every keystroke after `# ` promotion was
// landing INSIDE the marker span instead of as a sibling of it.
//
// That misplacement is a known, already-half-fixed Chrome contenteditable bug in vendored Vditor:
// `setRangeByWbr` (media-src/node_modules/vditor/src/ts/util/selection.ts) inserts a ZWSP anchor
// after a collapsed caret restore to give Chrome's native typing an unambiguous "start a new
// sibling" landing spot — but only for `EM`/`STRONG`/`S` (bold/italic/strikethrough)
// markers, never for the heading marker span, which hits the identical DOM shape and the
// identical bug. Fixed via `patchSetRangeByWbrHeadingMarker`
// (media-src/esbuild-shared.mjs) — widens that same tag check.
//
// Real-VS-Code only, by construction: does NOT reproduce anywhere in the chromium harness (10
// cells tried there — see tasks/519-heading-typing-drops-a-space.md's "Scope" table). Not a
// structural harness gap (`isChrome()` is true in both environments) — the harness's own cells
// never happened to chain "promote, then immediately keep typing in the SAME burst" against a
// seeded-leading-block document the same way.
//
// SCOPE, established with controls before the fix (still true — these stay clean):
//   - General, not untitled-specific: reproduced identically on an ordinary `file:` document.
//   - Not empty-doc-specific: reproduced the same into a document that already has a paragraph.
//   - Not a boot-timing race, not delay-sensitive (60ms/150ms identical).
//   - REFUTED the prepaint-scroll-capture hypothesis (see git history for the full note).
//   - IS heading-specific: `alpha beta` (no leading `#`) typed the SAME way stays clean — see the
//     plain-text control below.
//   - A discrete `.press('Space')` (not part of one continuous type() stream) never reproduced it
//     — see the discrete-Space control below.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { clickIntoEditor, settle, wf } from './webview-helpers'

type Vs = typeof import('vscode')

test('typing "# Untitled journey" char-by-char keeps the space after the first word (task 519)', async ({
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

    await clickIntoEditor(frame, workbox)
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
    // The whole point of the bug: the space between the two words must survive. Before the fix
    // this read '# Untitledjourney\n'.
    expect(text).toBe('# Untitled journey\n')
  } finally {
    rmSync(target, { force: true })
  }
})

test('control: "alpha beta" (no heading marker) typed the same way stays clean', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const target = path.join(
    tmpdir(),
    `vmarkd-plain-text-control-${Date.now()}.md`,
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

    await clickIntoEditor(frame, workbox)
    await workbox.keyboard.type('alpha beta', { delay: 60 })
    await settle(frame, 500)

    const text = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '<not found>',
      [target] as [string],
    )
    expect(text).toBe('alpha beta\n')
  } finally {
    rmSync(target, { force: true })
  }
})

test('control: a discrete Space keypress, separated from the surrounding keystrokes, stays clean', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const target = path.join(
    tmpdir(),
    `vmarkd-discrete-space-control-${Date.now()}.md`,
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

    await clickIntoEditor(frame, workbox)
    // Discrete actions, NOT one continuous type() stream — this is the control the bug never hit.
    await workbox.keyboard.type('#', { delay: 60 })
    await settle(frame, 200)
    await workbox.keyboard.press('Space')
    await settle(frame, 200)
    await workbox.keyboard.type('heading', { delay: 60 })
    await settle(frame, 500)

    const text = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '<not found>',
      [target] as [string],
    )
    expect(text).toBe('# heading\n')
  } finally {
    rmSync(target, { force: true })
  }
})
