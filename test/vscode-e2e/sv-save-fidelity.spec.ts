// Split view (sv) saves exactly the user's text. Two pre-existing defects, both in what the sv pane's
// textContent holds (Vditor's sv getMarkdown IS `textContent`, no Lute DOM -> Md):
//  - ANY edit appended "\n\n<ZWSP>\n" to the saved file (a plain two-paragraph document did it too);
//  - a blank line inside a blockquote was written `> ` (trailing space) instead of `>`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { docText, openInMode, settle, wf } from './webview-helpers'

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

const CASES: Record<string, { doc: string; word: string }> = {
  'plain two-paragraph document': {
    doc: '# T\n\nfirst para\n\nsecond para\n',
    word: 'second para',
  },
  'blockquote with a blank line (source `>` stays `>`)': {
    doc: '# T\n\n> quoted one\n>\n> quoted two\n\nafter\n',
    word: 'after',
  },
}

for (const [name, { doc, word }] of Object.entries(CASES)) {
  test(`sv: editing saves exactly the user's text — ${name}`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    const file = path.join(tmpdir(), `vmarkd-sv-fidelity-${Date.now()}.md`)
    writeFileSync(file, doc)
    await openInMode(evaluateInVSCode, file, 'sv')
    const frame = wf(workbox)
    const pane = frame.locator('.vditor-sv').first()
    await pane.waitFor({ timeout: 60_000 })
    await settle(frame, 1000)

    await pane
      .locator('span[data-type="text"]')
      .filter({ hasText: word })
      .first()
      .click()
    await settle(frame, 300)
    await workbox.keyboard.press('End')
    await workbox.keyboard.type('Q')
    await settle(frame, 1500)

    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    })
    await settle(frame, 800)
    const onDisk = readFileSync(file, 'utf8')
    const host = await docText(evaluateInVSCode, file)
    rmSync(file, { force: true })
    const expected = doc.replace(word, `${word}Q`)
    expect(onDisk, 'the saved file is the original plus the typed Q').toBe(
      expected,
    )
    expect(host).toBe(expected)
  })
}
