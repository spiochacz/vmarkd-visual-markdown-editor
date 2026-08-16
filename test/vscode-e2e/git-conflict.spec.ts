import type { EvaluateInVSCode } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 241 — opening a merge-conflicted .md must not put it in the WYSIWYG editor.
//
// vMarkd is the registered editor for .md, so the user lands here by accident. One IR round-trip
// rewrites the markers (`=======` changes length, `>>>>>>> feature` explodes into a staircase) and
// git then no longer recognizes the conflict. The contract is therefore about BYTES: the custom
// editor must not take the file, and the file on disk must be untouched.
const SRC = path.join(__dirname, 'fixtures', 'git-conflict.md')
const CLEAN = path.join(__dirname, 'fixtures', 'torture.md')

async function openWithVmarkd(
  evaluateInVSCode: EvaluateInVSCode,
  file: string,
) {
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

/** Which editor actually ended up showing the file: the custom webview, or the plain text one. */
const activeEditorKind = (evaluateInVSCode: EvaluateInVSCode, file: string) =>
  evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const inText = vscode.window.visibleTextEditors.some(
        (e) => e.document.uri.fsPath === args[0],
      )
      const tabs = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => {
          const i = t.input as { uri?: { fsPath?: string } } | undefined
          return i?.uri?.fsPath === args[0]
        })
        .map((t) => {
          const i = t.input as { viewType?: string } | undefined
          return i?.viewType ?? 'text'
        })
      return JSON.stringify({ inText, tabs })
    },
    [file] as [string],
  ) as Promise<string>

test('a conflicted file opens in the plain text editor, not vMarkd, and is left byte-identical', async ({
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), 'vmarkd-git-conflict.md')
  const original = readFileSync(SRC, 'utf8')
  writeFileSync(tmp, original)

  await openWithVmarkd(evaluateInVSCode, tmp)
  // The redirect is a couple of awaits inside the provider; give it room without a fixed race.
  await expect
    .poll(
      async () =>
        JSON.parse(await activeEditorKind(evaluateInVSCode, tmp)).inText,
      {
        timeout: 30_000,
      },
    )
    .toBe(true)

  const state = JSON.parse(await activeEditorKind(evaluateInVSCode, tmp))
  expect(state.tabs, 'no vMarkd custom-editor tab was left open').not.toContain(
    'vmarkd.editor',
  )

  // The point of the whole task: the markers on disk are exactly as git wrote them.
  const after = readFileSync(tmp, 'utf8')
  expect(after, 'the file was not rewritten').toBe(original)
  expect(after).toContain('<<<<<<< HEAD')
  expect(after).toContain('\n=======\n')
  expect(after).toContain('>>>>>>> feature-branch')
  rmSync(tmp, { force: true })
})

test('a document with no conflict still opens in vMarkd', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // The control. A detector that flags everything would pass the test above and break the editor.
  const tmp = path.join(tmpdir(), 'vmarkd-git-conflict-control.md')
  writeFileSync(tmp, readFileSync(CLEAN, 'utf8'))
  await openWithVmarkd(evaluateInVSCode, tmp)
  await workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
    .locator('.vditor-ir')
    .first()
    .waitFor({ timeout: 60_000 })
  rmSync(tmp, { force: true })
})
