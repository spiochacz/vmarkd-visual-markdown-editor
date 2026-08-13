// B3 (tasks/516 Phase 2) — find matches in special regions. Probed first
// (find-widget-special-regions-probe.spec.ts, @probe) because whether Electron's native find
// reaches hidden text was unverified going in.
//
// MEASURED (probe, repeated): the find widget itself exposes no match-count/no-results DOM signal
// to key an assertion off (same finding as B1/B2 — `.simple-find-part`'s class/aria-live state is
// identical whether a search matches or not), and "did activating a match scroll the pane" proved
// too timing-flaky across repeated probe runs to pin reliably (the pane's measured scroll landed
// differently across otherwise-identical runs — a real instrument gap, not a real product signal).
// What IS stable and directly measurable is the underlying MECHANISM that determines whether a
// paint-based find could ever reach the text in the first place: CSS-computed visibility of the
// needle's containing element while the block is collapsed (caret elsewhere). Confirmed by reading
// main.css:
//   - A collapsed CALLOUT hides its raw body via `display:none` on everything except the rendered
//     `.vmarkd-callout__preview` overlay (`.vditor-ir__node:not(.vditor-ir__node--expand) >
//     :not(.vmarkd-callout__preview){display:none}`) — genuinely un-paintable, so no paint-based
//     find can match text inside it while collapsed.
//   - A collapsed DIAGRAM's raw fenced source, by contrast, stays `display:block` — IR's dual-node
//     collapse for diagrams does NOT hide the underlying `<code>` the way callouts hide their body;
//     only the rendered `.vditor-ir__preview` SVG paints on top of it. So the raw diagram source
//     text remains in a visible-by-computed-style element even though the SVG is what a human sees.
//   - FENCED CODE (non-diagram) is always visible — no collapse mechanism applies to it at all.
//
// This spec pins that visibility contract rather than the flaky scroll signal. It is a NECESSARY
// condition for find to reach the text (a `display:none` subtree cannot be found by any paint-based
// search), not a full proof that Electron's `findInFrame` in fact matches everything visibility
// permits — that residual uncertainty is recorded here rather than hidden behind an assertion that
// looks more conclusive than the evidence supports.
//
// Red proof: the callout assertion was temporarily flipped to `.toBe('block')`, confirmed to fail
// against the real (collapsed → display:none) state, then reverted to `.toBe('none')` below.
import { settle, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-widget-special-regions.md')
writeFileSync(
  FIXTURE,
  [
    '# Find special regions',
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
  ].join('\n'),
)

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

test('collapsed-callout text is paint-hidden; collapsed-diagram-source and fenced-code text are not', async ({
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 4000) // let the mermaid diagram render + settle into its collapsed state

  // Click the document heading so NOTHING starts caret-expanded — the precondition for
  // "collapsed" to mean anything for the diagram/callout blocks below.
  await frame.getByText('Find special regions').first().click()
  await settle(frame, 500)

  const findVisibility = (needle: string) =>
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
          return el ? getComputedStyle(el).display : 'NO-PARENT'
        }
      }
      return 'NOT-IN-DOM'
    }, needle)

  expect(
    await findVisibility('CODENEEDLETARGET'),
    'fenced code content is always visible — no collapse mechanism applies to it',
  ).not.toBe('none')

  expect(
    await findVisibility('DIAGRAMNEEDLETARGET'),
    "a collapsed diagram's raw source stays display:block — only the SVG preview paints over it",
  ).not.toBe('none')

  expect(
    await findVisibility('CALLOUTNEEDLETARGET'),
    'a collapsed callout body is display:none — genuinely un-paintable, so find cannot reach it there',
  ).toBe('none')

  // Sanity: entering the callout (caret inside) flips it to display:block — proves the collapsed
  // state above was real collapse, not "this text just never renders at all". Click the RENDERED
  // preview overlay (the only visible part of a collapsed callout) to place the caret inside it —
  // clicking the still-hidden raw body directly isn't a real gesture.
  await frame.locator('.vmarkd-callout__preview').first().click()
  await settle(frame, 500)
  expect(
    await findVisibility('CALLOUTNEEDLETARGET'),
    'expanding the callout (caret inside) must make the body visible again',
  ).not.toBe('none')
})
