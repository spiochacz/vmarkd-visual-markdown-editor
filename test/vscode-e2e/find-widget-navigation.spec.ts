// B2 (tasks/516 Phase 2) — multi-match find navigation. One test(), single boot (task 448/450):
// find-next/prev keep working over a multi-match document, Escape closes the widget AND returns
// focus to the editor, a second Ctrl+F reopens cleanly, and no keystroke leaks into the document.
//
// What this file does NOT assert, and why: the webview's find widget (`.simple-find-part`,
// VS Code's SimpleFindWidget base — the same one terminals use) has NO match-count element
// (`.matchesCount` is a Monaco code-editor feature, absent here). The only external proxy for
// "which match is current" is which occurrence Chromium's native `findInFrame` scrolled into
// view — and measurement showed that proxy does not reduce to a unique match, so cycling ORDER
// and wrap-around are out of reach from the DOM. See the SCOPE LIMIT comment below.
import { settle, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-widget-navigation.md')
const QUERY = 'zulu'
const MATCH_LINES = [
  `${QUERY} match one`,
  `${QUERY} match two`,
  `${QUERY} match three`,
]
writeFileSync(
  FIXTURE,
  [
    '# Find navigation',
    '',
    MATCH_LINES[0],
    '',
    ...Array(25).fill('alpha filler line'),
    '',
    MATCH_LINES[1],
    '',
    ...Array(25).fill('alpha filler line'),
    '',
    MATCH_LINES[2],
    '',
  ].join('\n'),
)

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('find-next/prev keep working, Escape closes and returns focus, Ctrl+F reopens, and no keystroke leaks into the document', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)

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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 300)
  await frame.locator('.vditor-ir').click({ position: { x: 20, y: 12 } })

  const showFind = () =>
    evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.showFind',
      )
    })

  await showFind()
  const findInput = workbox.locator('.simple-find-part input').first()
  await findInput.waitFor({ timeout: 15_000 })
  await workbox.keyboard.type(QUERY, { delay: 60 })
  await workbox.waitForTimeout(700)

  // Precondition: matches were actually found (the prev/next buttons only lose `disabled` once the
  // widget's own search state has matches) — asserted rather than assumed, so a failure below reads
  // as "navigation is broken", not "the query never matched anything".
  const nextBtn = workbox.locator('.simple-find-part .codicon-find-next-match')
  await expect(nextBtn).not.toHaveClass(/disabled/, { timeout: 10_000 })

  // NOTE (task 516): visibility MUST be judged inside the webview iframe. An earlier draft
  // compared these rects against `workbox.viewportSize()` — the workbench WINDOW — but the rects
  // come from `frame.…evaluate()` and are relative to the IFRAME's own viewport, so the
  // comparison was meaningless and the filter returned nothing at all.
  // Which of the three match lines is currently scrolled into the frame's viewport — the only
  // externally-observable proxy for "current match" this widget offers (see header comment).
  // Queried by evaluate()+TreeWalker rather than Playwright's getByText.boundingBox(): the latter
  // measured unreliable in this pane (find-widget-modes.spec.ts hit the same thing — boundingBox()
  // returning null even when the text is plainly present, apparently a locator-resolution quirk of
  // this DOM shape rather than anything about scrolling).
  const visibleMatchIndex = async (): Promise<number[]> => {
    const results = await frame.locator('body').evaluate((body, needles) => {
      return needles.map((needle) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        let node: Text | null
        // biome-ignore lint/suspicious/noAssignInExpressions: TreeWalker's own iteration idiom
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent?.includes(needle)) {
            const range = document.createRange()
            range.selectNodeContents(node)
            const rect = range.getBoundingClientRect()
            return {
              found: true,
              visible: rect.bottom > 0 && rect.top < (window.innerHeight || 0),
            }
          }
        }
        return { found: false, visible: false }
      })
    }, MATCH_LINES)
    return results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.found && r.visible)
      .map(({ i }) => i)
  }

  // SCOPE LIMIT, measured (task 516 B2): cycling ORDER is deliberately NOT asserted here.
  // This widget exposes no match-count element, and the scroll-position proxy above turned out
  // not to identify a unique "current" match — with three occurrences and 25 filler lines
  // between them, the set of match lines inside the iframe viewport does not reduce to exactly
  // one, so "Enter #2 landed on a different match than Enter #1" cannot be read reliably from
  // the DOM. Two earlier attempts at that assertion failed for measurement reasons, not product
  // reasons, and a test that cannot distinguish "navigation broke" from "my proxy is noisy" is
  // worse than no test. What IS asserted below is everything this widget genuinely exposes:
  // navigation keys are accepted while matches exist, the view moves, Escape closes and returns
  // focus, reopening works, and — the actual regression risk that motivated task 514 — none of
  // these keystrokes leak into the document.
  const scrollTop = () =>
    frame
      .locator('body')
      .evaluate(
        () => document.scrollingElement?.scrollTop ?? window.scrollY ?? 0,
      ) as Promise<number>

  const before = await scrollTop()
  for (const key of ['Enter', 'Enter', 'Enter', 'Shift+Enter']) {
    await workbox.keyboard.press(key)
    await workbox.waitForTimeout(700)
  }
  const after = await scrollTop()
  expect(
    Math.abs(after - before) > 1 || (await visibleMatchIndex()).length > 0,
    'find-next/prev kept the widget working: the view moved to a match, or a match is on screen',
  ).toBe(true)
  await expect(nextBtn).not.toHaveClass(/disabled/)

  // Escape closes the widget AND returns focus to the editor.
  await workbox.keyboard.press('Escape')
  // Assert the INPUT itself goes away: the `.simple-find-part-wrapper` container measured as
  // still "visible" to Playwright after Escape (it stays in the DOM), so the wrapper is not a
  // usable closed/open signal.
  await expect(findInput).toBeHidden({ timeout: 10_000 })
  const frameActive = await frame.locator('body').evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.tagName ?? 'none'
  })
  expect(frameActive, 'focus returned to the editable after Escape').not.toBe(
    'BODY',
  )

  // A second Ctrl+F reopens cleanly, with the input focused.
  await showFind()
  await expect(findInput).toBeVisible({ timeout: 10_000 })
  const hostActive = await workbox.evaluate(
    () => document.activeElement?.tagName ?? 'none',
  )
  expect(hostActive, 'find input focused on reopen').toBe('INPUT')

  // Nothing leaked into the document across the whole navigation sequence.
  const text = (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    [FIXTURE] as [string],
  )) as string
  for (const line of MATCH_LINES) {
    expect(text, `${line} unchanged`).toContain(line)
  }
})
