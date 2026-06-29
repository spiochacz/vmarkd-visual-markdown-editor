// Editing around `<hr>` thematic breaks in the real VS Code IR webview (task 100). Two bugs:
//   1. a `---` typed under another `---` (or at EOF) stayed as literal `--- ` text — the block-scoped
//      SpinVditorIRDOM never promotes the LAST one. Fix: promoteThematicBreaks renders a left-behind
//      `---` as a real <hr> on caret-leave (gap-paragraph.ts).
//   2. ArrowDown/Up across a void <hr> dropped the caret on the rule (no text node → "OUTSIDE") and
//      snapped back — stuck. Fix: setupHrArrowNav steps the caret past the run of rules (hr-nav.ts).
// Only reproduces in the real custom-editor pipeline (the live IR re-spin), so it lives here.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'hr-edit.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// caret's top-level block in the IR editor: "TAG" (+ "(trailing)") or OUTSIDE / NO-SELECTION + text.
const CARET = () => {
  const ir = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  const sel = window.getSelection()
  const a = sel?.rangeCount ? sel.anchorNode : null
  if (!a || !ir) return { block: a ? 'OUTSIDE' : 'NO-SELECTION', text: '' }
  let n: Node | null = a
  while (n?.parentElement && n.parentElement !== ir) n = n.parentElement
  const b = (n as HTMLElement)?.parentElement === ir ? (n as HTMLElement) : null
  return {
    block: b
      ? `${b.tagName}${b.hasAttribute('data-vmarkd-trailing') ? '(trailing)' : ''}`
      : 'OUTSIDE',
    text: (b?.textContent ?? '').replace(/​/g, '').trim().slice(0, 30),
  }
}

const STATE = () => {
  const v = (
    window as unknown as {
      vditor?: {
        getValue?: () => string
        vditor?: { ir?: { element?: HTMLElement } }
      }
    }
  ).vditor
  return {
    hrCount: v?.vditor?.ir?.element?.querySelectorAll('hr').length ?? 0,
    value: v?.getValue?.() ?? '',
  }
}

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame.locator('.vditor-ir hr').first().waitFor({ timeout: 60_000 }) // fixture rule rendered
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))
  return frame
}

test('a `---` typed under content promotes to a real <hr> once the caret leaves it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)
  const start = await frame.locator('body').evaluate(STATE)
  expect(start.hrCount).toBe(1) // the fixture's single rule

  // type a SECOND rule under the existing content, then move the caret away (click the heading)
  await frame.locator('.vditor-ir').getByText('below the rule').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('Enter')
  await workbox.keyboard.type('--- ', { delay: 60 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))
  await frame.locator('.vditor-ir').getByText('HR editing').click() // leave the `--- ` line
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 600)))

  const after = await frame.locator('body').evaluate(STATE)
  // eslint-disable-next-line no-console
  console.log(`[hr-edit] create: ${JSON.stringify(after)}`)
  expect(after.hrCount).toBe(2) // the typed `--- ` rendered as a real rule (not stuck literal text)
  // both rules round-trip through Lute (two thematic breaks in the markdown)
  expect((after.value.match(/^---$/gm) ?? []).length).toBeGreaterThanOrEqual(2)
})

test('ArrowDown/Up steps the caret across a void <hr> instead of getting stuck', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const frame = await open(workbox, evaluateInVSCode)

  // caret at the end of "above the rule", ArrowDown → must land in "below the rule" (past the <hr>),
  // never OUTSIDE / stuck on the rule.
  await frame.locator('.vditor-ir').getByText('above the rule').click()
  await workbox.keyboard.press('End')
  await workbox.keyboard.press('ArrowDown')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 250)))
  const down = await frame.locator('body').evaluate(CARET)
  // eslint-disable-next-line no-console
  console.log(`[hr-edit] ArrowDown landed: ${JSON.stringify(down)}`)
  expect(down.block).not.toBe('OUTSIDE') // not dropped on the void rule
  expect(down.text).toContain('below the rule') // stepped past the rule into the next block

  // and back UP across the rule → "above the rule"
  await workbox.keyboard.press('ArrowUp')
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 250)))
  const up = await frame.locator('body').evaluate(CARET)
  // eslint-disable-next-line no-console
  console.log(`[hr-edit] ArrowUp landed: ${JSON.stringify(up)}`)
  expect(up.block).not.toBe('OUTSIDE')
  expect(up.text).toContain('above the rule')
})
