import { test } from './coverage-fixture'
import type { ParityConfig } from '../../test/parity/configs'
import {
  assertSourceMatchesPreview,
  type CodeSourceMeasure,
  EXPAND_AND_MEASURE,
  MEASURE_PREVIEW,
  PREVIEW_CODE_SELECTOR,
} from '../../test/parity/code-source'
import { buildParityPage } from './parity-harness'

// Task 532 follow-up — the IR code block's EDITABLE SOURCE panel (the expanded `pre.vditor-ir__marker--pre
// > code`, tagged `.hljs` by code-source.ts) has the Preview code block's background, font family, size
// and padding, for every code theme: both are driven by the active highlight.js style, nothing
// hardcoded. The parity gate parks the caret so it only sees the collapsed render; this net covers the
// expanded source half it cannot. Chromium harness only: it needs the production bundle + a code theme
// per page (one boot each, ~9 s).
const ORIGIN = 'http://localhost:9123'

const BASE = {
  'vmarkd.editor.fullWidth': true,
  'vmarkd.editor.headingMarkers': false,
  'vmarkd.editor.reflowLineBreaks': false,
  'vmarkd.editor.defaultMode': 'ir',
  'vmarkd.editor.fontSize': 'editor',
} as const

// [content theme, workbench theme, code theme]: `auto` pairs the hljs style with the content theme /
// workbench kind (resolveCodeStyle); the explicit rows pin a dark and a light style on both kinds.
const COMBOS: readonly [string, string, string][] = [
  ['auto', 'Default Dark Modern', 'auto'],
  ['github-light', 'Default Dark Modern', 'auto'],
  ['github-dark', 'Default Dark Modern', 'auto'],
  ['material-dark', 'Default Dark Modern', 'auto'],
  ['auto', 'Default Light Modern', 'auto'],
  ['auto', 'Default Dark Modern', 'monokai'],
  ['auto', 'Default Dark Modern', 'github'],
  ['auto', 'Default Light Modern', 'a11y-light'],
  ['auto', 'Default Light Modern', 'obsidian'],
  ['github-light', 'Default Dark Modern', 'nord'],
]

for (const [content, workbench, code] of COMBOS) {
  const id = `${content}/${workbench.replace('Default ', '')}/${code}`
  test(`IR code source panel matches the Preview code block - ${id}`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const config: ParityConfig = {
      id,
      settings: {
        ...BASE,
        'vmarkd.theme.content': content,
        'workbench.colorTheme': workbench,
        'vmarkd.theme.code': code,
      },
    }
    await page.addInitScript(() => {
      ;(window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi =
        () => ({
          postMessage: () => undefined,
          getState: () => undefined,
          setState: () => undefined,
        })
    })
    await page.route('**/parity.html', async (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: await buildParityPage(config, ORIGIN),
      }),
    )
    await page.goto('/parity.html', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () =>
        !!(window as unknown as { vditor?: unknown }).vditor &&
        !!document.querySelector('#app .vditor-ir .hljs span[class*="hljs-"]'),
      undefined,
      { timeout: 90_000 },
    )
    await page.waitForTimeout(1500)
    const source = await page.evaluate<CodeSourceMeasure>(EXPAND_AND_MEASURE)
    await page.waitForFunction(
      (sel) => !!document.querySelector(sel),
      PREVIEW_CODE_SELECTOR,
      { timeout: 30_000 },
    )
    const preview = await page.evaluate<Record<string, string> | null>(
      MEASURE_PREVIEW,
    )
    assertSourceMatchesPreview(source, preview)
  })
}
