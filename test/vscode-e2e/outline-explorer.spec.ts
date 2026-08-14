import { wf } from './webview-helpers'
// NET (task 516 D2) — the Explorer's "Markdown Outline" TreeView (outline-tree.ts,
// `vmarkd.outlineReveal`) is unit-only today: a mock HeadingItem is passed straight to the
// command handler. This spec drives the REAL Explorer sidebar tree (a `.monaco-list` row,
// gated behind `vmarkd.hasOutline` — package.json's `views.explorer` contribution) and proves
// both branches of `vmarkd.outlineReveal`:
//   1. A vMarkd webview panel is open for the doc → `deps.findPanelForUri` finds it → the
//      webview receives `scroll-to-heading` and scrolls+flashes the target (the same
//      `scrollToHeadingIndex` mechanism outline-keyboard.spec.ts already pins for the in-editor
//      outline panel — this proves the OTHER caller, the Explorer tree, reaches it too).
//   2. NO vMarkd webview is open for the doc, but the file IS the active tab as a PLAIN text
//      editor — `vmarkd.hasOutline` is driven by `getCommandTarget()` (tab-targeting.ts), which
//      resolves off the active tab regardless of editor kind, so the tree section stays visible
//      even without our custom editor. `findPanelForUri` finds nothing → falls back to
//      `showTextDocument` + reveals the heading's line in the plain editor.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'outline-explorer.md')

// Only the first test below sets `editor.defaultMode` (to 'ir'); the second relies on it being
// unset, so the two tests can't share a single pinned value — restore-only instead.
useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

// Reveal the "Markdown Outline" pane in the Explorer sidebar (collapsed by default alongside
// VS Code's built-in Outline/Timeline) and return the row locator for a given heading's
// VISIBLE text (the row's aria-label is "H1: Top Heading" per HeadingItem's tooltip, but the
// rendered row text is just "Top Heading" — match on that, not the aria-label).
async function outlineRow(
  workbox: import('@playwright/test').Page,
  headingText: string,
) {
  const header = workbox
    .locator('.pane-header')
    .filter({ hasText: 'Markdown Outline' })
  await header.waitFor({ timeout: 30_000 })
  // The section's collapsed/expanded state can carry over from an earlier run in the SHARED
  // user-data dir — read `aria-expanded` rather than guessing from row visibility (a blind
  // "click if no rows yet" toggled an ALREADY-expanded section CLOSED instead).
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click()
  }
  const row = workbox.locator('.monaco-list-row', { hasText: headingText })
  await row.first().waitFor({ timeout: 15_000 })
  return row.first()
}

test('clicking an outline item scrolls and flashes the heading in the open vMarkd webview', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      // `vmarkd.editor.defaultMode` defaults to 'remember' (task 282 session stickiness), which
      // can restore whatever mode an EARLIER spec in the shared user-data dir left behind (host-
      // side 'vmarkd.options' globalState — src/platform/state-keys.ts / default-mode.ts). Force
      // a specific mode so this test's own outcome never depends on what ran before it — the same
      // defensive pattern default-open-mode.spec.ts uses. This alone does NOT fix the hang below
      // (proven by direct reproduction — see the `surface` comment): even with mode correctly
      // resolving to 'ir', the wait still locked onto a hidden `.vditor-wysiwyg`, because Vditor
      // keeps EVERY mode's element in the DOM once built. The real fix is the `:visible` selector.
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('editor.defaultMode', 'ir', vscode.ConfigurationTarget.Global)
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  // Vditor keeps EVERY mode's element in the DOM (only the active one is shown/hidden via CSS),
  // and `.first()` on a plain `.vditor-ir, .vditor-wysiwyg` locator returns whichever matches
  // FIRST IN DOM ORDER — not whichever is actually visible. Confirmed by direct reproduction: a
  // session that had wysiwyg's element built earlier (e.g. from ANY prior mode switch/leftover
  // session state) puts `.vditor-wysiwyg` before `.vditor-ir` in the DOM, so `.first()` locks onto
  // the (correctly, permanently) hidden wysiwyg element even while `.vditor-ir` is already visible
  // right next to it — a 60s hang, not a race. `:visible` (the pattern anchor-links.spec.ts's `wf`
  // variant already uses for this exact class of problem) selects the one that's actually shown.
  const surface = frame
    .locator('.vditor-ir:visible, .vditor-wysiwyg:visible')
    .first()
  await surface.waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.view.explorer')
  })
  const row = await outlineRow(workbox, 'Sub Heading')
  await row.click()

  // scrollToHeadingIndex (media-src/src/nav/outline.ts) scrollIntoView()s the target then adds
  // `heading-flash` for FLASH_DURATION_MS (1400ms) — poll for it rather than a fixed sleep.
  await expect
    .poll(
      () =>
        frame.locator('body').evaluate(() => {
          const h = Array.from(document.querySelectorAll('h1, h2')).find((el) =>
            el.textContent?.includes('Sub Heading'),
          )
          return h?.classList.contains('heading-flash') ?? false
        }),
      { timeout: 5_000, intervals: [50, 100, 200] },
    )
    .toBe(true)
})

test('with no vMarkd webview open, clicking an outline item reveals the heading in the plain text editor', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      // Activation is gated on `onCommand:vmarkd.openEditor/openTextEditor` or
      // `onCustomEditor:vmarkd.editor` (package.json) — none of which a plain
      // `showTextDocument` triggers. Without an explicit activate() here the extension never
      // registers `vmarkd.outline`/`vmarkd.hasOutline` at all, and the Explorer section this
      // test needs never appears — this mirrors a realistic session where the user already
      // opened SOME markdown file in vMarkd earlier, then views THIS one as plain text.
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      // Open as a PLAIN text editor — never our custom `vmarkd.editor` viewType — so
      // `findPanelForUri` in the command handler finds no webview panel for this doc.
      await vscode.window.showTextDocument(vscode.Uri.file(args[0]))
    },
    [FIXTURE] as [string],
  )
  await workbox.waitForTimeout(500)

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.view.explorer')
  })
  const row = await outlineRow(workbox, 'Sub Heading')
  await row.click()

  // The command falls back to vscode.window.showTextDocument + sets the selection at the
  // heading's line (0-based) — poll the active text editor's cursor position.
  await expect
    .poll(async () =>
      evaluateInVSCode(
        async (vscode: typeof import('vscode'), args: string[]) => {
          const ed = vscode.window.activeTextEditor
          if (!ed || ed.document.uri.fsPath !== args[0]) return -1
          return ed.selection.active.line
        },
        [FIXTURE] as [string],
      ),
    )
    .toBe(4) // "## Sub Heading" is line index 4 in the fixture (0-based)

  // No vMarkd webview must have been created by this journey.
  const webviewCount = await workbox.locator('iframe.webview').count()
  expect(webviewCount).toBe(0)
})
