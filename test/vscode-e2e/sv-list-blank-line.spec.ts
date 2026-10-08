// Task 532 step 7 (sv) — in split view a blank line INSIDE a multi-paragraph list item stays blank. The sv
// pane serializes its textContent, and the list-item renderer used to prefix the blank line with the item's
// padding span, so editing the item saved a whitespace-only "  " line. Fixed in the Lute blob
// (scripts/lute-blob-patch.mjs, sv-padding anchor).
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

const DOC = [
  '# Items',
  '',
  '- first',
  '',
  '  first continued',
  '',
  '  ```js',
  '  one',
  '',
  '  two',
  '  ```',
  '',
  '- second',
  '',
].join('\n')

const EDITED = DOC.replace('first continued', 'first continuedQ')

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('sv: editing a multi-paragraph list item saves no whitespace-only line', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const file = path.join(tmpdir(), 'vmarkd-sv-list-blank.md')
  writeFileSync(file, DOC)
  await openInMode(evaluateInVSCode, file, 'sv')
  const frame = wf(workbox)
  const pane = frame.locator('.vditor-sv').first()
  await pane.waitFor({ timeout: 60_000 })
  await settle(frame, 1000)

  const before = await pane.evaluate((el) => el.textContent ?? '')
  expect(before, 'the untouched pane has no whitespace-only line').not.toMatch(
    /^[ \t]+$/m,
  )

  await pane
    .locator('span[data-type="text"]')
    .filter({ hasText: 'first continued' })
    .first()
    .click()
  await settle(frame, 300)
  await workbox.keyboard.press('End')
  await workbox.keyboard.type('Q')
  await settle(frame, 1500)

  const value = await frame
    .locator('body')
    .evaluate(() => (window as any).vditor.getValue() as string)
  expect(value, 'getValue has no whitespace-only line').not.toMatch(/^[ \t]+$/m)

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await settle(frame, 800)
  const onDisk = readFileSync(file, 'utf8')
  const host = await docText(evaluateInVSCode, file)
  rmSync(file, { force: true })
  // sv appends its trailing-caret ZWSP line to ANY document it saves (pre-existing, unrelated to lists:
  // a two-paragraph doc does the same) — strip that tail so the assertion is about the list item.
  const body = (t: string) => t.replace(/\n+\u200b?\n*$/, '\n')
  expect(body(onDisk), 'the saved file keeps the blank lines blank').toBe(
    EDITED,
  )
  expect(body(host)).toBe(EDITED)
})
