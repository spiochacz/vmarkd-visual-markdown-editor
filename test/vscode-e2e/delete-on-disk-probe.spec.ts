import { settle, stickySelection, wf } from './webview-helpers'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

// Journey A6 (tasks/516-qa-journey-coverage-plan.md, Phase 1), probe-first — the file backing an
// open vMarkd editor is deleted EXTERNALLY (`fs.rmSync`, not a VS Code API — the same shape as an
// out-of-band `git clean` / `rm` while the editor still has the tab open). Correct behaviour is
// undefined anywhere in this codebase, so this MEASURES: does the webview survive (no crash/blank),
// what does VS Code report for isDirty/exists, and if the user then types and saves, does the file
// come back with their content or is it silently lost? `@probe`-tagged, excluded from every run
// tier including FULL (task 449 convention).
const SRC = path.join(__dirname, 'fixtures', 'delete-on-disk.md')
const MARKER = 'DELETEDONDISKMARKER'

type Vs = typeof import('vscode')
type EvalInVSCode = (fn: unknown, args: unknown) => Promise<unknown>

async function hostState(evaluateInVSCode: EvalInVSCode, tmp: string) {
  return evaluateInVSCode(
    async (vscode: Vs, args: [string]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      const stillOpenTab = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .some(
          (t) =>
            t.input instanceof vscode.TabInputCustom &&
            t.input.uri.fsPath === args[0],
        )
      return {
        found: !!doc,
        isDirty: doc?.isDirty ?? null,
        isClosed: doc?.isClosed ?? null,
        text: doc?.getText() ?? null,
        stillOpenTab,
      }
    },
    [tmp] as [string],
  ) as Promise<{
    found: boolean
    isDirty: boolean | null
    isClosed: boolean | null
    text: string | null
    stillOpenTab: boolean
  }>
}

async function toastAndDialogInfo(workbox: import('@playwright/test').Page) {
  return workbox.evaluate(() => {
    const toasts = document.querySelector('.notifications-toasts')
    const dialog = document.querySelector('.monaco-dialog-box')
    return {
      toastText: toasts?.textContent?.trim().slice(0, 500) ?? null,
      hasDialog: !!dialog,
      dialogText: dialog?.textContent?.trim().slice(0, 500) ?? null,
      dialogButtons: dialog
        ? Array.from(dialog.querySelectorAll('button')).map((b) =>
            b.textContent?.trim(),
          )
        : [],
    }
  })
}

test('@probe probe: file deleted on disk while open — survival, dirty state, then save', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-delete-on-disk.md')
  writeFileSync(tmp, original)

  try {
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
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
    await settle(frame, 1500)

    const before = await hostState(evaluateInVSCode, tmp)
    console.log(
      `[delete-on-disk] BEFORE delete: found=${before.found} isDirty=${before.isDirty} stillOpenTab=${before.stillOpenTab}`,
    )

    // Delete the file completely outside VS Code.
    rmSync(tmp, { force: true })
    console.log(`[delete-on-disk] file exists after rm=${existsSync(tmp)}`)
    await settle(frame, 3000) // let the FileSystemWatcher + any VS Code core reaction settle

    const afterDelete = await hostState(evaluateInVSCode, tmp)
    const webviewStillHasIR = await frame.locator('.vditor-ir').count()
    const webviewBodyText = await frame
      .locator('body')
      .evaluate(() => document.body.innerText.slice(0, 300))
    const notice1 = await toastAndDialogInfo(workbox)
    console.log(
      `[delete-on-disk] AFTER delete: found=${afterDelete.found} isDirty=${afterDelete.isDirty} ` +
        `isClosed=${afterDelete.isClosed} stillOpenTab=${afterDelete.stillOpenTab} ` +
        `webviewStillHasIR=${webviewStillHasIR} toastText=${JSON.stringify(notice1.toastText)} ` +
        `hasDialog=${notice1.hasDialog} dialogText=${JSON.stringify(notice1.dialogText)}`,
    )
    console.log(
      `[delete-on-disk] webview body preview: ${JSON.stringify(webviewBodyText)}`,
    )

    if (notice1.hasDialog && notice1.dialogButtons.length > 0) {
      console.log(
        `[delete-on-disk] a dialog appeared with buttons ${JSON.stringify(notice1.dialogButtons)} — leaving it open, no interaction yet`,
      )
    }

    // If the editor/tab survived, try to type a marker and save — does the file come back?
    if (webviewStillHasIR > 0 && afterDelete.stillOpenTab) {
      await frame
        .locator('.vditor-ir')
        .first()
        .click({ position: { x: 4, y: 4 } })
      await stickySelection(
        frame,
        () => {
          const p = Array.from(document.querySelectorAll('.vditor-ir p')).find(
            (x) => x.textContent?.includes('CARET-ANCHOR'),
          ) as HTMLElement | undefined
          const t = p?.lastChild as Text | null
          if (!t) return
          const r = document.createRange()
          r.setStart(t, (t.textContent ?? '').length)
          r.collapse(true)
          const s = window.getSelection()
          s?.removeAllRanges()
          s?.addRange(r)
          p?.focus()
        },
        null,
      )
      await workbox.keyboard.type(MARKER, { delay: 40 })
      await settle(frame, 1000)

      const afterType = await hostState(evaluateInVSCode, tmp)
      console.log(
        `[delete-on-disk] AFTER typing marker: isDirty=${afterType.isDirty} textHasMarker=${afterType.text?.includes(MARKER)}`,
      )

      await evaluateInVSCode(async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      })
      await settle(frame, 2000)

      const afterSave = await hostState(evaluateInVSCode, tmp)
      const recreated = existsSync(tmp)
      const diskText = recreated ? readFileSync(tmp, 'utf8') : null
      const notice2 = await toastAndDialogInfo(workbox)
      console.log(
        `[delete-on-disk] AFTER save: fileRecreated=${recreated} diskHasMarker=${diskText?.includes(MARKER)} ` +
          `diskHasOriginalHeading=${diskText?.includes('# Delete on disk')} isDirty=${afterSave.isDirty} ` +
          `toastText=${JSON.stringify(notice2.toastText)} hasDialog=${notice2.hasDialog} dialogText=${JSON.stringify(notice2.dialogText)}`,
      )
      if (notice2.hasDialog && notice2.dialogButtons.length > 0) {
        const btn = await workbox
          .locator('.monaco-dialog-box button')
          .first()
          .textContent()
        console.log(
          `[delete-on-disk] dismissing save dialog via button "${btn}"`,
        )
        await workbox.locator('.monaco-dialog-box button').first().click()
        await settle(frame, 1000)
      }
    } else {
      console.log(
        '[delete-on-disk] editor/tab did NOT survive the external delete — skipping the type+save leg',
      )
    }
  } finally {
    rmSync(tmp, { force: true })
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    })
  }
})
