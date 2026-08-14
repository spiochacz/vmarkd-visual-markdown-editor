// B1 (tasks/516 Phase 2) — the Ctrl+F find widget beyond IR. Task 514 fixed a focus-theft bug
// (activating a match handed focus back to the document instead of the find box) and
// find-widget-focus.spec.ts pins it for IR only. This spec proves the same three things — the
// widget opens, focus stays in the find box while typing, and activating a match scrolls it into
// view — hold in the other three modes: WYSIWYG, split (sv), and preview.
//
// Deliberately NOT asserting match COUNTS: the native find widget searches the rendered DOM
// including IR's own markup, so counts legitimately differ per mode (task 196). What's asserted
// instead: focus retention (per-keystroke, mirroring find-widget-focus.spec.ts — the loss is
// transient, so a check after typing the whole query would pass against the bug), scroll-into-view
// of the match, and that no keystroke leaks into the document.
//
// One test(), three legs sharing a boot (task 448/450 — boot cost is per test(), not per spec
// file), reopening the same fixture under a different `vmarkd.editor.defaultMode` each leg (the
// `default-open-mode.spec.ts` pattern).
import { settle, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-widget-modes.md')
// Same shape as find-widget-focus.spec.ts's fixture and for the same reasons: `bravo` appears once,
// far enough down that activating the match must scroll the pane, and the filler lines don't
// contain the query's prefix so find-as-you-type has nothing to match until the whole word lands.
const QUERY = 'bravo'
writeFileSync(
  FIXTURE,
  [
    '# Find modes',
    '',
    ...Array(40).fill('alpha filler line'),
    '',
    `${QUERY} target line`,
    '',
  ].join('\n'),
)

// `editor.defaultMode` is reopened with a different value each leg (wysiwyg/sv/preview) — mid-test,
// so it can't be pinned; restored via the helper below.
useSettingsRestore(test, ['vmarkd.editor.defaultMode'])

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

interface Leg {
  name: string
  mode: string
  // Locator for the pane to click into before Ctrl+F — establishes "the user was in this
  // document" the way find-widget-focus.spec.ts's IR leg does, and is also what focus-restore.ts's
  // guards key off (the click gives the pane a live selection to defend).
  paneSelector: string
}

const LEGS: Leg[] = [
  { name: 'wysiwyg', mode: 'wysiwyg', paneSelector: '.vditor-wysiwyg' },
  { name: 'sv', mode: 'sv', paneSelector: '.vditor-sv' },
  // "preview" boots ir underneath with the Preview overlay toggled on (see
  // default-open-mode.spec.ts) — the ir pane itself is hidden, but `.vditor-preview` becomes
  // visible and is what's clickable.
  { name: 'preview', mode: 'preview', paneSelector: '.vditor-preview' },
]

test('find widget opens, keeps focus, and scrolls to a match in wysiwyg/sv/preview', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(200_000)

  const openWithMode = async (mode: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        const [m, f] = args
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('editor.defaultMode', m, vscode.ConfigurationTarget.Global)
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(f),
          'vmarkd.editor',
        )
      },
      [mode, FIXTURE] as [string, string],
    )
  }

  const close = async () => {
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    })
    await expect
      .poll(() => workbox.locator('iframe.webview').count(), {
        timeout: 30_000,
      })
      .toBe(0)
  }

  const hostActive = () =>
    workbox.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el
        ? `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`
        : 'none'
    })

  for (const leg of LEGS) {
    await openWithMode(leg.mode)
    const frame = wf(workbox)
    const pane = frame.locator(leg.paneSelector).first()
    await pane.waitFor({ timeout: 60_000 })
    await settle(frame, 300)
    await pane.click({ position: { x: 20, y: 12 } })

    // The target line is far below the fold at document-top scroll — the precondition that makes
    // "activating a match scrolls it into view" a real assertion rather than a no-op (it's already
    // visible). Queried by evaluate()+TreeWalker rather than Playwright's getByText: more robust
    // to whatever wrapping a given mode's renderer puts around the text, and it can tell "not
    // found at all" apart from "found but off-screen" — `boundingBox()` returns null for both,
    // which hid a real failure the first time this spec ran (see the leg.name==='preview' note
    // below).
    const findTargetBox = () =>
      frame.locator('body').evaluate((body, needle) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        let node: Text | null
        // biome-ignore lint/suspicious/noAssignInExpressions: TreeWalker's own iteration idiom
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent?.includes(needle)) {
            const range = document.createRange()
            range.selectNodeContents(node)
            const rect = range.getBoundingClientRect()
            return { found: true, y: rect.y, height: rect.height }
          }
        }
        return { found: false, y: 0, height: 0 }
      }, `${QUERY} target line`)

    const beforeInfo = await findTargetBox()
    const viewport = workbox.viewportSize()
    expect(
      beforeInfo.found,
      `[${leg.name}] target line text is present before search`,
    ).toBe(true)
    expect(
      !viewport || beforeInfo.y < 0 || beforeInfo.y > viewport.height,
      `[${leg.name}] target line starts off-screen before search (y=${beforeInfo.y})`,
    ).toBe(true)

    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.showFind',
      )
    })
    const findInput = workbox.locator('.simple-find-part input').first()
    await findInput.waitFor({ timeout: 15_000 })
    expect(
      await hostActive(),
      `[${leg.name}] find box takes focus on open`,
    ).toContain('INPUT')

    // Per-keystroke, not a single check after — the loss find-widget-focus.spec.ts guards against
    // is transient (VS Code puts focus back on the input at the next keystroke), so a check after
    // typing the whole query would pass against the bug.
    const perChar: { char: string; host: string }[] = []
    for (const char of QUERY) {
      await workbox.keyboard.type(char)
      await workbox.waitForTimeout(500)
      perChar.push({ char, host: await hostActive() })
    }
    await workbox.keyboard.press('Enter')
    await workbox.waitForTimeout(700)
    perChar.push({ char: 'Enter', host: await hostActive() })

    const strayFocus = perChar.filter((p) => !p.host.includes('INPUT'))
    expect(
      strayFocus,
      `[${leg.name}] focus left the find box: ${JSON.stringify(strayFocus)}`,
    ).toEqual([])

    // Activating the match scrolled it into view.
    const afterInfo = await findTargetBox()
    expect(
      afterInfo.found,
      `[${leg.name}] target line text is still present after the match is activated`,
    ).toBe(true)
    if (viewport) {
      expect(
        afterInfo.y >= -afterInfo.height && afterInfo.y < viewport.height,
        `[${leg.name}] target line scrolled into view (y=${afterInfo.y}, viewport=${viewport.height})`,
      ).toBe(true)
    }

    // Nothing leaked into the document: every filler line survives and the target line is intact.
    const text = (await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) =>
        vscode.workspace.textDocuments
          .find((d) => d.uri.fsPath === args[0])
          ?.getText() ?? '',
      [FIXTURE] as [string],
    )) as string
    expect(text, `[${leg.name}] target line unchanged`).toContain(
      `${QUERY} target line`,
    )
    expect(
      text.match(/alpha filler line/g)?.length,
      `[${leg.name}] filler lines unchanged`,
    ).toBe(40)

    await workbox.keyboard.press('Escape')
    await close()
  }
})
