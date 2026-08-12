import { docText, settle, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Journey A2 (tasks/516-qa-journey-coverage-plan.md, Phase 1) — `files.autoSave: afterDelay`
// interplay with the writeback pipeline. Everything else in this suite that exercises the
// writeback controller's no-op timer (noop-check-on-save.spec.ts) or the edit-to-disk path
// (save-fidelity.spec.ts) triggers the write through a MANUAL `workbench.action.files.save`.
// Nothing exercises the case where VS Code itself decides when to save — `grep -ri autoSave
// test/vscode-e2e` was 0 hits before this file. Autosave matters here specifically because it
// fires the save command on ITS OWN timer, independent of (and possibly overlapping) the
// debounced edit-sync tick and the deferred ~1200ms no-op check
// (src/writeback/writeback-controller.ts, WritebackController.NOOP_CHECK_IDLE_MS) — a plausible
// echo path is our own autosave-triggered write coming back through onDidChangeTextDocument and
// being mistaken for an external change, re-dirtying the tab.
//
// Uses a COPY of save-fidelity.md's fixture shape in the OS temp dir, never the committed file.
const SRC = path.join(__dirname, 'fixtures', 'save-fidelity.md')
const TMP = path.join(tmpdir(), 'vmarkd-autosave-writeback.md')
const INSERT = 'AUTOSAVEXYZ'
// Blocks the user never touched — must survive autosave byte-for-byte, same discipline as
// save-fidelity.spec.ts's UNTOUCHED list.
const UNTOUCHED = [
  'Intro paragraph that stays byte-for-byte unchanged.',
  '## Section B',
  '- Second item',
  '| Alpha | 1 |',
  'const answer = 42',
  'Closing paragraph unchanged.',
]

type Vs = typeof import('vscode')

async function setAutoSave(
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  autoSave: string | undefined,
  autoSaveDelay: number | undefined,
) {
  await evaluateInVSCode(
    async (vscode: Vs, args: [string, string]) => {
      const [as, delay] = args
      const cfg = vscode.workspace.getConfiguration('files')
      await cfg.update(
        'autoSave',
        as === '' ? undefined : as,
        vscode.ConfigurationTarget.Global,
      )
      await cfg.update(
        'autoSaveDelay',
        delay === '' ? undefined : Number(delay),
        vscode.ConfigurationTarget.Global,
      )
    },
    [
      autoSave ?? '',
      autoSaveDelay === undefined ? '' : String(autoSaveDelay),
    ] as [string, string],
  )
}

test('autosave lands the typed edit on disk without corrupting untouched blocks, and clears the dirty flag', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  const before = readFileSync(SRC, 'utf8')
  writeFileSync(TMP, before)

  // Short delay (well under the writeback controller's own 1200ms deferred no-op window, so this
  // test's autosave has a real chance of firing before/around it rather than always long after).
  await setAutoSave(evaluateInVSCode, 'afterDelay', 400)

  try {
    await evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        // Re-opening a path that already has a tab REVEALS the stale buffer instead of reloading
        // from disk, which would silently no-op every assertion on a repeat run (found while
        // proving checkbox-toggle.spec.ts under --repeat-each; block-fidelity.spec.ts does the same).
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [TMP] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    // PAGE-LEVEL keyboard focus into the nested webview iframe first (save-fidelity.spec.ts's own
    // note: `p.focus()` below is DOM-level inside the iframe, while `workbox.keyboard` dispatches
    // to the top Electron window).
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })

    await frame.locator('body').evaluate(() => {
      const p = Array.from(
        document.querySelectorAll('.vditor-ir p, .vditor-ir li, .vditor-ir h1'),
      ).find((x) => x.textContent?.includes('Edit here')) as
        | HTMLElement
        | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('edit target not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    })
    await workbox.keyboard.type(INSERT, { delay: 40 })

    // Poll for the ON-DISK bytes to contain the typed marker — the thing autosave itself is
    // supposed to produce, no manual save command involved.
    await expect
      .poll(
        () => {
          try {
            return readFileSync(TMP, 'utf8').includes(INSERT)
          } catch {
            return false
          }
        },
        { timeout: 15_000, intervals: [300, 500, 800, 1200] },
      )
      .toBe(true)

    const after = readFileSync(TMP, 'utf8')
    console.log(
      `[autosave-writeback] beforeLen=${before.length} afterLen=${after.length} ` +
        `delta=${after.length - before.length} hasInsert=${after.includes(INSERT)}`,
    )

    expect(
      after.includes(INSERT),
      'autosave must land the typed text on disk',
    ).toBe(true)
    for (const anchor of UNTOUCHED) {
      expect(
        after.includes(anchor),
        `untouched block preserved by autosave: ${anchor}`,
      ).toBe(true)
    }
    // A pure insertion: the file grew only by the marker (±2 for a possible trailing-newline
    // normalization) — not reflowed or duplicated.
    expect(
      Math.abs(after.length - before.length - INSERT.length),
      'autosave must be a minimal insertion, not a reflow',
    ).toBeLessThanOrEqual(2)

    // The tab must end up clean — autosave is a real save, not a partial/failed write.
    const isDirty = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments.find((d) => d.uri.fsPath === args[0])
          ?.isDirty ?? true,
      [TMP] as [string],
    )
    expect(isDirty, 'autosave must clear the dirty flag').toBe(false)

    // No echo storm / no dirty flicker: after autosave has settled, the document must not
    // spontaneously go dirty again on its own (the writeback-echo risk — our own autosave write
    // coming back through onDidChangeTextDocument and being mistaken for an external change).
    // This is a NEGATIVE assertion — there is no future condition to poll for, so a fixed sleep
    // is the correct shape here (see the vmarkd-testing skill's "fixed sleep is still correct"
    // section), not a poll that would just declare victory at the first quiet instant.
    await settle(frame, 3_000)
    const stillClean = await evaluateInVSCode(
      async (vscode: Vs, args: [string]) =>
        vscode.workspace.textDocuments.find((d) => d.uri.fsPath === args[0])
          ?.isDirty ?? true,
      [TMP] as [string],
    )
    expect(
      stillClean,
      'the document must not re-dirty on its own after autosave settled (writeback echo)',
    ).toBe(false)

    const finalText = await docText(evaluateInVSCode, TMP)
    expect(
      finalText,
      'the in-editor document text must still match the autosaved disk bytes 3s later',
    ).toBe(after)
  } finally {
    rmSync(TMP, { force: true })
    await setAutoSave(evaluateInVSCode, undefined, undefined)
  }
})
