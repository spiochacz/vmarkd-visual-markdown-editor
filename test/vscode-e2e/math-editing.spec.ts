import { docText, settle, wf } from './webview-helpers'
// C3 (task 516) — math editing. Today only rendering (echarts-theme-style specs) and open-cost
// (katex-open-cost.spec.ts) are covered; nothing edits a live inline `$x$` or block `$$...$$`
// formula and checks the re-render + save fidelity, and nothing checks that backspacing across
// the inline-math boundary doesn't corrupt the document. Both math node types are Lute-native
// dual nodes (marker + `.vditor-ir__preview` KaTeX render) — same as block-fidelity's other
// fragile blocks — so this is real custom-editor-only behaviour.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const SRC = path.join(__dirname, 'fixtures', 'math-editing.md')
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

async function open(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  file: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await expect
    .poll(() => frame.locator('.vditor-ir .katex').count(), {
      message: 'both formulas rendered as KaTeX',
    })
    .toBeGreaterThanOrEqual(2)
  // page-level keyboard focus into the nested iframe (see block-fidelity.spec.ts).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await settle(frame, 300)
  return frame
}

// The live markdown source, straight from Vditor's own getValue() — the ground truth for "what
// did the edit actually produce", independent of how KaTeX chooses to lay the glyphs out. (KaTeX
// here renders `output:'html'` only — no `<annotation encoding="application/x-tex">` MathML
// escape hatch to scrape instead, measured via a throwaway DOM probe.)
async function getValue(frame: ReturnType<typeof wf>): Promise<string> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
}

// Count of rendered `.katex` nodes — the re-render signal: after an edit + caret-leave this must
// still be >=2 (the node re-rendered in place, not vanished/errored).
async function katexCount(frame: ReturnType<typeof wf>): Promise<number> {
  return frame.locator('.vditor-ir .katex').count()
}

// Expand the given math node, place the caret after `anchor` inside its editable source, and
// focus it. Mirrors diagram-edit-monitor.spec.ts's placeCaretAfter — same dual-node contract, but
// the two math types differ in shape (measured via a throwaway DOM probe, since neither is
// documented): `math-block` is a `.vditor-ir__node[data-type="math-block"]` wrapping a
// `pre.vditor-ir__marker--pre > code` source. `math-inline`'s `.vditor-ir__node` wrapper carries
// `data-type="inline-node"` (NOT "math-inline" — that attribute is on the `<code>` marker one
// level down instead), so a selector keyed off `math-inline` finds only the marker, not the node
// vditor's own CSS gates on `--expand`. Without `--expand` on the actual node, the marker sits
// `display:none` and setting a Selection Range inside it is silently DROPPED by the browser (the
// first attempt at this test proved that empirically: the typed text landed at document position
// 0 instead of inside the formula — not a product bug, a test bug from targeting the wrong
// element for the class toggle).
async function placeCaretInMath(
  frame: ReturnType<typeof wf>,
  dataType: 'math-inline' | 'math-block',
  anchor: string,
) {
  return frame.locator('body').evaluate(
    (_el, { dataType, anchor }) => {
      const node =
        dataType === 'math-block'
          ? (document.querySelector(
              '.vditor-ir [data-type="math-block"].vditor-ir__node',
            ) as HTMLElement | null)
          : (document
              .querySelector('.vditor-ir code[data-type="math-inline"]')
              ?.closest('[data-type="inline-node"]') as HTMLElement | null)
      if (!node) return false
      node.classList.add('vditor-ir__node--expand')
      const source = (
        dataType === 'math-block'
          ? node.querySelector('.vditor-ir__marker--pre')
          : node.querySelector('code[data-type="math-inline"]')
      ) as HTMLElement | null
      if (!source) return false
      // Extracted so this evaluate stays under the cognitive-complexity gate.
      const findTextNode = (root: HTMLElement, needle: string): Text | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (
          let n = walker.nextNode() as Text | null;
          n;
          n = walker.nextNode() as Text | null
        ) {
          if (n.textContent?.includes(needle)) return n
        }
        return null
      }
      const target = findTextNode(source, anchor)
      if (!target) return false
      const idx = (target.textContent ?? '').indexOf(anchor) + anchor.length
      const r = document.createRange()
      r.setStart(target, idx)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      source.focus()
      return true
    },
    { dataType, anchor },
  )
}

test('editing inline and block math re-renders and round-trips on save', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-math-editing-edit.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  const frame = await open(workbox, evaluateInVSCode, tmp)

  const before = await getValue(frame)
  // eslint-disable-next-line no-console
  console.log(`[math-editing] before: ${JSON.stringify(before)}`)
  expect(before).toContain('x^2 + y^2 = z^2')
  expect(before).toContain('a + b = c')

  const gotInline = await placeCaretInMath(frame, 'math-inline', 'z^2')
  expect(gotInline, 'placed the caret inside the inline formula source').toBe(
    true,
  )
  await workbox.keyboard.type(' + w^2', { delay: 40 })
  // Leave the node so the marker-leave re-render fires (diagram-edit-monitor's own contract).
  await frame.locator('.vditor-ir').getByText('Block math follows').click()
  await settle(frame, 600)

  const gotBlock = await placeCaretInMath(frame, 'math-block', 'a + b = c')
  expect(gotBlock, 'placed the caret inside the block formula source').toBe(
    true,
  )
  await workbox.keyboard.type(' + d', { delay: 40 })
  await frame.locator('.vditor-ir').getByText('Trailing paragraph').click()
  await settle(frame, 600)

  await expect
    .poll(
      async () => (await docText(evaluateInVSCode, tmp)).includes('+ w^2'),
      {
        message: 'the inline math edit reached the saved TextDocument',
      },
    )
    .toBe(true)
  await expect
    .poll(async () => (await docText(evaluateInVSCode, tmp)).includes('+ d'), {
      message: 'the block math edit reached the saved TextDocument',
    })
    .toBe(true)

  const after = await getValue(frame)
  const renderedCount = await katexCount(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[math-editing] after: ${JSON.stringify(after)} katexCount=${renderedCount}`,
  )
  expect(after, 'the inline edit is in the live source').toContain('w^2')
  expect(after, 'the block edit is in the live source').toMatch(
    /a \+ b = c\s*\+\s*d/,
  )
  expect(
    renderedCount,
    'both formulas re-rendered as KaTeX (neither vanished/errored)',
  ).toBeGreaterThanOrEqual(2)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.files.save')
    },
    [] as [string],
  )
  await settle(frame, 500)
  const saved = readFileSync(tmp, 'utf8')
  rmSync(tmp, { force: true })
  // eslint-disable-next-line no-console
  console.log(`[math-editing] saved: ${JSON.stringify(saved)}`)
  expect(saved, 'inline edit on disk').toContain('w^2')
  expect(saved, 'block edit on disk').toMatch(/a \+ b = c\s*\+\s*d/)
  expect(saved, 'the untouched trailing paragraph survives').toContain(
    'Trailing paragraph, untouched by any edit in this spec.',
  )
})

test('backspacing right after the inline-math boundary does not corrupt the document', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(TEMP_DIR, 'vmarkd-math-editing-boundary.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  const frame = await open(workbox, evaluateInVSCode, tmp)

  // Caret at the START of the text node right after the inline math's closing `$` (the space
  // before "in a sentence."), then one Backspace — the exact accident this journey is worried
  // about: does deleting AT the math boundary eat the node cleanly, or leave a broken half-`$`
  // fragment that corrupts the rest of the paragraph?
  const placed = await frame.locator('body').evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector('.vditor-ir') as Node,
      NodeFilter.SHOW_TEXT,
    )
    for (
      let n = walker.nextNode() as Text | null;
      n;
      n = walker.nextNode() as Text | null
    ) {
      const text = n.textContent ?? ''
      if (!text.includes('in a sentence.')) continue
      const idx = text.indexOf('in a sentence.')
      const r = document.createRange()
      r.setStart(n, idx)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      ;(n.parentElement as HTMLElement | null)?.focus()
      return true
    }
    return false
  })
  expect(placed, 'placed the caret right after the math boundary').toBe(true)

  await workbox.keyboard.press('Backspace')
  await settle(frame, 500)

  const value = await frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    )
  // eslint-disable-next-line no-console
  console.log(
    `[math-editing] after boundary backspace: ${JSON.stringify(value)}`,
  )

  // Well-formedness, not a guess at exactly which characters vditor chose to delete: dollar signs
  // stay balanced (no half-open `$...` left dangling)…
  expect(
    (value.match(/\$/g) ?? []).length % 2,
    'inline math delimiters stay balanced',
  ).toBe(0)
  // …the rest of the sentence was not eaten beyond the single boundary character…
  expect(value, 'the tail of the sentence survives').toContain('sentence.')
  // …and the untouched later blocks are completely unaffected.
  expect(value, 'block math untouched').toContain('a + b = c')
  expect(value, 'the trailing paragraph untouched').toContain(
    'Trailing paragraph, untouched by any edit in this spec.',
  )

  rmSync(tmp, { force: true })
})
