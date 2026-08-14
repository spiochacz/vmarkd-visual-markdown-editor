import { wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// NET+PROBE (task 190 P1) — settings must apply to an OPEN editor without reopening (J27, which
// had no real-wire coverage). Two mechanisms: a pure live CSS swap (css.custom → reload-css →
// swapStyle of <style id="custom-css">) and a constructor-only option that forces a live re-init
// (codeLineNumbers → initOnlyChanged → re-init with content preserved). We assert an `outline`
// rule (no specificity war with the theme) applies AND updates, and that the re-init keeps content.
const SRC = path.join(__dirname, 'fixtures', 'torture.md')

// This spec's whole point is applying `css.custom` and `editor.codeLineNumbers` live to an
// ALREADY-OPEN editor, so the writes and their timing relative to the assertions can't be pinned
// up front — just declare the keys for cleanup.
useSettingsRestore(test, ['vmarkd.css.custom', 'vmarkd.editor.codeLineNumbers'])

test('css.custom and a re-init setting apply live to the open editor', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  const tmp = path.join(tmpdir(), 'vmarkd-settings-live.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [tmp] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const setConfig = async (key: string, value: unknown) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: [string, unknown]) => {
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update(args[0], args[1], vscode.ConfigurationTarget.Global)
      },
      [key, value] as [string, unknown],
    )
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  }

  const outlineColor = () =>
    frame.locator('body').evaluate(() => {
      const el =
        (document.querySelector('.vditor-reset') as HTMLElement) ??
        (document.querySelector('.vditor-ir') as HTMLElement)
      return getComputedStyle(el).outlineColor
    }) as Promise<string>

  try {
    // 1. A live custom-CSS swap applies without reopen.
    await setConfig(
      'css.custom',
      '.vditor-reset{outline:2px solid rgb(3, 5, 7)}',
    )
    expect(await outlineColor(), 'css.custom applied live').toBe('rgb(3, 5, 7)')
    // 2. …and a SECOND swap replaces it live (not just an initial injection).
    await setConfig(
      'css.custom',
      '.vditor-reset{outline:2px solid rgb(9, 8, 7)}',
    )
    expect(await outlineColor(), 'css.custom re-applied live').toBe(
      'rgb(9, 8, 7)',
    )

    // 3. A constructor-only setting (codeLineNumbers) triggers a live re-init that must NOT
    //    lose the document content.
    await setConfig('editor.codeLineNumbers', true)
    const stillThere = await frame
      .locator('body')
      .evaluate(() =>
        (
          document.querySelector('.vditor-ir') as HTMLElement
        ).innerText.includes('Torture document'),
      )
    expect(stillThere, 're-init after a setting change preserved content').toBe(
      true,
    )
  } finally {
    // Global settings cleanup is handled by the `useSettingsRestore` afterEach above (undefined,
    // not a fallback value — see settings-helpers.ts rule 2 for why that matters).
    rmSync(tmp, { force: true })
  }
})
