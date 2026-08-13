import { settle, wf } from './webview-helpers'
// D10 (task 516) — keybinding scope release. Every vMarkd format keybinding
// (`ctrl+d`/`ctrl+l`/`ctrl+h`/…) is scoped `when: activeCustomEditorId == vmarkd.editor`
// (package.json `contributes.keybindings`). The risk this guards: if that `when` clause ever
// leaked, pressing Ctrl+D (VS Code's own "Add Selection To Next Find Match") in a PLAIN TEXT
// editor would instead fire `vmarkd.format.strike` — and since that command resolves its target
// panel from `vscode.window.activeTextEditor`'s URI (commands.ts `resolveActivePanel`), the worst
// case isn't "nothing happens": if the SAME file also has a live vMarkd panel open (e.g. via
// "Open Source to the Side"), the keypress would silently mutate that UNFOCUSED webview's
// document instead of doing the stock VS Code thing in the editor the user is actually looking
// at. This spec reproduces exactly that shared-URI setup to give the "when" clause something real
// to guard.
//
// RED-GREEN-RED (verified, not shipped as a toggle): widened the three keybindings' `when` from
// `activeCustomEditorId == vmarkd.editor` to `"true"` in package.json, reran this spec — RED,
// confirming the theory exactly: `after` gained a leading `* ~~~~\n\n` (format.list + format.strike
// both fired against the unfocused panel from a single Ctrl+D/Ctrl+L/Ctrl+H sequence typed into the
// plain text editor). Reverted `package.json` to the exact original (`git diff` clean) and reran —
// green again. (A weaker attempt using `editorTextFocus` — matching VS Code's own default Ctrl+D
// scope — did NOT go red: VS Code's built-in keybinding conflict resolution kept the stock command
// winning at equal specificity, which is VS Code core behaviour, not anything vMarkd owns. `"true"`
// is unconditional and clearly outranks the default, which is what surfaced the real defect.)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

const FIXTURE_BODY =
  '# Keybinding scope fixture\n\nPlain paragraph text for scope release checks.\n'

async function getVmarkdValue(frame: ReturnType<typeof wf>): Promise<string> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
}

test('Ctrl+D / Ctrl+L / Ctrl+H in a plain text editor do not reach the unfocused vMarkd panel for the same file', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Above the config's 90s default: the focus-acquisition poll below can legitimately spend a
  // minute on a loaded machine (measured in a full-suite run), and it must be the thing that
  // reports the failure, not the test budget expiring underneath it.
  test.setTimeout(180_000)
  const tmp = path.join(TEMP_DIR, 'vmarkd-keybinding-scope.md')
  writeFileSync(tmp, FIXTURE_BODY)

  // Open the file in vMarkd first…
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
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 500)
  const before = await getVmarkdValue(frame)
  expect(before).toContain('Keybinding scope fixture')

  // …then open the SAME file as a plain text editor beside it, and focus that one. This is the
  // one setup where `resolveActivePanel` (commands.ts) would find a live panel for
  // `activeTextEditor`'s uri if a format command ever ran here.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'default',
        { viewColumn: vscode.ViewColumn.Beside },
      )
    },
    [tmp] as [string],
  )
  // NOTHING below may use `settle(frame, …)` — that helper runs `evaluate` INSIDE the webview
  // iframe, and touching the iframe pulls DOM keyboard focus into the panel. That is what actually
  // broke this test in the full run: it settled between the key presses, so Ctrl+L/Ctrl+H landed in
  // the FOCUSED webview and fired `format.list`/`format.strike` exactly as designed — the `* ~~~~`
  // in the failure output was the product working, not a `when`-clause leak. Measured with a
  // throwaway focus probe: opening the text editor beside already gives it focus within 200 ms and
  // keeps it indefinitely, through `evaluateInVSCode` round-trips too; every observed focus loss
  // traced back to a webview-side evaluate. Use `workbox.waitForTimeout` here instead.
  const focusedEditor = workbox.locator(
    '.editor-group-container.active .monaco-editor.focused',
  )
  // Opening the editor beside does not RELIABLY hand it DOM focus — measured at roughly 1-in-2 with
  // the webview live next to it, and waiting longer does not help (the assert below auto-retries for
  // 20 s and still timed out). Re-focus explicitly through the extension host, and fall back to a
  // click, until monaco actually carries `.focused`.
  await expect
    .poll(
      async () => {
        await evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) => {
            const doc = await vscode.workspace.openTextDocument(
              vscode.Uri.file(args[0]),
            )
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: false,
            })
          },
          [tmp] as [string],
        )
        await workbox.waitForTimeout(300)
        if (await focusedEditor.isVisible().catch(() => false)) return true
        await workbox
          .locator('.editor-group-container.active .monaco-editor:visible')
          .first()
          .click()
          // A click that misses is not fatal here — the poll retries, and the assert after it is
          // what decides. Swallow it so a transient miss does not abort the whole attempt.
          .catch((err: Error) => {
            console.log(
              `[keybinding-scope-release] focus click missed: ${err.message}`,
            )
          })
        await workbox.waitForTimeout(300)
        return focusedEditor.isVisible().catch(() => false)
      },
      {
        message: 'the plain text editor takes DOM keyboard focus',
        // 30s was not enough in a full-suite run: this timed out once at 33.5s wall clock while the
        // retry passed in 5.3s, i.e. the machine was loaded, not the focus path broken. The budget
        // is a setup cost, not an assertion — paying more of it costs nothing when focus arrives
        // early (the poll returns immediately) and only matters on a slow boot. Kept BELOW the
        // per-test budget raised just above, so a genuine never-focuses failure still reports as
        // this poll's message rather than as an opaque test timeout.
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      },
    )
    .toBe(true)

  // Precondition, not decoration: everything below only means something if the plain TEXT editor is
  // the focused surface. Asserting it here makes a focus mishap fail as "we never got focus" instead
  // of silently degrading into "the keybinding leaked", which is the opposite conclusion.
  await expect(
    focusedEditor,
    'the text editor holds DOM keyboard focus',
  ).toBeVisible()
  const focusedFsPath = await evaluateInVSCode(
    async (vscode: typeof import('vscode')) =>
      vscode.window.activeTextEditor?.document.uri.fsPath ?? '<none>',
    [] as [string],
  )
  expect(
    focusedFsPath,
    'the plain text editor — not the webview — is the active editor before any key is pressed',
  ).toBe(tmp)

  // Page-level waits only (see the settle note above), and focus is RECORDED per key rather than
  // asserted: a leak steals focus into the panel as its first effect, so a hard per-key focus assert
  // fails before the content check and reports "lost focus" for what is really "the keybinding
  // leaked" — measured while re-proving the red case. The content assert below stays the detector;
  // this trail is here to tell the two apart when it does fire.
  const focusTrail: string[] = []
  for (const key of ['Control+d', 'Control+l', 'Control+h']) {
    const hadFocus = await focusedEditor.isVisible().catch(() => false)
    focusTrail.push(`${key}:${hadFocus ? 'text-editor' : 'NOT-text-editor'}`)
    await workbox.keyboard.press(key)
    await workbox.waitForTimeout(300)
  }

  const textDocAfter = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [tmp] as [string],
  )
  const after = await getVmarkdValue(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[keybinding-scope-release] before=${JSON.stringify(before)} after=${JSON.stringify(after)} textDoc=${JSON.stringify(textDocAfter)} focusTrail=${focusTrail.join(',')}`,
  )
  // First key is the one that matters: it decides whether the sequence was typed into the text
  // editor at all. (Later entries can legitimately read NOT-text-editor once a leak has moved focus.)
  expect(
    focusTrail[0],
    'the first key was pressed with the text editor focused',
  ).toBe('Control+d:text-editor')

  // The unfocused vMarkd panel must be byte-identical: none of our format commands fired against
  // it. (If the `when` clause leaked, this is exactly where a stray `~~`/`- `/`#` would show up —
  // format.strike/list/headings all mutate via a `trigger-toolbar-hotkey` postMessage, not the
  // text document directly, so this in-webview read is the one that would catch it.)
  expect(
    after,
    'the vMarkd panel content is untouched by keys pressed in the text editor',
  ).toBe(before)

  rmSync(tmp, { force: true })
})
