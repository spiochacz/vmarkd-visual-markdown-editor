// PROBE (task 516 B3) — reconnaissance for find matches inside special regions: fenced-code
// content (always-visible source, included as a baseline control), a diagram's collapsed IR
// dual-node source (only the rendered `.vditor-ir__preview` SVG paints until the caret enters the
// block), and a collapsed callout body (`display:none` on everything but `.vmarkd-callout__preview`
// until the caret is inside — confirmed by grepping main.css:
// `.vditor-ir__node:not(.vditor-ir__node--expand) > :not(.vmarkd-callout__preview){display:none}`).
//
// Signal used: does ACTIVATING the match (Enter) scroll the pane to reveal the needle's block —
// the same "did find actually land on it" proof find-widget-modes.spec.ts uses (B1/B2's own note:
// the widget exposes no match-count DOM signal, so this is the only reliable observable). Each
// needle's block sits far below the fold at document-top scroll, so "did the pane scroll toward
// it" is a real assertion, not a no-op.
//
// Nothing here is a regression assertion — it logs what's observed so the real pinning spec can
// assert the OBSERVED contract instead of a guess. Per test/backend/probe-tier-convention.test.ts:
// a spec asserting nothing must be `*-probe.spec.ts` and carry `@probe`.
import { settle, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-widget-special-regions-probe.md')
writeFileSync(
  FIXTURE,
  [
    '# Find special regions probe',
    '',
    ...Array(80).fill('alpha filler line before'),
    '',
    '```js',
    'const codeNeedle = "CODENEEDLETARGET"',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A[DIAGRAMNEEDLETARGET] --> B',
    '```',
    '',
    '> [!NOTE]',
    '> CALLOUTNEEDLETARGET is inside a collapsed callout body.',
    '',
    ...Array(30).fill('alpha filler line after'),
    '',
  ].join('\n'),
)

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('@probe find widget: does activating a match in fenced-code / collapsed-diagram-source / collapsed-callout-body scroll the pane to it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

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
  await settle(frame, 4000) // let the mermaid diagram render + settle collapsed

  // Click the very first line so nothing starts caret-expanded (the precondition for "collapsed"
  // to mean anything) and scroll is pinned at the top.
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await settle(frame, 300)

  const boxOf = (needle: string) =>
    frame.locator('body').evaluate((_el, n) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      )
      let node: Text | null
      // biome-ignore lint/suspicious/noAssignInExpressions: TreeWalker's own iteration idiom
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.includes(n)) {
          const el = node.parentElement
          const range = document.createRange()
          range.selectNodeContents(node)
          const rect = range.getBoundingClientRect()
          return {
            found: true,
            y: rect.y,
            display: el ? getComputedStyle(el).display : 'NONE',
          }
        }
      }
      return { found: false, y: 0, display: 'NOT-FOUND' }
    }, needle)

  const scrollTop = () =>
    frame
      .locator('.vditor-ir')
      .first()
      .evaluate((el) => el.scrollTop)

  const findAndActivate = async (needle: string) => {
    const scrollBefore = await scrollTop()
    await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.showFind',
      )
    })
    const findInput = workbox.locator('.simple-find-part input').first()
    await findInput.waitFor({ timeout: 15_000 })
    await findInput.fill('')
    await workbox.keyboard.type(needle)
    await workbox.waitForTimeout(500)
    await workbox.keyboard.press('Enter')
    await workbox.waitForTimeout(700)

    const info = await boxOf(needle)
    const scrollAfter = await scrollTop()
    const viewportHeight = await workbox.evaluate(() => window.innerHeight)
    // The pane actually moved (the direct "find jumped to it" signal) — not just "the rect's y
    // happens to fall in range", which is a false positive for a display:none element (its rect is
    // always the degenerate (0,0,0,0), trivially "in view" regardless of whether anything scrolled).
    const paneScrolled = Math.abs(scrollAfter - scrollBefore) > 5

    await workbox.keyboard.press('Escape')
    // Scroll back to the top for the next needle's baseline.
    await frame
      .locator('.vditor-ir')
      .first()
      .evaluate((el) => {
        el.scrollTop = 0
      })
    await settle(frame, 300)
    return { ...info, scrollBefore, scrollAfter, paneScrolled, viewportHeight }
  }

  const codeResult = await findAndActivate('CODENEEDLETARGET')
  console.log(`[B3-probe] fenced-code content: ${JSON.stringify(codeResult)}`)

  const diagramResult = await findAndActivate('DIAGRAMNEEDLETARGET')
  console.log(
    `[B3-probe] diagram collapsed source: ${JSON.stringify(diagramResult)}`,
  )

  const calloutResult = await findAndActivate('CALLOUTNEEDLETARGET')
  console.log(
    `[B3-probe] collapsed callout body: ${JSON.stringify(calloutResult)}`,
  )
})
