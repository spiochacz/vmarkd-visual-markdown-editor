// Task 530 — hard line breaks (`two spaces` / `\` at a line end) survive editing their paragraph and a
// save, and Shift+Enter in prose makes a real one. End to end through the real custom-editor pipeline:
// the minimal-diff write-back keeps UNTOUCHED blocks' bytes, so only an EDITED paragraph can show a
// loss — each case below is its own paragraph of ONE document per mode (a VS Code boot is paid per
// test, not per case), edited in turn, saved once, and compared block by block, byte for byte.
//
// Layout of the document, in order: hard-broken paragraphs each followed by a different block kind
// (the kind decided the old failure: glued vs softened), a break inside a quote and a list item, a
// 3-space and a 4-space break; then the Shift+Enter cases (typed after / saved bare / end of **bold**). A CRLF file and a loose-list file are opened in the same test.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import {
  type EvaluateInVSCode,
  docText,
  openInMode,
  settle,
  wf,
} from './webview-helpers'

const MARK = 'Q'
// Built line by line: a trailing two-space hard break inside a template literal is invisible and gets
// stripped by editors/formatters (it was, once — the spec then only covered the backslash form).
// `'\\'` in a string literal is ONE backslash in the file.
const SP = '  '
const DOC = [
  '# hard breaks',
  '',
  `Before quote one${SP}`,
  'before quote two\\',
  'before quote three',
  '',
  '> a quote',
  '',
  `Before list one${SP}`,
  'before list two\\',
  'before list three',
  '',
  '- an item',
  '',
  `Before para one${SP}`,
  'before para two\\',
  'before para three',
  '',
  `> Cited one${SP}`,
  '> cited two\\',
  '> cited three',
  '',
  `- Listed one${SP}`,
  '  listed two\\',
  '  listed three',
  '',
  'Spaces one   ',
  'spaces two',
  '',
  `Spaces four${' '.repeat(4)}`,
  'spaces four two',
  '',
  'Shift typed',
  '',
  'Shift bare',
  '',
  '**bold**',
  '',
  'A closing paragraph.',
  '',
].join('\n')
// Paragraphs that get one typed character; the comparison removes it again.
const EDITED = [
  'Before quote',
  'Before list',
  'Before para',
  'Cited one',
  'Listed one',
  'Spaces one',
  'Spaces four',
]

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

// The editor's whole-document getValue() (mode switch / copy / sv paths read this, not the saved file).
const docValue = (frame: ReturnType<typeof wf>) =>
  frame
    .locator('body')
    .evaluate(() => (window as any).vditor.getValue() as string)

const blocks = (md: string) => md.split(/\n{2,}/)

async function save(
  evaluateInVSCode: EvaluateInVSCode,
  frame: ReturnType<typeof wf>,
) {
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await settle(frame, 500)
}

for (const mode of ['ir', 'wysiwyg'] as const) {
  test(`hard breaks survive editing, Shift+Enter makes one, and a CRLF file keeps its breaks (${mode})`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(300_000)
    const file = path.join(tmpdir(), `vmarkd-hard-break-${mode}.md`)
    writeFileSync(file, DOC)
    await openInMode(evaluateInVSCode, file, mode)
    const frame = wf(workbox)
    const surface = frame.locator(`.vditor-${mode}`).first()
    await surface.waitFor({ timeout: 60_000 })
    await settle(frame, 500)

    const clickIn = async (selector: string, text: string) => {
      await surface.locator(selector).filter({ hasText: text }).first().click()
      await settle(frame, 300)
    }
    const shiftEnterAtEnd = async (selector: string, text: string) => {
      await clickIn(selector, text)
      await workbox.keyboard.press('End')
      await workbox.keyboard.press('Shift+Enter')
      await settle(frame, 1000)
    }

    // 1. Shift+Enter with NOTHING typed after it: the whole-document value stays the editor's own
    //    canonical value of the untouched document, byte for byte (an unfilled break adds nothing).
    const untouched = await docValue(frame)
    await shiftEnterAtEnd('p', 'Shift bare')
    expect(await docValue(frame), 'bare Shift+Enter, paragraph').toBe(untouched)
    await shiftEnterAtEnd('p', 'bold')
    expect(await docValue(frame), 'bare Shift+Enter, end of **bold**').toBe(
      untouched,
    )

    // 2. Shift+Enter then typing: a backslash hard break.
    await shiftEnterAtEnd('p', 'Shift typed')
    await workbox.keyboard.type('more')
    await expect
      .poll(
        async () => (await docText(evaluateInVSCode, file)).includes('more'),
        {
          message: 'the Shift+Enter edit reached the host document',
        },
      )
      .toBe(true)

    // 3. One typed character per hard-broken paragraph. Where in the paragraph it lands does not
    //    matter (the comparison removes it), only that it lands inside that paragraph.
    for (const lead of EDITED) {
      await clickIn('p, li', lead)
      await workbox.keyboard.type(MARK)
      await expect
        .poll(
          async () =>
            blocks(await docText(evaluateInVSCode, file)).some(
              (b) => b.includes(lead) && b.includes(MARK),
            ),
          { message: `the edit of "${lead}" reached the host document` },
        )
        .toBe(true)
    }

    await save(evaluateInVSCode, frame)
    const saved = readFileSync(file, 'utf8')
    console.log(`[hard-break ${mode}] saved: ${JSON.stringify(saved)}`)
    rmSync(file, { force: true })

    const want = blocks(DOC)
    const got = blocks(saved)
    for (const lead of EDITED) {
      const before = want.find((b) => b.includes(lead))
      const after = got.find((b) => b.includes(lead))?.replace(MARK, '')
      expect.soft(after, `${lead}: hard breaks kept`).toBe(before)
    }
    expect
      .soft(
        got.find((b) => b.startsWith('Shift typed')),
        'Shift+Enter then typing: a backslash hard break',
      )
      .toBe('Shift typed\\\nmore')
    // Everything that was not edited — including the three bare-Shift+Enter blocks — is
    // byte-identical (minimal-diff write-back; no backslash, no ZWSP).
    expect
      .soft(
        got.filter(
          (b) =>
            !b.includes(MARK) &&
            !b.startsWith('Shift typed') &&
            !b.startsWith('Shift bare'),
        ),
        'untouched blocks unchanged',
      )
      .toEqual(
        want.filter(
          (b) =>
            !EDITED.some((lead) => b.includes(lead)) &&
            !b.startsWith('Shift typed') &&
            !b.startsWith('Shift bare'),
        ),
      )
    expect.soft(got.find((b) => b.startsWith('Shift bare'))).toBe('Shift bare')
    expect.soft(saved).not.toContain('​')

    // 4. A CRLF document reaches the editor un-normalized, and Lute reads the breaks through `\r\n` —
    //    editing such a paragraph must keep both forms.
    const crlfFile = path.join(tmpdir(), `vmarkd-hard-break-crlf-${mode}.md`)
    writeFileSync(
      crlfFile,
      [
        '# crlf',
        '',
        `Crlf one${SP}`,
        'crlf two\\',
        'crlf three',
        '',
        'Tail.',
        '',
      ].join('\r\n'),
    )
    await openInMode(evaluateInVSCode, crlfFile, mode)
    const crlfSurface = wf(workbox).locator(`.vditor-${mode}`).first()
    await crlfSurface.waitFor({ timeout: 60_000 })
    await settle(frame, 500)
    await crlfSurface
      .locator('p')
      .filter({ hasText: 'Crlf one' })
      .first()
      .click()
    await settle(frame, 300)
    await workbox.keyboard.type(MARK)
    await expect
      .poll(
        async () => (await docText(evaluateInVSCode, crlfFile)).includes(MARK),
        { message: 'the CRLF edit reached the host document' },
      )
      .toBe(true)
    await save(evaluateInVSCode, frame)
    const crlfSaved = readFileSync(crlfFile, 'utf8').replace(/\r\n/g, '\n')
    console.log(`[hard-break crlf ${mode}] saved: ${JSON.stringify(crlfSaved)}`)
    rmSync(crlfFile, { force: true })
    expect(
      blocks(crlfSaved)
        .find((b) => b.includes('Crlf one'))
        ?.replace(MARK, ''),
    ).toBe(`Crlf one${SP}\ncrlf two\\\ncrlf three`)

    // 5. Shift+Enter at the end of a LOOSE list item, nothing typed: no literal backslash and the
    //    whole-document value is the editor's own canonical value of the untouched file.
    const looseDoc = '- item\n\n  other\n\n- last\n'
    const looseFile = path.join(tmpdir(), `vmarkd-hard-break-loose-${mode}.md`)
    writeFileSync(looseFile, looseDoc)
    await openInMode(evaluateInVSCode, looseFile, mode)
    const looseSurface = wf(workbox).locator(`.vditor-${mode}`).first()
    await looseSurface.waitFor({ timeout: 60_000 })
    await settle(frame, 500)
    // Lute's canonical value of the untouched document (it drops the blank line before `- last`).
    const looseBefore = await docValue(frame)
    await looseSurface
      .locator('li p')
      .filter({ hasText: 'item' })
      .first()
      .click()
    await settle(frame, 300)
    await workbox.keyboard.press('End')
    await workbox.keyboard.press('Shift+Enter')
    await settle(frame, 1000)
    expect(await docValue(frame), 'bare Shift+Enter, loose list item').toBe(
      looseBefore,
    )
    await save(evaluateInVSCode, frame)
    const looseSaved = readFileSync(looseFile, 'utf8')
    rmSync(looseFile, { force: true })
    expect(looseSaved).not.toContain('\\')
    expect(looseSaved).toBe(looseDoc)
  })
}
