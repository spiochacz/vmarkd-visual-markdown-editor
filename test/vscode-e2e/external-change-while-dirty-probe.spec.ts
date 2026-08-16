import { docText, settle, stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Journey A4 (tasks/516-qa-journey-coverage-plan.md, Phase 1), probe-first — external change
// while the buffer is DIRTY. `doc-sync.spec.ts` already proves an external change reaches the
// webview when the document is CLEAN; this is the untested half task 190 explicitly deferred to
// its own §5 ("conflict + files.revert sub-cases") and that deferral was lost in the 190→455
// rehoming. The correct behaviour here is NOT defined anywhere in this codebase, so this file
// MEASURES what actually happens today — it asserts nothing (see PROBE.md convention / task 449
// — `@probe`-tagged, `*-probe.spec.ts` named, excluded from every run tier including FULL,
// opt-in via `VMARKD_PROBES=1` / `npm run test:probes`).
//
// Scenario: open a file in vMarkd, type an unsaved edit near the TOP (CARET-ANCHOR), then write
// DIFFERENT content to the same path from OUTSIDE VS Code entirely (`fs.writeFileSync`, not
// `vscode.workspace.applyEdit` — a real `git pull`/another-editor write bypasses VS Code's edit
// API completely) touching a DIFFERENT region (EXTERNAL-TARGET, near the bottom) so a merge is
// at least conceivable. Two independent sub-probes: what happens if the user then SAVES, and
// what happens if the user then REVERTS (`workbench.action.files.revert`).
const SRC = path.join(__dirname, 'fixtures', 'doc-sync.md')
const WEBVIEW_MARKER = 'WEBVIEWDIRTYXYZ'
const EXTERNAL_MARKER = 'rewritten from outside while dirty XYZ'

type Vs = typeof import('vscode')
type EvalInVSCode = (fn: unknown, args: unknown) => Promise<unknown>

async function openVmarkd(evaluateInVSCode: EvalInVSCode, tmp: string) {
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
}

/** Type `marker` at the end of the CARET-ANCHOR paragraph — an UNSAVED webview edit. */
async function typeWebviewEdit(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  marker: string,
) {
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
      if (!t) throw new Error('CARET-ANCHOR paragraph not found')
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
  await workbox.keyboard.type(marker, { delay: 40 })
}

/** Rewrite the EXTERNAL-TARGET line, straight to disk, bypassing every VS Code API. */
function externalWrite(tmp: string, original: string) {
  const rewritten = original.replace(
    /EXTERNAL-TARGET paragraph near the bottom that an out-of-webview edit will rewrite\./,
    `EXTERNAL-TARGET ${EXTERNAL_MARKER}`,
  )
  writeFileSync(tmp, rewritten)
  return rewritten
}

async function hostState(evaluateInVSCode: EvalInVSCode, tmp: string) {
  return evaluateInVSCode(
    async (vscode: Vs, args: [string]) => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === args[0],
      )
      return {
        found: !!doc,
        isDirty: doc?.isDirty ?? null,
        version: doc?.version ?? null,
        text: doc?.getText() ?? null,
      }
    },
    [tmp] as [string],
  ) as Promise<{
    found: boolean
    isDirty: boolean | null
    version: number | null
    text: string | null
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

test('@probe probe: external write while the buffer is dirty, then SAVE — what lands, what is lost', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-external-dirty-save.md')
  writeFileSync(tmp, original)

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    await typeWebviewEdit(workbox, frame, WEBVIEW_MARKER)
    await expect
      .poll(async () => (await hostState(evaluateInVSCode, tmp)).isDirty, {
        timeout: 15_000,
      })
      .toBe(true)
    const dirtyState = await hostState(evaluateInVSCode, tmp)
    console.log(
      `[external-dirty-save] AFTER webview edit: isDirty=${dirtyState.isDirty} hasMarker=${dirtyState.text?.includes(WEBVIEW_MARKER)} diskStillOriginal=${readFileSync(tmp, 'utf8') === original}`,
    )

    // The external write — straight fs, no vscode API, based on the ORIGINAL disk bytes (an
    // external tool has no idea about our unsaved buffer).
    const externalBytes = externalWrite(tmp, original)
    await settle(frame, 3000) // let the FileSystemWatcher + any VS Code core reaction settle

    const afterExternal = await hostState(evaluateInVSCode, tmp)
    const webviewTextAfterExternal = await frame
      .locator('body')
      .evaluate(() => document.body.innerText)
    const notice1 = await toastAndDialogInfo(workbox)
    console.log(
      `[external-dirty-save] AFTER external write: isDirty=${afterExternal.isDirty} ` +
        `docHasWebviewMarker=${afterExternal.text?.includes(WEBVIEW_MARKER)} ` +
        `docHasExternalMarker=${afterExternal.text?.includes(EXTERNAL_MARKER)} ` +
        `webviewHasWebviewMarker=${webviewTextAfterExternal.includes(WEBVIEW_MARKER)} ` +
        `webviewHasExternalMarker=${webviewTextAfterExternal.includes(EXTERNAL_MARKER)} ` +
        `toastText=${JSON.stringify(notice1.toastText)} hasDialog=${notice1.hasDialog}`,
    )

    // Now the user saves.
    await evaluateInVSCode(
      async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      },
      [] as unknown as [string],
    )
    await settle(frame, 2000)

    const afterSave = await hostState(evaluateInVSCode, tmp)
    const diskAfterSave = readFileSync(tmp, 'utf8')
    const notice2 = await toastAndDialogInfo(workbox)
    console.log(
      `[external-dirty-save] AFTER save attempt: isDirty=${afterSave.isDirty} ` +
        `diskHasWebviewMarker=${diskAfterSave.includes(WEBVIEW_MARKER)} ` +
        `diskHasExternalMarker=${diskAfterSave.includes(EXTERNAL_MARKER)} ` +
        `diskEqualsExternalWrite=${diskAfterSave === externalBytes} ` +
        `diskEqualsDocText=${diskAfterSave === afterSave.text} ` +
        `toastText=${JSON.stringify(notice2.toastText)} hasDialog=${notice2.hasDialog} ` +
        `dialogButtons=${JSON.stringify(notice2.dialogButtons)}`,
    )
    // If a conflict dialog appeared and is blocking, dismiss it so afterAll cleanup can proceed —
    // record which button it offered rather than guessing.
    if (notice2.hasDialog && notice2.dialogButtons.length > 0) {
      const btn = await workbox
        .locator('.monaco-dialog-box button')
        .first()
        .textContent()
      console.log(`[external-dirty-save] dismissing dialog via button "${btn}"`)
      await workbox.locator('.monaco-dialog-box button').first().click()
      await settle(frame, 1000)
    }
  } finally {
    rmSync(tmp, { force: true })
  }
})

test('@probe probe: external write while the buffer is dirty, then REVERT — does the user edit survive', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-external-dirty-revert.md')
  writeFileSync(tmp, original)

  try {
    await openVmarkd(evaluateInVSCode, tmp)
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    await typeWebviewEdit(workbox, frame, WEBVIEW_MARKER)
    await expect
      .poll(async () => (await hostState(evaluateInVSCode, tmp)).isDirty, {
        timeout: 15_000,
      })
      .toBe(true)

    const externalBytes = externalWrite(tmp, original)
    await settle(frame, 3000)

    const beforeRevert = await hostState(evaluateInVSCode, tmp)
    console.log(
      `[external-dirty-revert] BEFORE revert: isDirty=${beforeRevert.isDirty} ` +
        `docHasWebviewMarker=${beforeRevert.text?.includes(WEBVIEW_MARKER)} ` +
        `docHasExternalMarker=${beforeRevert.text?.includes(EXTERNAL_MARKER)}`,
    )

    await evaluateInVSCode(
      async (vscode: Vs) => {
        await vscode.commands.executeCommand('workbench.action.files.revert')
      },
      [] as unknown as [string],
    )
    await settle(frame, 2000)

    const afterRevert = await hostState(evaluateInVSCode, tmp)
    const webviewTextAfterRevert = await frame
      .locator('body')
      .evaluate(() => document.body.innerText)
    const diskAfterRevert = readFileSync(tmp, 'utf8')
    console.log(
      `[external-dirty-revert] AFTER revert: isDirty=${afterRevert.isDirty} ` +
        `docHasWebviewMarker=${afterRevert.text?.includes(WEBVIEW_MARKER)} ` +
        `docHasExternalMarker=${afterRevert.text?.includes(EXTERNAL_MARKER)} ` +
        `docEqualsExternalWrite=${afterRevert.text === externalBytes} ` +
        `webviewHasWebviewMarker=${webviewTextAfterRevert.includes(WEBVIEW_MARKER)} ` +
        `webviewHasExternalMarker=${webviewTextAfterRevert.includes(EXTERNAL_MARKER)} ` +
        `diskUnchangedByRevert=${diskAfterRevert === externalBytes}`,
    )

    // Sanity check only — the doc-text helper agrees with the direct host read.
    const viaHelper = await docText(evaluateInVSCode, tmp)
    console.log(
      `[external-dirty-revert] docText() helper agrees=${viaHelper === afterRevert.text}`,
    )
  } finally {
    rmSync(tmp, { force: true })
  }
})
