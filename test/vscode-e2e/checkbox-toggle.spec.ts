import { type EvaluateInVSCode, wf } from './webview-helpers'
// NET (task 516 A1) — a REAL Playwright mouse click on a rendered `- [ ]` task checkbox must flip
// the source marker on the actual save wire (edit → host writeback → WorkspaceEdit → disk), in both
// IR and WYSIWYG. This confirms the 190 §5 deferral that never made it into 455's rehomed list:
// `list-ops.spec.ts`'s header notes that a SYNTHETIC `input.click()` (dispatched via `evaluate()`)
// collapses `getValue()` in the real-VS-Code harness — a caret-context artifact of driving the click
// from outside the editor's own event path — and defers the real-click confirmation here. The
// chromium harness's `checkbox-click.spec.ts` already proved a real Playwright click round-trips
// cleanly there; this is the same proof against the real custom-editor pipeline (resource URIs, CSP,
// VS Code's injected webview plumbing) that the harness cannot reproduce.
//
// Both tests read the SAVED BYTES off disk (not just `getValue()`) — the real journey is edit → save
// → what's on disk, matching `save-fidelity.spec.ts`'s pattern.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const SRC = path.join(__dirname, 'fixtures', 'checkbox-toggle.md')
// Untouched neighbours that must survive the toggle byte-for-byte.
const UNTOUCHED = ['bravo', 'A plain paragraph that must stay untouched.']

// The two test() blocks below (ir / wysiwyg) each write a DIFFERENT value for defaultMode, so it
// can't be pinned to one shared value — declared here for automatic afterEach cleanup only.
useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  // `defaultMode` persists in the shared user-data dir across boots (see default-open-mode.spec.ts) —
  // close editors unconditionally so a failure mid-test doesn't leak into later specs.
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

async function openFixture(
  evaluateInVSCode: EvaluateInVSCode,
  tmp: string,
  mode: 'ir' | 'wysiwyg',
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri, defaultMode] = args
      // Close any editor left over from a previous test/repeat FIRST — reopening the same tmp
      // path while a stale tab is still open reveals the OLD buffer instead of reloading the
      // freshly-written file, which silently no-ops every assertion below on repeat runs.
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      if (defaultMode !== 'ir') {
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update(
            'editor.defaultMode',
            defaultMode,
            vscode.ConfigurationTarget.Global,
          )
      }
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [tmp, mode],
  )
}

for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`real click toggles a task checkbox and the flip survives to disk (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(120_000)
    const tmp = path.join(tmpdir(), `vmarkd-checkbox-toggle-${mode}.md`)
    const before = readFileSync(SRC, 'utf8')
    writeFileSync(tmp, before)

    await openFixture(evaluateInVSCode, tmp, mode)
    const frame = wf(workbox)
    const surface = mode === 'ir' ? '.vditor-ir' : '.vditor-wysiwyg'
    await frame.locator(surface).first().waitFor({ timeout: 60_000 })
    const box = frame.locator(`${surface} li input[type="checkbox"]`).first()
    await box.waitFor({ timeout: 60_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

    // The REAL Playwright click — a trusted mouse event through the editor's own DOM, not a
    // synthetic `evaluate()`-dispatched one.
    await box.click()

    // Poll the live TextDocument (debounced edit + host writeback), then save through the real
    // command and read the bytes back off disk — matching save-fidelity.spec.ts's pattern.
    await expect
      .poll(
        async () =>
          (await evaluateInVSCode(
            async (vscode: typeof import('vscode'), args: string[]) =>
              vscode.workspace.textDocuments
                .find((d) => d.uri.fsPath === args[0])
                ?.getText() ?? '',
            [tmp] as [string],
          )) as string,
        { timeout: 10_000, intervals: [200, 300, 500, 800] },
      )
      .toMatch(/-\s*\[[xX]\]\s+alpha/)

    await evaluateInVSCode(
      async (vscode: typeof import('vscode')) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      },
      [] as [],
    )
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

    const afterToggle = readFileSync(tmp, 'utf8')
    // eslint-disable-next-line no-console
    console.log(
      `[checkbox-toggle:${mode}] before=${JSON.stringify(before)} afterToggle=${JSON.stringify(afterToggle)}`,
    )

    expect(afterToggle, 'alpha flips to checked on disk').toMatch(
      /-\s*\[[xX]\]\s+alpha/,
    )
    for (const anchor of UNTOUCHED) {
      expect(afterToggle.includes(anchor), `untouched: ${anchor}`).toBe(true)
    }

    // One undo reverts the toggle.
    await frame
      .locator(surface)
      .first()
      .click({ position: { x: 4, y: 4 } })
    await workbox.keyboard.press('Control+z')
    await expect
      .poll(
        async () =>
          (await evaluateInVSCode(
            async (vscode: typeof import('vscode'), args: string[]) =>
              vscode.workspace.textDocuments
                .find((d) => d.uri.fsPath === args[0])
                ?.getText() ?? '',
            [tmp] as [string],
          )) as string,
        { timeout: 10_000, intervals: [200, 300, 500, 800] },
      )
      .toMatch(/-\s*\[\s?\]\s+alpha/)

    await evaluateInVSCode(
      async (vscode: typeof import('vscode')) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      },
      [] as [],
    )
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1000)))
    const afterUndo = readFileSync(tmp, 'utf8')
    rmSync(tmp, { force: true })

    expect(afterUndo, 'undo reverts alpha to unchecked on disk').toMatch(
      /-\s*\[\s?\]\s+alpha/,
    )
    for (const anchor of UNTOUCHED) {
      expect(
        afterUndo.includes(anchor),
        `untouched after undo: ${anchor}`,
      ).toBe(true)
    }
  })
}
