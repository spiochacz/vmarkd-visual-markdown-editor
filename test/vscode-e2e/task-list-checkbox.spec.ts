// Task 532 step 7 — a task-list checkbox keeps its source form when you edit around it: `[x]` / `[X]` /
// `[ ]` as written and exactly ONE space before the text. Lute used to write `[X]  a` (upper-cased,
// two spaces) for every item of the list once any of it was edited. Fixed in the Lute blob
// (scripts/lute-blob-patch.mjs, task-list anchors), so one document per mode covers the editor's
// getValue() and the saved file (host write-back) through the real custom-editor pipeline.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

const DOC = [
  '# Tasks',
  '',
  '- [ ] open item',
  '- [x] lower done',
  '- [X] upper done',
  '- [ ] **bold** start',
  '  - [x] nested done',
  '',
  'Between.',
  '',
  '- [ ] loose one',
  '',
  '- [x] loose two',
  '',
].join('\n')

const EDITED = DOC.replace('lower done', 'lower doneQ')

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`an edit inside a task list keeps every checkbox as written in getValue and the saved file (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    const file = path.join(tmpdir(), `vmarkd-task-checkbox-${mode}.md`)
    writeFileSync(file, DOC)
    await openInMode(evaluateInVSCode, file, mode)
    const frame = wf(workbox)
    const surface = frame.locator(`.vditor-${mode}`).first()
    await surface.waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    await surface
      .locator('li')
      .filter({ hasText: 'lower done' })
      .first()
      .click()
    await settle(frame, 300)
    await workbox.keyboard.press('End')
    await workbox.keyboard.type('Q')
    await settle(frame, 1500)

    const value = await frame
      .locator('body')
      .evaluate(() => (window as any).vditor.getValue() as string)
    expect(value, 'getValue keeps [x] / [X] / [ ] and one space').toBe(EDITED)

    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await settle(frame, 800)
    const onDisk = readFileSync(file, 'utf8')
    const host = await docText(evaluateInVSCode, file)
    rmSync(file, { force: true })
    expect(onDisk, 'the saved file keeps every checkbox').toBe(EDITED)
    expect(host).toBe(EDITED)
  })
}
