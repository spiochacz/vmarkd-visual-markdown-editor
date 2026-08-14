import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'auto-theme-pairing.md')

// This spec's whole point is flipping `workbench.colorTheme` and `vmarkd.theme.content` live during
// the test, so it can't pin them — but it must not leak the flips into later specs.
useSettingsRestore(test, [
  'vmarkd.theme.content',
  'markdown.preview.fontFamily',
  'workbench.colorTheme',
])

async function activeContentTheme(frame: ReturnType<typeof wf>): Promise<{
  link: string | null
  markdownBody: boolean
  useVscodeVars: string | null
  fontFamily: string
}> {
  return frame.locator('body').evaluate(() => ({
    link:
      [...document.querySelectorAll<HTMLLinkElement>('link[id^="ct-"]')].find(
        (l) => !l.disabled,
      )?.id ?? null,
    markdownBody: document.body.classList.contains('markdown-body'),
    useVscodeVars: document.body.getAttribute('data-use-vscode-theme-color'),
    fontFamily: getComputedStyle(
      document.querySelector('.vditor-reset') ?? document.body,
    ).fontFamily,
  }))
}

test('auto mode pairs with the active standard VS Code content theme', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'auto', vscode.ConfigurationTarget.Global)
      await vscode.workspace
        .getConfiguration('markdown')
        .update(
          'preview.fontFamily',
          'Arial, sans-serif',
          vscode.ConfigurationTarget.Global,
        )
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', 'Dark+', vscode.ConfigurationTarget.Global)
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
  await expect(frame.locator('.vditor-ir')).toHaveCount(1, {
    timeout: 45_000,
  })
  await expect
    .poll(() => activeContentTheme(frame), { timeout: 45_000 })
    .toMatchObject({
      link: 'ct-vscode-dark-2026',
      markdownBody: true,
      useVscodeVars: '0',
    })

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', 'Light+', vscode.ConfigurationTarget.Global)
  })
  await expect
    .poll(() => activeContentTheme(frame), { timeout: 45_000 })
    .toMatchObject({
      link: 'ct-vscode-light-2026',
      markdownBody: true,
      useVscodeVars: '0',
    })

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', 'Abyss', vscode.ConfigurationTarget.Global)
  })
  await expect
    .poll(() => activeContentTheme(frame), { timeout: 45_000 })
    .toMatchObject({
      link: null,
      markdownBody: false,
      useVscodeVars: '1',
      fontFamily: 'Arial, sans-serif',
    })

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('markdown')
      .update(
        'preview.fontFamily',
        'Georgia, serif',
        vscode.ConfigurationTarget.Global,
      )
  })
  await expect
    .poll(() => activeContentTheme(frame), { timeout: 45_000 })
    .toMatchObject({ fontFamily: 'Georgia, serif' })
  // Cleanup is handled by the `useSettingsRestore` afterEach above (undefined, not a pinned
  // fallback value — see settings-helpers.ts rule 2 for why that matters).
})
