// Task 532 step 5a — the instant-paint overlay is painted in the mode the editor will OPEN in.
// With `vmarkd.editor.defaultMode: wysiwyg` the host used to paint the mode the previous session
// ended in (IR here: nothing saved), so the whole document re-laid-out at the swap. The host and the
// webview now share `resolveOpenMode`; the held overlay (VMARKD_PRERENDER_PARITY_HOLD, same hook as
// parity-matrix.spec.ts) must be the DOM of the configured mode.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore, applySettings } from './settings-helpers'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.md')

useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})
test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

for (const [defaultMode, overlay, live] of [
  ['wysiwyg', 'vditor-wysiwyg', 'vditor-wysiwyg'],
  // `preview` is IR plus the Preview overlay, never a Vditor mode of its own.
  ['preview', 'vditor-ir', 'vditor-ir'],
] as const) {
  test(`defaultMode ${defaultMode}: the held overlay is the ${overlay} DOM`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(120_000)
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.defaultMode': defaultMode,
    })
    await evaluateInVSCode(
      async (vscode, args) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('#vmarkd-prerender').waitFor({ timeout: 60_000 })
    const shape = await frame.locator('body').evaluate(() => ({
      wysiwyg: document.querySelectorAll('#vmarkd-prerender .vditor-wysiwyg')
        .length,
      ir: document.querySelectorAll('#vmarkd-prerender .vditor-ir').length,
    }))
    expect(shape.wysiwyg).toBe(overlay === 'vditor-wysiwyg' ? 1 : 0)
    expect(shape.ir).toBe(overlay === 'vditor-ir' ? 1 : 0)
    // …and it is the same mode the live editor mounts, so nothing re-flows at the swap.
    await frame
      .locator(`#app .${live}`)
      .first()
      .waitFor({ state: 'attached', timeout: 60_000 })
  })
}

// Review fix: a document over the streaming threshold boots IR whatever `defaultMode` says
// (vditor-init.ts), so the overlay must be IR too — not the configured WYSIWYG.
test('defaultMode wysiwyg on a streamed (>700k) document: the held overlay is the vditor-ir DOM', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)
  const file = path.join(os.tmpdir(), `vmarkd-openmode-large-${process.pid}.md`)
  fs.writeFileSync(
    file,
    Array.from(
      { length: 1200 },
      (_, i) => `## Section ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n`,
    ).join(''),
    'utf8',
  )
  try {
    await applySettings(evaluateInVSCode, {
      'vmarkd.editor.defaultMode': 'wysiwyg',
    })
    await evaluateInVSCode(
      async (vscode, args) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [file] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('#vmarkd-prerender').waitFor({ timeout: 60_000 })
    const shape = await frame.locator('body').evaluate(() => ({
      wysiwyg: document.querySelectorAll('#vmarkd-prerender .vditor-wysiwyg')
        .length,
      ir: document.querySelectorAll('#vmarkd-prerender .vditor-ir').length,
    }))
    expect(shape).toEqual({ wysiwyg: 0, ir: 1 })
  } finally {
    fs.rmSync(file, { force: true })
  }
})
