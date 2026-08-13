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
  // The plain text editor is a monaco instance in the workbench chrome (not the webview iframe) —
  // click it directly to make sure it, not the webview, holds keyboard focus. `:visible` matters:
  // a bare `.monaco-editor` also matches a HIDDEN chat-input editor instance elsewhere in the
  // workbench (measured — the first attempt at this test timed out clicking that one).
  await workbox.locator('.monaco-editor:visible').last().click()
  await settle(frame, 300)

  await workbox.keyboard.press('Control+d')
  await settle(frame, 300)
  await workbox.keyboard.press('Control+l')
  await settle(frame, 300)
  await workbox.keyboard.press('Control+h')
  await settle(frame, 300)

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
    `[keybinding-scope-release] before=${JSON.stringify(before)} after=${JSON.stringify(after)} textDoc=${JSON.stringify(textDocAfter)}`,
  )

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
