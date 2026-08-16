import { stickySelection, wf } from './webview-helpers'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 191 P0-14) — the IMAGE UPLOAD wire on the REAL VS Code editor, end to end.
// Re-opens the task-190 P1 deferral with the plan's insight: an IN-FRAME synthetic
// files-paste (not the OS clipboard) sidesteps the clipboard-bridge flake the deferral
// feared. A pasted image File must: reach the host upload handler, be WRITTEN into the
// assets folder next to the document, and have its `![](assets/…)` link inserted into the
// saved document. Exercises the extracted createUploadHandler + sanitizeUploadName (P1-18)
// and the host's basename/containment guard on the real wire.

const DIR = path.join(tmpdir(), 'vmarkd-p014-upload')
const DOC = path.join(DIR, 'note.md')
const ASSETS = path.join(DIR, 'assets')
// 1×1 transparent PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('pasting an image writes it into the assets folder and inserts its link into the saved doc', async ({
  workbox,
  evaluateInVSCode,
}) => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(DOC, '# Upload target\n\nCaret here.\n')

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [DOC] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // Dispatch a synthetic image-File paste on the editable element (caret at end).
  await stickySelection(
    frame,
    (_b, b64) => {
      const inst = (window as any).vditor
      const el = inst.vditor[inst.getCurrentMode()].element as HTMLElement
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      const s = window.getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    PNG_B64,
  )

  // The host writes the decoded image into the assets folder next to the doc.
  await expect
    .poll(
      () =>
        existsSync(ASSETS) &&
        readdirSync(ASSETS).filter((f) => /\.(png|webp)$/.test(f)).length,
      { timeout: 15_000, intervals: [200, 400, 800] },
    )
    .toBeGreaterThan(0)
  const written = readdirSync(ASSETS).filter((f) => /\.(png|webp)$/.test(f))
  // Name is sanitized + timestamp-prefixed (P1-18), never a traversal segment.
  for (const f of written) {
    expect(f).toMatch(/^\d{8}_\d{6}_.+\.(png|webp)$/)
    expect(f).not.toContain('..')
  }

  // The `![](assets/…)` link is inserted into the live document…
  await expect
    .poll(
      async () =>
        (await evaluateInVSCode(
          async (vscode: typeof import('vscode'), args: string[]) =>
            vscode.workspace.textDocuments
              .find((d) => d.uri.fsPath === args[0])
              ?.getText() ?? '',
          [DOC] as [string],
        )) as string,
      { timeout: 15_000, intervals: [200, 400, 800] },
    )
    .toMatch(/!\[\]\(assets\/\d{8}_\d{6}_.+\.(png|webp)\)/)

  // …and it survives a save to disk, with the untouched prose intact.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    },
    [] as [],
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 800)))

  const onDisk = readFileSync(DOC, 'utf8')
  rmSync(DIR, { recursive: true, force: true })
  expect(onDisk).toMatch(/!\[\]\(assets\/\d{8}_\d{6}_.+\.(png|webp)\)/)
  expect(onDisk).toContain('# Upload target')
})
