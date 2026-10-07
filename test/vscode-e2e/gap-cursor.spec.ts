import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { wf } from './webview-helpers'

// Task 292's headline case in the REAL custom-editor pipeline: a document that STARTS with a
// rendered diagram used to have no caret position above it at all — clicking the empty strip over
// it dropped the caret INSIDE the fence, and there was no key that reached above it either. Only
// meaningful here: the strip's very existence depends on VS Code's injected webview CSS and on the
// diagram being really rendered (a mermaid SVG, not the raw fence), neither of which the chromium
// harness reproduces.
const FIXTURE = path.join(__dirname, 'fixtures', 'gap-cursor-lead-diagram.md')

const VALUE = () =>
  (
    window as unknown as { vditor?: { getValue?: () => string } }
  ).vditor?.getValue?.() ?? ''

// Where the caret sits, as `index:tag`, plus the block chain — same shape as hr-edit.spec.ts's.
const CHAIN = () => {
  const ir = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  if (!ir) return { chain: '', caret: 'NO-EDITOR' }
  const label = (el: Element) =>
    el.getAttribute('data-type') || el.tagName.toLowerCase()
  const blocks = Array.from(ir.children)
  const sel = window.getSelection()
  let n: Node | null = sel?.rangeCount ? sel.anchorNode : null
  while (n?.parentElement && n.parentElement !== ir) n = n.parentElement
  const block = n?.parentElement === ir ? (n as HTMLElement) : null
  return {
    chain: blocks.map(label).join(' | '),
    caret: block ? `${blocks.indexOf(block)}:${label(block)}` : 'OUTSIDE',
  }
}

// The midpoint of the empty strip between the editable's top edge and the first block, expressed
// relative to <body> so it can be handed to Playwright's `position` (frame coordinates, not page).
const STRIP_POINT = () => {
  const ir = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element as HTMLElement
  const body = document.body.getBoundingClientRect()
  const ed = ir.getBoundingClientRect()
  const first = ir.children[0].getBoundingClientRect()
  return {
    x: first.left + 40 - body.left,
    y: (ed.top + first.top) / 2 - body.top,
    strip: first.top - ed.top,
  }
}

test('a document starting with a diagram: clicking above it opens a line, and it is saved', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
  await frame.locator('.vditor-ir svg').first().waitFor({ timeout: 60_000 }) // mermaid rendered
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1000)))

  const start = await frame.locator('body').evaluate(CHAIN)
  expect(start.chain).toBe('code-block | p') // diagram fence first, nothing above it

  const point = await frame.locator('body').evaluate(STRIP_POINT)
  // eslint-disable-next-line no-console
  console.log(`[gap-cursor] strip above the diagram: ${point.strip}px`)
  expect(point.strip).toBeGreaterThan(2) // there IS something to click

  await frame.locator('body').click({ position: { x: point.x, y: point.y } })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 300)))
  const clicked = await frame.locator('body').evaluate(CHAIN)
  // eslint-disable-next-line no-console
  console.log(`[gap-cursor] after the click: ${JSON.stringify(clicked)}`)
  expect(clicked.chain).toBe('p | code-block | p')
  expect(clicked.caret).toBe('0:p')

  await workbox.keyboard.type('title', { delay: 60 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 600)))
  const value = await frame.locator('body').evaluate(VALUE)
  // eslint-disable-next-line no-console
  console.log(`[gap-cursor] value: ${JSON.stringify(value)}`)
  expect(value).toContain('title\n\n```mermaid')
})
