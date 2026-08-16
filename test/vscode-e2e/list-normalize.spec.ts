import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, stickySelection, wf } from './webview-helpers'

// Task 255 — "Fix list numbering" (vmarkd.fixListNumbering) / "Renormalize all lists"
// (vmarkd.renormalizeAllLists). This is the L3 leg: real VS Code commands, executed exactly as
// the palette would (`vscode.commands.executeCommand`), through the host → postMessage →
// message-router.ts wiring — proving that path end-to-end. The block-scoped Lute-spin mechanics
// themselves (execAfterRender/undo/caret restore) are covered by
// media-src/e2e/list-normalize.spec.ts (harness, cheaper, calls the webview functions directly).
//
// Staleness is injected the same way the harness spec does: a raw `<li>.remove()` (no Lute spin),
// NOT source text with wrong numbers — Vditor's own initial parse already renumbers on load, so a
// merely-mis-numbered fixture would already read back correct.
const FIXTURE = path.join(__dirname, 'fixtures', 'list-renumber.md')

const getValue = (frame: ReturnType<typeof wf>) =>
  frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    ) as Promise<string>

function removeListItem(frame: ReturnType<typeof wf>, needle: string) {
  return frame.locator('body').evaluate((_el, needle: string) => {
    const li = [
      ...document.querySelectorAll('.vditor-ir li, .vditor-wysiwyg li'),
    ].find((x) => (x.childNodes[0]?.textContent ?? '').includes(needle))
    if (!li) throw new Error(`removeListItem: ${needle} not found`)
    li.remove()
  }, needle)
}

async function caretAt(
  frame: ReturnType<typeof wf>,
  needle: string,
  offset: number,
  surface = '.vditor-ir',
) {
  await frame
    .locator(surface)
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [n, off, sel] = args as [string, number, string]
      const root = document.querySelector(sel) as HTMLElement | null
      if (!root) throw new Error(`no ${sel}`)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.textContent ?? '').includes(n)) continue
        const r = document.createRange()
        r.setStart(node as Text, Math.min(off, node.textContent?.length ?? 0))
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(node.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`anchor ${n} not found in ${sel}`)
    },
    [needle, offset, surface] as [string, number, string],
  )
}

test('vmarkd.fixListNumbering / vmarkd.renormalizeAllLists renumber lists via the real VS Code command (IR + WYSIWYG)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file((args as string[])[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)

  // 1. Fix list numbering at the caret — first list only, nested sublist included.
  await removeListItem(frame, 'beta')
  await removeListItem(frame, 'nested-x')
  const stale = await getValue(frame)
  expect(stale, 'sanity: removal alone leaves stale numbering').toMatch(
    /3\.\s+gamma/,
  )

  await caretAt(frame, 'gamma', 2)
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('vmarkd.fixListNumbering')
  })
  await settle(frame, 500)

  const afterFix = await getValue(frame)
  expect(afterFix).toMatch(/1\.\s+alpha/)
  expect(afterFix).toMatch(/2\.\s+gamma/)
  expect(afterFix).toMatch(/3\.\s+delta/)
  expect(afterFix).toMatch(/1\.\s+nested-y/)
  // The second list (untouched by the caret-scoped command) keeps ITS pre-existing numbering.
  expect(afterFix).toMatch(/1\.\s+first/)
  expect(afterFix).toMatch(/2\.\s+second/)
  expect(afterFix).toMatch(/3\.\s+third/)

  // 2. Renormalize all lists — stale the SECOND list, then fix the whole document.
  await removeListItem(frame, 'first')
  const staleAll = await getValue(frame)
  expect(staleAll, 'sanity: removal leaves the second list stale').toMatch(
    /3\.\s+third/,
  )

  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('vmarkd.renormalizeAllLists')
  })
  await settle(frame, 500)

  const afterAll = await getValue(frame)
  expect(afterAll).toMatch(/1\.\s+second/)
  expect(afterAll).toMatch(/2\.\s+third/)
  expect(
    afterAll,
    'the plain paragraph between the two lists is untouched',
  ).toContain(
    'This paragraph must survive `Renormalize all lists` byte-identical.',
  )
  expect(afterAll, 'headings are untouched').toContain(
    '## A plain paragraph between the two lists',
  )

  // 3. WYSIWYG uses the SAME functions (mode-branches on SpinVditorDOM vs SpinVditorIRDOM) — one
  // pass proves the branch, not a full re-run of every case above.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
  await settle(frame, 1500)

  await removeListItem(frame, 'delta')
  const staleWysiwyg = await getValue(frame)
  expect(staleWysiwyg, 'sanity: removal leaves the first list stale').toMatch(
    /2\.\s+gamma/,
  )
  await caretAt(frame, 'gamma', 2, '.vditor-wysiwyg')
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('vmarkd.fixListNumbering')
  })
  await settle(frame, 500)

  const afterWysiwyg = await getValue(frame)
  expect(afterWysiwyg).toMatch(/1\.\s+alpha/)
  expect(afterWysiwyg).toMatch(/2\.\s+gamma/)
  expect(afterWysiwyg).not.toContain('delta')
})
