import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// Task 110 — pins the preview-vs-VS Code block-rhythm parity CSS in main.css (search "Task 110"),
// and the half of ADR-0003 it must NOT touch: the edit surfaces (.vditor-ir) keep Vditor's own
// roomier spacing on purpose. Real VS Code only, not the harness: getComputedStyle needs the
// genuine cascade (main.css link order, VS Code's injected defaults) that the chromium harness
// does not reproduce exactly, and the numbers below are the ones actually measured in it.
//
// Opens straight into the Preview overlay via `vmarkd.editor.defaultMode` (task 282's own
// mechanism — see open-preview.ts) rather than dispatching a click after open: a manual click +
// fixed sleep raced Vditor's preview render (1000ms debounce, see vditor's preview/index.ts) and
// measured `.vditor-preview .vditor-reset p` as absent even 2.5s later. `expect.poll` below still
// waits out that debounce rather than trusting a fixed delay.
//
// One test() — each test() pays a full VS Code boot (see the cost comment atop playwright.config.ts).

const FIXTURE = path.join(__dirname, 'fixtures', 'preview-spacing.md')

// Always returns numbers (NaN, not undefined/null, when an element is missing) so the assertions
// below never need a non-null assertion to read them.
type Metrics = {
  found: boolean
  pFontSize: number
  pLineHeight: number
  pMarginBottom: number
  ulMarginBottom: number
  ulPaddingLeft: number
  preCodeFound: boolean
  codeLineHeight: string
  h2FontSize: number
  h2LineHeight: number
}

// Runs in the webview frame's page context — no closures over node-side values.
const READ_METRICS = `(root) => {
  const empty = { found: false, pFontSize: NaN, pLineHeight: NaN, pMarginBottom: NaN,
    ulMarginBottom: NaN, ulPaddingLeft: NaN, preCodeFound: false, codeLineHeight: '',
    h2FontSize: NaN, h2LineHeight: NaN }
  const scope = document.querySelector(root)
  if (!scope) return empty
  const p = scope.querySelector('p')
  const ul = scope.querySelector('ul')
  const h2 = scope.querySelector('h2')
  const preCode = scope.querySelector('pre code')
  const num = (v) => (v ? Number.parseFloat(v) : NaN)
  const cp = p ? getComputedStyle(p) : null
  const cu = ul ? getComputedStyle(ul) : null
  const ch = h2 ? getComputedStyle(h2) : null
  const cc = preCode ? getComputedStyle(preCode) : null
  return {
    found: !!p && !!ul,
    pFontSize: num(cp && cp.fontSize),
    pLineHeight: num(cp && cp.lineHeight),
    pMarginBottom: num(cp && cp.marginBottom),
    ulMarginBottom: num(cu && cu.marginBottom),
    ulPaddingLeft: num(cu && cu.paddingLeft),
    preCodeFound: !!preCode,
    codeLineHeight: (cc && cc.lineHeight) || '',
    h2FontSize: num(ch && ch.fontSize),
    h2LineHeight: num(ch && ch.lineHeight),
  }
}`

// `ConfigurationTarget.Global` writes to settings.json in the harness's user-data dir, which is
// SHARED and PERSISTENT across boots (`userDataDir ?? path.join(cachePath, 'user-data')` in
// vscode-test-playwright, and playwright.config.ts does not override it). Leaving `preview` set
// would make every LATER spec in the run open into the Preview overlay, where `.vditor-ir` is
// hidden — a suite-wide poison that only shows up when the specs run together.
//
// Pin the WORKBENCH theme too, not just our own settings. The edit-surface assertion below
// describes Vditor's own rhythm with NO content theme active — but `theme.content: 'auto'`
// RESOLVES to vscode-{dark,light}-2026 whenever `workbench.colorTheme` is one of VS Code's
// default themes (resolveAutoContentTheme, src/shared/theme-registry.ts), and a resolved theme
// puts `markdown-body` on the body, whose `line-height: 1.6` the edit surface then inherits —
// legitimately, so the 1.5 assertion is simply measuring a different configuration.
// Reproduced deterministically: `plantuml-theme-flip.spec.ts` leaves `colorTheme` at 'Default
// Dark Modern' and never resets it, and running it immediately before this spec fails the ratio
// at 1.6 on the first attempt (task 516 triage; the general hygiene problem is task 524).
// 'Monokai' is a built-in theme that appears in NEITHER pairing list, so 'auto' stays unpaired.
usePinnedSettings(test, {
  'workbench.colorTheme': 'Monokai',
  'vmarkd.theme.content': 'auto',
  'vmarkd.editor.defaultMode': 'preview',
})

test('preview block rhythm matches VS Code, edit surface and code stay untouched', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(async (vscode, uri) => {
    await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(uri),
      'vmarkd.editor',
    )
  }, FIXTURE)

  const frame = wf(workbox)
  // `attached`, not the default `visible`: opening straight into Preview hides the ir pane's
  // wrapper (`vditor[currentMode].element.parentElement.style.display = "none"`, see Preview.ts),
  // and that hide can land before this check runs — a `visible` wait then hangs the full 60s.
  // getComputedStyle still resolves real values on a display:none ancestor, so `attached` is enough.
  await frame
    .locator('.vditor-ir')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })

  const readPreview = () =>
    frame
      .locator('body')
      .evaluate(
        `(${READ_METRICS})('.vditor-preview .vditor-reset')`,
      ) as Promise<Metrics>
  const readEdit = () =>
    frame
      .locator('body')
      .evaluate(`(${READ_METRICS})('.vditor-ir')`) as Promise<Metrics>

  // Preview render is debounced (1000ms) — poll rather than trust a fixed sleep.
  await expect
    .poll(async () => (await readPreview()).found, { timeout: 30_000 })
    .toBe(true)
  const preview = await readPreview()
  const edit = await readEdit()

  console.log('[110-spacing]', JSON.stringify({ preview, edit }, null, 2))

  // ── Preview surface: matches VS Code's own markdown preview rhythm ──────────────────────────
  expect(preview.found).toBe(true)
  const previewRatio = preview.pLineHeight / preview.pFontSize
  expect(previewRatio).toBeCloseTo(1.571, 1)
  // 0.7em at the fixture's font size — approximate, not an exact px string, since a font swap
  // could shift the base size slightly. 0.5px tolerance covers sub-pixel rounding.
  const expectedPreviewMargin = preview.pFontSize * 0.7
  expect(Math.abs(preview.pMarginBottom - expectedPreviewMargin)).toBeLessThan(
    0.6,
  )
  expect(Math.abs(preview.ulMarginBottom - expectedPreviewMargin)).toBeLessThan(
    0.6,
  )
  expect(Math.abs(preview.ulPaddingLeft - 40)).toBeLessThan(0.6)
  // Heading rhythm (1.25 in preview vs Vditor's own ~1.29) is a second, independent leak detector.
  const previewH2Ratio = preview.h2LineHeight / preview.h2FontSize
  expect(previewH2Ratio).toBeCloseTo(1.25, 1)

  // Code inside the preview must NOT have picked up the 1.571 rhythm — re-asserted `line-height:
  // normal` in main.css guards the collapsed-code-block-height and dark-bottom-trim regressions.
  // Positive assertions: a missing `pre code` or a silently-skipped ratio must fail, not pass by
  // omission.
  expect(
    preview.preCodeFound,
    'no `pre code` found in the preview — fixture or Vditor DOM shape changed',
  ).toBe(true)
  const codeRatio =
    preview.codeLineHeight === 'normal'
      ? Number.NaN
      : Number.parseFloat(preview.codeLineHeight) / preview.pFontSize
  const codeUntouched =
    preview.codeLineHeight === 'normal' || Math.abs(codeRatio - 1.571) > 0.01
  expect(
    codeUntouched,
    `code line-height leaked the 1.571 text rhythm: ${preview.codeLineHeight}`,
  ).toBe(true)

  // ── Edit surface: ADR-0003 keeps it on Vditor's own, roomier spacing — the rules above must
  // not leak here. Positive numbers (not just "not the preview value"), so an actual leak to a
  // DIFFERENT wrong number still fails.
  expect(edit.found).toBe(true)
  const editRatio = edit.pLineHeight / edit.pFontSize
  expect(editRatio).toBeCloseTo(1.5, 1)
  expect(editRatio).not.toBeCloseTo(1.571, 2)
  expect(Math.abs(edit.pMarginBottom - 16)).toBeLessThan(1)
  expect(Math.abs(edit.ulMarginBottom - 16)).toBeLessThan(1)
  expect(Math.abs(edit.ulPaddingLeft - 28)).toBeLessThan(0.6)
  expect(Math.abs(edit.ulPaddingLeft - 40)).toBeGreaterThan(1)
})
