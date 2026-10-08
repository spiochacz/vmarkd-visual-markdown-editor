import path from 'node:path'
import { test } from 'vscode-test-playwright'
import {
  assertSourceMatchesPreview,
  type CodeSourceMeasure,
  EXPAND_AND_MEASURE,
  MEASURE_PREVIEW,
  PREVIEW_CODE_SELECTOR,
} from '../parity/code-source'
import { PARITY_CONFIGS } from '../parity/configs'
import { applySettings, useSettingsRestore } from './settings-helpers'
import { wf } from './webview-helpers'

// Task 532 follow-up - the IR code block's EDITABLE SOURCE panel (expanded) has the Preview code
// block's background, text colour, font family/size and padding, driven by the active hljs style, in REAL VS Code.
// The parity matrix parks the caret and so only sees the collapsed render; this covers the source half.
// One boot per code theme (boot cost is per test - see playwright.config.ts).
const FIXTURE = path.join(__dirname, 'fixtures', 'parity-canon.md')
const BASE = PARITY_CONFIGS.find((c) => c.fast)?.settings ?? {}

const CASES: readonly [string, Record<string, unknown>][] = [
  ['auto code theme, Default Dark Modern', {}],
  ['monokai code theme', { 'vmarkd.theme.code': 'monokai' }],
  ['auto code theme, Monokai', { 'workbench.colorTheme': 'Monokai' }],
  [
    'auto code theme, Default High Contrast',
    { 'workbench.colorTheme': 'Default High Contrast' },
  ],
  [
    'a11y-light code theme, Default Light Modern',
    {
      'vmarkd.theme.code': 'a11y-light',
      'workbench.colorTheme': 'Default Light Modern',
    },
  ],
]

test.describe.configure({ retries: 0 })
useSettingsRestore(test, Object.keys(BASE))

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

for (const [label, extra] of CASES) {
  test(`IR code source panel matches the Preview code block - ${label}`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(240_000)
    await applySettings(evaluateInVSCode, { ...BASE, ...extra })
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
    await frame
      .locator('.vditor-ir .hljs span[class*="hljs-"]')
      .first()
      .waitFor({ timeout: 90_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
    const source = (await frame
      .locator('body')
      .evaluate(EXPAND_AND_MEASURE)) as CodeSourceMeasure
    await frame
      .locator(PREVIEW_CODE_SELECTOR)
      .first()
      .waitFor({ timeout: 30_000 })
    const preview = (await frame
      .locator('body')
      .evaluate(MEASURE_PREVIEW)) as Record<string, string> | null
    assertSourceMatchesPreview(source, preview)
  })
}
