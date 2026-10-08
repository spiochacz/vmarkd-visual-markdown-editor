// Task 532 step 6 — a list with blank lines between its items (a LOOSE list) keeps them when you edit it.
// The serializer used to write every list back tight, so one keystroke inside a loose list rewrote the
// file (and the Preview, which renders the editor's own serialization, showed it tight). Fixed in the
// Lute blob (scripts/lute-blob-patch.mjs, loose-list anchors), so ONE document per mode covers every
// consumer end to end through the real custom-editor pipeline: the editor's getValue(), the saved file
// (host write-back), and the full Preview. A tight list in the same document must stay tight.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

const DOC = [
  '# Lists',
  '',
  '- alpha',
  '',
  '- beta',
  '',
  '- gamma',
  '',
  'Between.',
  '',
  '- t1',
  '- t2',
  '',
  '3. one',
  '',
  '4. two',
  '',
].join('\n')

const EDITED = DOC.replace('- beta', '- betaQ')

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`an edit inside a loose list keeps its blank lines in getValue, the saved file and the Preview (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    const file = path.join(tmpdir(), `vmarkd-list-loose-${mode}.md`)
    writeFileSync(file, DOC)
    await openInMode(evaluateInVSCode, file, mode)
    const frame = wf(workbox)
    const surface = frame.locator(`.vditor-${mode}`).first()
    await surface.waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    await surface.locator('li').filter({ hasText: 'beta' }).first().click()
    await settle(frame, 300)
    await workbox.keyboard.press('End')
    await workbox.keyboard.type('Q')
    await settle(frame, 1500)

    const value = await frame
      .locator('body')
      .evaluate(() => (window as any).vditor.getValue() as string)
    expect(value, 'getValue keeps the loose list loose').toContain(
      '- alpha\n\n- betaQ\n\n- gamma\n',
    )
    expect(value, 'the tight list stays tight').toContain('- t1\n- t2\n')
    expect(value, 'the ordered loose list keeps its start number').toContain(
      '3. one\n\n4. two',
    )

    // The Preview renders the editor's own serialization: loose items must wrap their text in <p>.
    const shape = await frame.locator('body').evaluate(async () => {
      const v = (window as any).vditor.vditor
      v.preview.element.style.display = 'block'
      v[v.currentMode].element.parentElement.style.display = 'none'
      v.preview.render(v)
      await new Promise((r) => setTimeout(r, 1500))
      const root = v.preview.previewElement as HTMLElement
      return Array.from(root.querySelectorAll('ul, ol')).map((l) =>
        Array.from(l.children)
          .map((li) => (li.querySelector(':scope > p') ? 'p' : '-'))
          .join(''),
      )
    })
    expect(
      shape,
      'Preview: loose lists wrap items in <p>, tight does not',
    ).toEqual(['ppp', '--', 'pp'])

    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await settle(frame, 800)
    const onDisk = readFileSync(file, 'utf8')
    const host = await docText(evaluateInVSCode, file)
    rmSync(file, { force: true })
    expect(onDisk, 'the saved file keeps every blank line').toBe(EDITED)
    expect(host).toBe(EDITED)
  })
}
