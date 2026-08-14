import { wf } from './webview-helpers'
// Task 459 — Ctrl/Cmd+Enter focuses the callout popover's controls, in the REAL VS Code WYSIWYG
// webview. This chord used to be Ctrl/Cmd+Alt+Enter, a SEPARATE chord from
// links/link-click-fix.ts's link-activation Ctrl/Cmd+Enter — the user rejected that (task 459's
// blocker note: a third modifier, and Ctrl+Alt collides with AltGr on a Polish keyboard layout)
// in favour of ONE chord shared through util/caret-gesture.ts, dispatched by whatever is under
// the caret. This spec proves the callout side of that unification in the real webview: WYSIWYG
// only (callout-popover-keys.ts's `calloutBlockquoteAt` gates on `.vditor-wysiwyg`; the popover
// this module targets doesn't exist in IR/Preview, see callouts.ts), because
// `calloutWysiwygToolbar` only appends the `.vmarkd-callout__type` select to Vditor's own
// block-popover once the caret is INSIDE the blockquote — it is not present at open, so the test
// must poll for it, not assume it.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'callout-popover-keys.md')

// Set once, up front, before opening the document, and never changed again mid-test.
usePinnedSettings(test, { 'vmarkd.editor.defaultMode': 'wysiwyg' })

// See wiki-chip-focus.spec.ts's identical helper: getValue() goes through the double-`.vditor`
// inner instance's `lute`, assigned asynchronously well after the DOM is rendered.
async function waitForLuteReady(frame: ReturnType<typeof wf>): Promise<void> {
  await frame.locator('body').evaluate(async () => {
    const ready = () => !!(window as any).vditor?.vditor?.lute
    for (let i = 0; i < 300 && !ready(); i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!ready())
      throw new Error('Lute never became available on window.vditor.vditor')
  })
}

function getValue(frame: ReturnType<typeof wf>): Promise<string> {
  return frame.locator('body').evaluate(() => (window as any).vditor.getValue())
}

test('Ctrl+Enter focuses the callout popover controls, and getValue() is unchanged throughout', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
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
    .locator('.vditor-wysiwyg blockquote[data-callout]')
    .first()
    .waitFor({ timeout: 60_000 })
  await waitForLuteReady(frame)
  const baselineValue = await getValue(frame)

  // Click into the callout body — real Vditor focus/selection, which is what makes Vditor build
  // its block popover (customWysiwygToolbar -> calloutWysiwygToolbar) in the first place.
  await frame
    .locator('.vditor-wysiwyg blockquote[data-callout]')
    .getByText('Tip body text.')
    .click()

  // The select is appended asynchronously once Vditor's own popover machinery reacts to the
  // selection change — not present at open, so poll rather than assume.
  const select = frame.locator('.vditor-panel .vmarkd-callout__type')
  await expect(select).toHaveCount(1, { timeout: 15_000 })

  expect(
    await getValue(frame),
    'clicking into the callout body must not change the document',
  ).toBe(baselineValue)

  // The chord as a real user types it — top-level keyboard so it crosses the iframe boundary
  // correctly (see wiki-chip-focus.spec.ts's identical note on synthetic dispatchEvent vs this).
  await workbox.keyboard.press('Control+Enter')

  await expect
    .poll(
      () =>
        frame
          .locator('.vditor-panel .vmarkd-callout__type')
          .evaluate((el) => document.activeElement === el),
      { timeout: 15_000 },
    )
    .toBe(true)

  // Ctrl+Enter is one keystroke away from inserting a newline (bare Enter) — this is the
  // load-bearing assertion, both in the webview's own getValue() and the underlying document.
  expect(
    await getValue(frame),
    'focusing the popover via Ctrl+Enter must not change the document',
  ).toBe(baselineValue)
  const docText = await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [FIXTURE] as [string],
  )
  expect(docText, 'the underlying source document must be untouched').toBe(
    baselineValue,
  )
})
