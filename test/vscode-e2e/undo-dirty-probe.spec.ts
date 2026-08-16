import { stickySelection, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// REGRESSION (task 61 v2, Layer 1) — undoing back to the open state must leave the tab
// CLEAN and the bytes equal to disk. Before the fix this failed with finalDirty=true &
// textMatchesDisk=false (the minimal-diff write-back minimized against the current,
// already-reflowed document instead of the clean baseline, so the reflow never unwound).
// The fix: minimize against the clean baseline + a whole-doc semantic-no-op short-circuit
// that restores the original bytes verbatim when the net edit is zero.
const FIXTURE = path.join(__dirname, 'fixtures', 'undo-dirty.md')

test('undo-to-start dirty probe', async ({ workbox, evaluateInVSCode }) => {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const docState = () =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === args[0],
        )
        return { isDirty: !!doc?.isDirty, text: doc?.getText() ?? '' }
      },
      [FIXTURE] as [string],
    ) as Promise<{ isDirty: boolean; text: string }>

  const initial = await docState() // == disk bytes (VS Code just loaded the file)

  // PAGE-LEVEL keyboard focus into the nested webview iframe first — `p.focus()` below is DOM-level
  // INSIDE the iframe, while `workbox.keyboard` dispatches to the top Electron window; without this
  // click the keystrokes race that focus and get dropped (the "editing should mark dirty" flake).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })

  // caret at the end of the "Edit here" last line, type a few chars
  await stickySelection(
    frame,
    () => {
      const p = Array.from(
        document.querySelectorAll('.vditor-ir p, .vditor-ir li, .vditor-ir h1'),
      ).find((x) => x.textContent?.includes('Edit here')) as
        | HTMLElement
        | undefined
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
  await workbox.keyboard.type('abcdef', { delay: 50 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
  const afterEdit = await docState()

  // undo it all (webview captures Ctrl+Z → Vditor undo → forward WorkspaceEdit)
  for (let i = 0; i < 12; i++) {
    await workbox.keyboard.press('Control+z')
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 200)))
  }
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))
  const final = await docState()

  const textMatchesDisk = final.text === initial.text
  // eslint-disable-next-line no-console
  console.log(
    `[undo-dirty] initialDirty=${initial.isDirty} afterEditDirty=${afterEdit.isDirty} ` +
      `finalDirty=${final.isDirty} textMatchesDisk=${textMatchesDisk}\n` +
      `  layer=${final.isDirty ? (textMatchesDisk ? 'L2 (version-based dirty; content matches disk)' : 'L1 (content != disk after undo)') : 'NO BUG (clean after undo)'}\n` +
      `  initial tail=${JSON.stringify(initial.text.slice(-50))}\n` +
      `  final   tail=${JSON.stringify(final.text.slice(-50))}`,
  )
  expect(afterEdit.isDirty, 'editing should mark dirty').toBe(true)
  // LAYER 1 (fixed + guarded here): after undoing back to the open state the document
  // bytes are restored to disk EXACTLY → the git diff is clean. Before the fix this was
  // false (the write-back minimized against the already-reflowed doc, so the reflow never
  // unwound). This is the clean-diff guarantee.
  expect(
    textMatchesDisk,
    'undo back to the open state must restore the disk bytes exactly (clean diff)',
  ).toBe(true)
  // LAYER 2 (NOT fixed by this layer — tracked separately): VS Code's tab-dirty flag is
  // VERSION-based, not content-based. We route Ctrl+Z to Vditor's own undo engine (see
  // undo-keybind.ts) to avoid a full re-render jump, so VS Code's undo stack only grows;
  // the dirty dot therefore persists even though the content equals disk. Asserted as the
  // current (known) state so a future Layer-2 fix flips it deliberately, not silently.
  expect(
    final.isDirty,
    'KNOWN Layer 2: tab stays dirty (VS Code version-based) though content == disk',
  ).toBe(true)
})
