import { docText, type EvaluateInVSCode, wf } from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 191 P0-4) — copy/cut on the REAL wire. The data-loss net: a cut followed by a
// save must remove EXACTLY the selected block from the file on disk, leaving the rest intact
// (this is the leg the L2 copy-cut spec could not prove — a synthetic ClipboardEvent doesn't
// drive Vditor's real input→edit→writeback pipeline; a real Ctrl+X does). Also verifies the
// copied text reaches VS Code's clipboard.

const DIR = path.join(tmpdir(), 'vmarkd-p04-clip')
const DOC = path.join(DIR, 'note.md')

async function openDoc(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  body: string,
) {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(DOC, body)
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
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))
  return frame
}

// Select the paragraph whose text contains `needle` with a REAL triple-click (the way a
// user selects a line before Ctrl+X/Ctrl+C — cleaner than a programmatic Range, which raced
// the native cut and merged blocks).
async function selectParagraph(frame: ReturnType<typeof wf>, needle: string) {
  await frame
    .locator('.vditor-ir p, .vditor-ir li, .vditor-ir h1')
    .filter({ hasText: needle })
    .first()
    .click({ clickCount: 3 })
}

test('cutting a block then saving removes exactly it from the file on disk', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await openDoc(
    evaluateInVSCode,
    workbox,
    '# Doc\n\nKEEPLINE stays here.\n\nDELETEME goes away.\n\nTAILLINE stays too.\n',
  )
  await selectParagraph(frame, 'DELETEME')
  await workbox.keyboard.press('Control+x')

  // The real cut → input → writeback removes the block from the live TextDocument…
  await expect
    .poll(() => docText(evaluateInVSCode, DOC), {
      timeout: 10_000,
      intervals: [200, 400, 800],
    })
    .not.toContain('DELETEME')

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
  // …and the save persisted that removal while keeping every other block verbatim.
  expect(onDisk).not.toContain('DELETEME')
  expect(onDisk).toContain('KEEPLINE stays here.')
  expect(onDisk).toContain('TAILLINE stays too.')
  expect(onDisk).toContain('# Doc')
})

test('copying a selection puts its markdown on the VS Code clipboard', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await openDoc(
    evaluateInVSCode,
    workbox,
    '# Doc\n\nCOPYME unique phrase.\n',
  )
  await selectParagraph(frame, 'COPYME')
  await workbox.keyboard.press('Control+c')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 400)))

  const clip = (await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => vscode.env.clipboard.readText(),
    [] as [],
  )) as string
  rmSync(DIR, { recursive: true, force: true })
  // The IR copy handler serialized the selection to markdown source onto the clipboard.
  expect(clip).toContain('COPYME unique phrase.')
})
