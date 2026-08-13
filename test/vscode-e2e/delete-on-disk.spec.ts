import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

// NET (task 516 A6) — the file backing an open vMarkd editor is deleted EXTERNALLY (the same shape
// as an out-of-band `rm` / `git clean`). Promoted from delete-on-disk-probe.spec.ts's measurement:
//
//   - The editor SURVIVES cleanly: no crash, no blank webview, no toast, no dialog. isDirty stays
//     `false` right after the delete — VS Code does not force-dirty a document just because its
//     backing file vanished.
//   - The webview keeps showing the last-known content untouched.
//   - Typing into it dirties the document normally (isDirty flips true, edit reaches the model).
//   - Saving RECREATES the file on disk with the FULL content (original + the new edit) — nothing
//     is lost.
//
// Why this net has NO red-lever half: `grep -rn existsSync|ENOENT src/` (product source) is empty,
// and `editor-session.ts`'s `setupFileWatcher` only wires `onDidChange`/`onDidCreate` — there is no
// `onDidDelete` handler at all. This journey's entire safety margin comes from code we do NOT
// have: VS Code core's TextDocument model not force-closing/dirtying on an external delete, and its
// save command writing to a URI unconditionally (creating it if missing). There is nothing of ours
// to break here — recorded rather than faked, same shape as A4's disk/dirty half.
const SRC = path.join(__dirname, 'fixtures', 'delete-on-disk.md')
const MARKER = 'DELETEDONDISKMARKER'

type Vs = typeof import('vscode')

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode: Vs) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('file deleted on disk while open: editor survives, content is recoverable by saving', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const original = readFileSync(SRC, 'utf8')
  const tmp = path.join(tmpdir(), 'vmarkd-delete-on-disk-net.md')
  writeFileSync(tmp, original)

  const docState = () =>
    evaluateInVSCode(
      async (vscode: Vs, args: [string]) => {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === args[0],
        )
        return { isDirty: doc?.isDirty ?? null, text: doc?.getText() ?? null }
      },
      [tmp] as [string],
    ) as Promise<{ isDirty: boolean | null; text: string | null }>

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

    // Delete the file completely outside VS Code.
    rmSync(tmp, { force: true })
    await settle(frame, 3000)

    // Editor survives: the webview is still there with the original content, no crash/blank.
    await expect(frame.locator('.vditor-ir')).toHaveCount(1)
    const bodyText = await frame
      .locator('body')
      .evaluate(() => document.body.innerText)
    expect(bodyText).toContain('CARET-ANCHOR paragraph')
    // No error surfaced to the user for the delete itself.
    const dialogCount = await workbox
      .locator('.monaco-dialog-box')
      .count()
    expect(dialogCount).toBe(0)

    const afterDelete = await docState()
    expect(
      afterDelete.isDirty,
      'VS Code does not force-dirty a document just because its file vanished',
    ).toBe(false)

    // Type an edit — it must reach the (still-open, now-fileless) document normally.
    await frame
      .locator('.vditor-ir')
      .first()
      .click({ position: { x: 4, y: 4 } })
    await frame.locator('body').evaluate(() => {
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
    })
    await workbox.keyboard.type(MARKER, { delay: 40 })

    await expect
      .poll(async () => (await docState()).isDirty, { timeout: 10_000 })
      .toBe(true)
    const dirty = await docState()
    expect(dirty.text).toContain(MARKER)

    // Save recreates the file with the FULL content — nothing lost.
    await evaluateInVSCode(async (vscode: Vs) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await expect
      .poll(async () => (await docState()).isDirty, { timeout: 15_000 })
      .toBe(false)

    const onDisk = readFileSync(tmp, 'utf8')
    expect(onDisk, 'the recreated file must contain the original content').toContain(
      '# Delete on disk',
    )
    expect(onDisk, 'the recreated file must contain the new edit too').toContain(
      MARKER,
    )
  } finally {
    rmSync(tmp, { force: true })
  }
})
