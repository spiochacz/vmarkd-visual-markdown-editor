// B4 (tasks/516 Phase 2) — find widget × lifecycle. With the find widget open (and focused),
// switching the Vditor edit mode and then saving must not leak anything into the document. The
// find widget is HOST workbench UI sitting outside the webview iframe (task 514's own framing);
// a Vditor mode switch only touches DOM INSIDE the iframe, so the two should be fully
// independent — this spec proves that isn't just an assumption.
//
// Real-VS-Code only: the find widget doesn't exist in the chromium harness (task 514 precedent).
//
// No product lever to break here (this journey's guarantee is architectural — the find widget is
// host chrome, never a webview citizen — the same shape as A4/A6's "no red proof" precedent), so
// the red proof is a mutation check on the core assertion instead: temporarily requiring
// `ORIGINAL + 'MUTATION-CHECK'` failed as expected (confirmed, then reverted) before landing this.
import { docText, ev, wf } from './webview-helpers'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-widget-lifecycle.md')
const ORIGINAL = ['# Find lifecycle', '', 'alpha bravo charlie', ''].join('\n')
writeFileSync(FIXTURE, ORIGINAL)

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('find widget stays clean across a mode switch and a Ctrl+S while it has focus', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

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
    FIXTURE,
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))
  await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })

  // Open the find widget and type a query — establishes "the widget is open with real state",
  // the precondition the journey needs.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('editor.action.webvieweditor.showFind')
  })
  const findInput = workbox.locator('.simple-find-part input').first()
  await findInput.waitFor({ timeout: 15_000 })
  await workbox.keyboard.type('bravo')
  await workbox.waitForTimeout(300)

  // Switch the Vditor edit mode WHILE the find widget is open (content-visibility-modes.spec.ts's
  // pattern for driving the toolbar's edit-mode dropdown from inside the webview).
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
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))

  // The find widget is host chrome, independent of the webview's internal mode — it should have
  // survived the switch untouched. Re-focus it explicitly (a real user re-clicking the box after
  // watching the pane change is exactly this) rather than assuming stale focus held.
  await findInput.click()
  await expect(findInput).toBeFocused()

  // Ctrl+S while the find input — not the editor — has focus.
  await workbox.keyboard.press('Control+s')
  await workbox.waitForTimeout(1000)

  // Nothing leaked: the document is byte-identical to what was on disk before any of this (no
  // stray "s", no "bravo" query text, no mode-switch artifact).
  const liveText = await docText(evaluateInVSCode, FIXTURE)
  expect(liveText).toBe(ORIGINAL)

  const dirty = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments.find((d) => d.uri.fsPath === args[0])
        ?.isDirty ?? false,
    [FIXTURE] as [string],
  )
  expect(dirty, 'save left the document dirty').toBe(false)

  expect(readFileSync(FIXTURE, 'utf8')).toBe(ORIGINAL)
})
