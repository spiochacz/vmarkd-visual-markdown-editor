// A7 (tasks/516) / 455 "untitled → save-as" — this journey was completely dark: no spec had ever
// opened an `untitled:` resource in vmarkd.editor, typed into it, or driven the workbench's Save As.
// It works end-to-end (probed in untitled-save-as-probe.spec.ts, now deleted once this landed
// green): an untitled document whose URI path ends in `.md` DOES match the customEditors selector
// (`filenamePattern: "*.md"`, `scheme: "untitled"`) and boots the same `.vditor-ir` surface as a
// file. Typing lands on the underlying TextDocument. Save As is driven headless via VS Code's
// DOM-rendered "simple" file dialog (`files.simpleDialog.enable`) — the native OS picker it
// replaces is outside Electron and not scriptable under xvfb/Playwright.
//
// PROBE FINDING (not fixed here, out of scope — do not "fix" from this file): typing a heading
// marker immediately followed by a space and more text (`# Untitled journey`) drops the space
// after the first word on a genuinely blank document (`# Untitledjourney`), reproducibly, at 60ms
// per keystroke, regardless of whether the newline is a literal `\n` in the typed string or an
// explicit `Enter` keypress. Whether this is untitled-specific or a general IR heading-typing race
// on any blank document is UNCONFIRMED — a control leg against a blank `file:` doc was planned but
// never landed (shared e2e-lock contention starved every retry). This spec sidesteps it by typing
// a plain paragraph (no leading `#`), which types cleanly with the space intact, so the finding
// doesn't block this journey either way. See tasks/516-qa-journey-coverage-plan.md's "Open thread".
import { settle, wf } from './webview-helpers'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// `files.simpleDialog.enable` is turned on mid-test (right before driving Save As), so it's not a
// pinnable up-front setting — restore-only.
useSettingsRestore(test, ['files.simpleDialog.enable'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('untitled document opens in vMarkd, accepts typing, and Save As lands the right bytes on disk', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(path.join(tmpdir(), 'vmarkd-untitled-'))
  const target = path.join(dir, 'saved.md')

  // Untitled → vMarkd: a URI whose PATH ends in .md is what the customEditors selector matches
  // (scheme `untitled` alone is not enough — the selector is `filenamePattern: "*.md"`).
  const opened = await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      const uri = vscode.Uri.from({ scheme: 'untitled', path: '/new-doc.md' })
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        'vmarkd.editor',
      )
      return { isUntitled: doc.isUntitled, uri: doc.uri.toString() }
    },
    [] as unknown as [string],
  )
  expect(opened.isUntitled, 'opened doc is untitled').toBe(true)
  expect(opened.uri).toBe('untitled:/new-doc.md')

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 300)

  // Type real keyboard input.
  await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })
  await settle(frame, 200)
  await workbox.keyboard.type('Untitled journey', { delay: 60 })
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('Hello from Save As.', { delay: 60 })
  await settle(frame, 500)

  const value = await frame.locator('body').evaluate(() => {
    const v = (window as unknown as { vditor?: { getValue?: () => string } })
      .vditor
    return v?.getValue?.() ?? ''
  })
  expect(value).toBe('Untitled journey\n\nHello from Save As.\n')

  // Save As, through the DOM-rendered simple dialog (headless-safe).
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.workspace
        .getConfiguration('files')
        .update('simpleDialog.enable', true, vscode.ConfigurationTarget.Global)
    },
    [] as unknown as [string],
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      // Fire-and-forget: the command doesn't resolve until the dialog is dismissed, so awaiting
      // it here would deadlock against the dialog interaction below.
      void vscode.commands.executeCommand('workbench.action.files.saveAs')
    },
    [] as unknown as [string],
  )
  const input = workbox.locator('.quick-input-widget input')
  await input.waitFor({ timeout: 10_000 })
  await input.click()
  await workbox.keyboard.press('Control+A')
  await workbox.keyboard.type(target, { delay: 20 })
  await workbox.keyboard.press('Enter')

  await expect
    .poll(
      () => {
        try {
          return readFileSync(target, 'utf8')
        } catch {
          return null
        }
      },
      { timeout: 15_000 },
    )
    .toBe('Untitled journey\n\nHello from Save As.\n')

  // The document itself rehomed: the untitled doc is gone, the file: doc is clean. This lags
  // slightly behind the disk write above (the editor closes the untitled tab asynchronously after
  // Save As resolves), so poll rather than reading it once.
  const readDocs = () =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        const [targetPath] = args
        const saved = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === targetPath,
        )
        return {
          untitledStillOpen: vscode.workspace.textDocuments.some(
            (d) => d.uri.scheme === 'untitled',
          ),
          savedIsDirty: saved?.isDirty ?? null,
        }
      },
      [target] as [string],
    ) as Promise<{ untitledStillOpen: boolean; savedIsDirty: boolean | null }>

  await expect
    .poll(readDocs, { timeout: 15_000 })
    .toMatchObject({ untitledStillOpen: false, savedIsDirty: false })

  rmSync(dir, { recursive: true, force: true })
})
