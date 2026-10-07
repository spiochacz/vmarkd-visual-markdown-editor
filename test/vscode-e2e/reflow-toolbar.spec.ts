// Task 83 (increment 4) — the toolbar toggle for vmarkd.editor.reflowLineBreaks, in the real webview.
// A real click on the button persists the setting in VS Code (host write), the ↵ markers go away and
// the button un-presses; a second click brings it all back. A change made from the VS Code side
// (Settings) moves the button too, and a SECOND open vMarkd editor follows every flip.
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { applySettings, useSettingsRestore } from './settings-helpers'
import { openInMode, settle, wf } from './webview-helpers'

useSettingsRestore(test, [
  'vmarkd.editor.defaultMode',
  'vmarkd.editor.reflowLineBreaks',
])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

const DOC = 'Alpha one\nbeta two\ngamma three\n\nTail.\n'
const BTN = '.vditor-toolbar [data-type="reflow-line-breaks"]'

test('the toolbar button flips the persisted setting live, shows the pressed state, and every open editor follows', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const fileA = path.join(tmpdir(), `vmarkd-reflow-tb-a-${process.pid}.md`)
  const fileB = path.join(tmpdir(), `vmarkd-reflow-tb-b-${process.pid}.md`)
  writeFileSync(fileA, DOC)
  writeFileSync(fileB, DOC)
  const setting = () =>
    evaluateInVSCode(async (vscode: typeof import('vscode')) =>
      vscode.workspace
        .getConfiguration('vmarkd')
        .get<boolean>('editor.reflowLineBreaks'),
    ) as Promise<boolean>
  try {
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.reflowLineBreaks': true,
    })
    await openInMode(evaluateInVSCode, fileA, 'ir')
    const frameA = wf(workbox)
    await frameA.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frameA, 1000)

    // A second vMarkd editor beside the first, so there are two live webviews.
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: [string]) => {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
          vscode.ViewColumn.Beside,
        )
      },
      [fileB] as [string],
    )
    await expect(workbox.locator('iframe.webview')).toHaveCount(2, {
      timeout: 60_000,
    })
    const frames = [0, 1].map((i) =>
      workbox
        .frameLocator('iframe.webview')
        .nth(i)
        .frameLocator('iframe[title="vMarkd"], #active-frame'),
    )
    for (const f of frames) {
      await f.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    }

    // Side-by-side panes are narrow, so the toggle may sit in the More menu (toolbar overflow) — press it
    // wherever it currently lives, the way a user would.
    const press = async (f: (typeof frames)[number]) => {
      if (!(await f.locator(BTN).isVisible())) {
        await f.locator('.vditor-toolbar [data-type="more"]').click()
      }
      await f.locator(BTN).click()
    }

    const expectAll = async (on: boolean) => {
      for (const f of frames) {
        const btn = f.locator(BTN)
        await expect(btn).toHaveAttribute('aria-pressed', String(on), {
          timeout: 30_000,
        })
        if (on) await expect(btn).toHaveClass(/vditor-menu--current/)
        else await expect(btn).not.toHaveClass(/vditor-menu--current/)
        await expect(f.locator('.vmarkd-softbreak')).toHaveCount(on ? 2 : 0, {
          timeout: 30_000,
        })
      }
    }

    // Default (true): pressed, markers on, in both editors.
    await expectAll(true)

    // Real click in the first editor -> the host writes the setting, both editors follow.
    await press(frames[0])
    await expect.poll(setting, { timeout: 30_000 }).toBe(false)
    await expectAll(false)

    // Click again (in the SECOND editor this time) -> back on everywhere.
    await press(frames[1])
    await expect.poll(setting, { timeout: 30_000 }).toBe(true)
    await expectAll(true)

    // A change made from the VS Code side (Settings) moves the buttons too.
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.reflowLineBreaks': false,
    })
    await expectAll(false)
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.reflowLineBreaks': true,
    })
    await expectAll(true)
  } finally {
    rmSync(fileA, { force: true })
    rmSync(fileB, { force: true })
  }
})
