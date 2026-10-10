// The trailing-paragraph invariant must follow a LIVE edit-mode switch (toolbar edit-mode item, no
// re-init). It used to be bound once at init to the element of the mode active THEN, so sv -> ir /
// sv -> wysiwyg / ir -> wysiwyg / wysiwyg -> ir left the newly active block mode without the "caret
// position below the last block". The opposite rule is just as load-bearing: the sv pane must NEVER
// get the paragraph (sv saves its pane's textContent; the paragraph's ZWSP seed would land in the
// file as "\n\n<ZWSP>\n").
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

type Mode = 'ir' | 'wysiwyg' | 'sv'
// Ends in a blockquote: an atomic last block, so a block mode must offer a trailing paragraph.
const DOC = '# T\n\npara\n\n> quoted\n'
const PANE: Record<Mode, string> = {
  ir: '.vditor-ir',
  wysiwyg: '.vditor-wysiwyg',
  sv: '.vditor-sv',
}

const trailingCount = (frame: ReturnType<typeof wf>, mode: Mode) =>
  frame.locator('body').evaluate((_b, sel) => {
    const pane = document.querySelector(sel as string)
    return pane ? pane.querySelectorAll('[data-vmarkd-trailing]').length : -1
  }, PANE[mode])

const switchMode = async (frame: ReturnType<typeof wf>, mode: Mode) => {
  await frame.locator('body').evaluate((_b, m) => {
    const btn = document.querySelector(
      `.vditor-toolbar button[data-mode="${m}"]`,
    )
    if (!btn) throw new Error(`mode button not found: ${m}`)
    btn.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
  }, mode)
  await frame
    .locator(`${PANE[mode]} .vditor-reset, ${PANE[mode]}.vditor-reset`)
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  await settle(frame, 1200)
}

const TRANSITIONS: [Mode, Mode][] = [
  ['sv', 'ir'],
  ['sv', 'wysiwyg'],
  ['ir', 'wysiwyg'],
  ['wysiwyg', 'ir'],
  ['ir', 'sv'],
]

for (const [from, to] of TRANSITIONS) {
  test(`trailing invariant follows a live switch ${from} -> ${to}`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    const file = path.join(tmpdir(), `vmarkd-trailing-switch-${Date.now()}.md`)
    writeFileSync(file, DOC)
    await openInMode(evaluateInVSCode, file, from)
    const frame = wf(workbox)
    await frame.locator(PANE[from]).first().waitFor({ timeout: 60_000 })
    await settle(frame, 1500)

    await switchMode(frame, to)

    if (to === 'sv') {
      expect(await trailingCount(frame, 'sv'), 'sv never gets one').toBe(0)
      // the sv pane's text is exactly the document: no ZWSP anywhere
      const text = await frame
        .locator('body')
        .evaluate(() => document.querySelector('.vditor-sv')?.textContent ?? '')
      expect(text.includes('​')).toBe(false)
      // edit + save: the file is the original plus the typed char, no escape-paragraph tail
      await frame
        .locator('.vditor-sv span[data-type="text"]')
        .filter({ hasText: 'quoted' })
        .first()
        .click()
      await workbox.keyboard.press('End')
      await workbox.keyboard.type('Q')
      await settle(frame, 1500)
      await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
        await vscode.commands.executeCommand('workbench.action.files.save')
      })
      await settle(frame, 800)
      const onDisk = readFileSync(file, 'utf8')
      expect(onDisk).toBe(DOC.replace('quoted', 'quotedQ'))
      expect(await docText(evaluateInVSCode, file)).toBe(onDisk)
    } else {
      await expect
        .poll(() => trailingCount(frame, to), { timeout: 10_000 })
        .toBe(1)
    }
    rmSync(file, { force: true })
  })
}

test('sv: ArrowDown on the last line does not manufacture a trailing paragraph', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  const file = path.join(tmpdir(), `vmarkd-sv-arrowdown-${Date.now()}.md`)
  writeFileSync(file, DOC)
  await openInMode(evaluateInVSCode, file, 'sv')
  const frame = wf(workbox)
  await frame.locator('.vditor-sv').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  await frame
    .locator('.vditor-sv span[data-type="text"]')
    .filter({ hasText: 'quoted' })
    .first()
    .click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('ArrowDown')
  await settle(frame, 800)
  await workbox.keyboard.type('Q')
  await settle(frame, 1500)
  expect(await trailingCount(frame, 'sv')).toBe(0)
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.files.save')
  })
  await settle(frame, 800)
  const onDisk = readFileSync(file, 'utf8')
  rmSync(file, { force: true })
  expect(onDisk.includes('​'), 'no ZWSP written by sv').toBe(false)
})
