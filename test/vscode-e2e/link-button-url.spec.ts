import {
  type EvaluateInVSCode,
  docText,
  ev,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 390 — clicking the link button with a URL selected must put that URL in BOTH halves of the
// link: `[https://example.com](https://example.com)`. Vditor treated the selection as label text
// unconditionally, so the destination stayed the literal `https://` placeholder — the one thing the
// user had already supplied was the one thing the link lacked.
//
// Asserted against the document ON DISK, not the DOM: a DOM assertion would pass on an <a> whose
// href never reaches the markdown, and the markdown is what the user keeps.
//
// The plain-text case is asserted in the same spec on purpose. The fix is a branch, and a branch can
// be got backwards — a spec that only proved the new behaviour would not notice the old one being
// swallowed with it.

let bootCount = 0
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  name: string,
  body: string,
) {
  // A unique path per test — VS Code keeps a TextDocument alive per fsPath, so a reused name hands
  // the next test the previous one's in-memory content whatever is written to disk.
  const tmp = path.join(TEMP_DIR, `${process.pid}-${bootCount++}-${name}`)
  writeFileSync(tmp, body)
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    tmp,
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  return { tmp, frame }
}

/** Select exactly `needle` inside the given editable surface. */
async function selectText(
  frame: ReturnType<typeof wf>,
  surface: string,
  needle: string,
) {
  await frame
    .locator(surface)
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [sel, text] = args as [string, string]
      const root = document.querySelector(sel) as HTMLElement | null
      if (!root) throw new Error(`surface ${sel} not found`)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(text)
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i)
        r.setEnd(n as Text, i + text.length)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(n.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`"${text}" not found in ${sel}`)
    },
    [surface, needle] as [string, string],
  )
}

/** Click the toolbar's link button the way a user does. */
async function clickLinkButton(frame: ReturnType<typeof wf>) {
  await frame
    .locator('.vditor-toolbar [data-type="link"]')
    .first()
    .dispatchEvent('click')
}

const URL = 'https://example.com/a-paper'

test('IR: URL and ordinary-text selections take their respective link destinations', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-link-url-ir.md',
    `# Links\n\nSee ${URL} for details.\n`,
  )

  await selectText(frame, '.vditor-ir', URL)
  await clickLinkButton(frame)

  await expect.soft
    .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
    .toContain(`[${URL}](${URL})`)
  // …and NOT the placeholder that was the whole defect.
  expect.soft(await docText(evaluateInVSCode, tmp)).not.toContain('](https://)')

  rmSync(tmp, { force: true })
  // The other half of the branch. Text is not a URL, so it stays the label and the destination is
  // the placeholder for the user to fill in — unchanged behaviour, deliberately pinned.
  const { tmp: plainTmp, frame: plainFrame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-link-text-ir.md',
    '# Links\n\nRead the paper carefully.\n',
  )

  await selectText(plainFrame, '.vditor-ir', 'the paper')
  await clickLinkButton(plainFrame)

  await expect.soft
    .poll(() => docText(evaluateInVSCode, plainTmp), { timeout: 20_000 })
    .toContain('[the paper](https://)')

  rmSync(plainTmp, { force: true })
})

test('WYSIWYG: a selected URL becomes the link destination as well as its text', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-link-url-wysiwyg.md',
    `# Links\n\nSee ${URL} for details.\n`,
  )
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  await settle(frame, 2500)

  await selectText(frame, '.vditor-wysiwyg', URL)
  await clickLinkButton(frame)

  await expect
    .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
    .toContain(`[${URL}](${URL})`)

  rmSync(tmp, { force: true })
})
