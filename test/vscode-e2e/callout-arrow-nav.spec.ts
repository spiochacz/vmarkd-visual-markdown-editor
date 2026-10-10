import { type EvaluateInVSCode, wf } from './webview-helpers'
// Arrow navigation into a COLLAPSED callout in the real VS Code IR webview (task 484 — this
// handler shipped with zero coverage at any layer; callout-nav.test.ts covers the unit-testable
// decision logic, this file is the AGENTS.md-mandated real-webview proof). A collapsed callout's
// editable source is display:none and its preview is contenteditable=false, so the NATIVE caret
// move can never land inside one — callout-nav.ts pre-empts ArrowDown/Up on the block edge next to
// a collapsed callout and ENTERS it directly (expands the dual-node, places the caret at the
// first/last editable position) rather than stepping past it, mirroring hr-edit.spec.ts's sibling
// coverage of hr-nav.ts's step-ACROSS-a-void-<hr> case — a deliberately different shape, not an
// oversight (see callout-nav.ts's header).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'callout-arrow-nav.md')
const PREVIEW = '.vmarkd-callout__preview'

const CALLOUT_STATE = () => {
  const bq = document.querySelector('.vditor-ir blockquote[data-callout]')
  const sel = window.getSelection()
  const anchor = sel?.rangeCount ? sel.anchorNode : null
  const host = anchor
    ? anchor.nodeType === 1
      ? (anchor as Element)
      : anchor.parentElement
    : null
  return {
    expanded: !!bq?.classList.contains('vditor-ir__node--expand'),
    caretInCallout: !!(
      anchor &&
      bq?.contains(anchor) &&
      !host?.closest('.vmarkd-callout__preview')
    ),
    anchorOffset: sel?.anchorOffset ?? -1,
    anchorText: anchor?.nodeType === 3 ? (anchor as Text).data : null,
  }
}

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [uri] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE],
  )
  const frame = wf(workbox)
  await frame
    .locator(`.vditor-ir blockquote[data-callout] > ${PREVIEW}`)
    .first()
    .waitFor({ timeout: 60_000 }) // dual-node injected
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  // Precondition: the callout must actually be COLLAPSED at open, or the pre-empt path this spec
  // exists to cover never fires and the assertions below would pass/fail for the wrong reason.
  const initial = await frame.locator('body').evaluate(CALLOUT_STATE)
  expect(initial.expanded, 'callout must start collapsed').toBe(false)

  return frame
}

test('ArrowDown from the paragraph above enters the collapsed callout', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  await frame.locator('.vditor-ir').getByText('above the callout').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('ArrowDown')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))

  const s = await frame.locator('body').evaluate(CALLOUT_STATE)
  // eslint-disable-next-line no-console
  console.log(`[callout-arrow-nav] ArrowDown landed: ${JSON.stringify(s)}`)
  expect(s.expanded).toBe(true) // dual-node expanded so the caret can land in the source
  expect(s.caretInCallout).toBe(true) // NOT stuck outside / dropped into the preview
  expect(s.anchorText).toContain('callout body text') // entered the callout's own source text
  expect(s.anchorOffset).toBe(0) // entered at the FIRST editable position (top → down)
})

test('ArrowUp from the paragraph below enters the collapsed callout', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  await frame.locator('.vditor-ir').getByText('below the callout').click()
  await workbox.keyboard.press('Home')
  await workbox.keyboard.press('ArrowUp')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))

  const s = await frame.locator('body').evaluate(CALLOUT_STATE)
  // eslint-disable-next-line no-console
  console.log(`[callout-arrow-nav] ArrowUp landed: ${JSON.stringify(s)}`)
  expect(s.expanded).toBe(true)
  expect(s.caretInCallout).toBe(true)
  expect(s.anchorText).toContain('callout body text')
  // entered at the LAST editable position (bottom → up) — offset lands at the end of the source
  // text node, not at 0 (the ArrowDown case above).
  expect(s.anchorOffset).toBe(s.anchorText?.length ?? -1)
  expect(s.anchorOffset).toBeGreaterThan(0)
})

// Load flake root cause (release 1.3 full-suite failure, reproduced solo under CPU stress): the
// editor's caret code can leave an EMPTY text node in front of the callout text; the soft-break
// decorator then failed to recognise the callout head, wrapped the title-line newline in a span,
// and ArrowDown landed on "[!NOTE]" instead of the body. Force that DOM deterministically.
test('ArrowDown still enters the callout body when an empty text node precedes the callout text', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  await frame.locator('body').evaluate(() => {
    const p = document.querySelector('.vditor-ir blockquote[data-callout] > p')
    p?.insertBefore(document.createTextNode(''), p.firstChild)
  })
  // let the soft-break observer re-decorate the touched block
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))

  await frame.locator('.vditor-ir').getByText('above the callout').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('ArrowDown')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))

  const s = await frame.locator('body').evaluate(CALLOUT_STATE)
  expect(s.caretInCallout).toBe(true)
  expect(s.anchorText).toContain('callout body text')
  expect(s.anchorOffset).toBe(0)
})
