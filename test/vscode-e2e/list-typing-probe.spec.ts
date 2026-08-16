import { settle, stickySelection, wf } from './webview-helpers'
// PROBE (task 428) — two more reported list gaps: (1) "1. " / "* " should become a list on the SPACE,
// not only after a letter; (2) Backspace on an EMPTY last item makes the list loose (big gaps). Logs
// getValue transitions in IR.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'list-typing.md')

const getValue = (frame: ReturnType<typeof wf>) =>
  frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    ) as Promise<string>
// Does the IR DOM currently show an ordered/unordered list element?
const listDom = (frame: ReturnType<typeof wf>) =>
  frame.locator('body').evaluate(() => {
    const ir = document.querySelector('.vditor-ir')
    return {
      ol: ir?.querySelectorAll('ol').length ?? -1,
      ul: ir?.querySelectorAll('ul').length ?? -1,
    }
  })

async function caretAt(
  frame: ReturnType<typeof wf>,
  needle: string,
  where: 'start' | 'end',
) {
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [needle, where] = args as [string, string]
      const root = document.querySelector('.vditor-ir') as HTMLElement | null
      if (!root) throw new Error('no .vditor-ir')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(needle)
        if (i < 0) continue
        if ((n.parentElement as HTMLElement)?.closest('.vditor-ir__marker'))
          continue
        const r = document.createRange()
        r.setStart(n as Text, where === 'start' ? i : i + needle.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(n.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`anchor ${needle} not found`)
    },
    [needle, where] as [string, string],
  )
}

test('probe: list autoformat-on-space + backspace-on-empty-item (IR) @probe', async ({
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

  // ISSUE 1 — type "1. " and check for a list BEFORE any letter, with our prose-skip ON then OFF.
  const run1 = async (label: string, skip: boolean) => {
    await frame.locator('body').evaluate((_el, s) => {
      ;(window as any).__vmarkdFastProseEdit = s
    }, skip)
    await caretAt(frame, 'typehere', 'end')
    await workbox.keyboard.press('Enter')
    await settle(frame, 300)
    await workbox.keyboard.type('9.')
    await workbox.keyboard.press('Space')
    await settle(frame, 700)
    const afterSpace = await listDom(frame)
    await workbox.keyboard.type('z')
    await settle(frame, 700)
    const afterLetter = await listDom(frame)
    // eslint-disable-next-line no-console
    console.log(
      `[typing] ${label} (proseSkip=${skip}): afterSpace=${JSON.stringify(afterSpace)} afterLetter=${JSON.stringify(afterLetter)}`,
    )
    // undo the two edits for the next pass
    await workbox.keyboard.press('Control+z')
    await settle(frame, 200)
    await workbox.keyboard.press('Control+z')
    await settle(frame, 300)
  }
  await run1('ISSUE1 skip ON', true)
  await run1('ISSUE1 skip OFF', false)
  await frame.locator('body').evaluate(() => {
    ;(window as any).__vmarkdFastProseEdit = true
  })

  // ISSUE 2 (faithful to the report) — the user's empty "* " last item is TYPED, and per issue 1 a
  // typed "* " does not become a list item until a letter follows, so it stays a stray paragraph after
  // the list. Reproduce THAT: caret at end of last nested item, Enter, Shift+Tab (to top level), type
  // "* " (a marker with no letter), then Backspace.
  await caretAt(frame, 'lnesttwo', 'end')
  await workbox.keyboard.press('Enter')
  await settle(frame, 300)
  await workbox.keyboard.press('Shift+Tab')
  await settle(frame, 300)
  await workbox.keyboard.type('* ')
  await settle(frame, 500)
  const typedMarker = await getValue(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[typing] after typing "* " at top level:\n${typedMarker.replace(/^/gm, '  | ')}`,
  )
  const beforeBk = typedMarker
  await workbox.keyboard.press('Backspace')
  await settle(frame, 600)
  const afterBk = await getValue(frame)
  // Visual looseness: a loose list renders <li> with a direct child <p> (big vertical margins). Also
  // sample the vertical gap between the first two top-level items.
  const loose = await frame.locator('body').evaluate(() => {
    const ir = document.querySelector('.vditor-ir')
    const lis = Array.from(ir?.querySelectorAll('li') ?? [])
    const liWithP = lis.filter((li) =>
      Array.from(li.children).some((c) => c.tagName === 'P'),
    ).length
    const topLis = Array.from(
      ir?.querySelector('ul, ol')?.children ?? [],
    ) as HTMLElement[]
    const gap =
      topLis.length >= 2
        ? topLis[1].getBoundingClientRect().top -
          topLis[0].getBoundingClientRect().bottom
        : -1
    return {
      totalLi: lis.length,
      liWithDirectP: liWithP,
      gapPx: Math.round(gap),
    }
  })
  // eslint-disable-next-line no-console
  console.log(
    `[typing] === Backspace on empty TOP-LEVEL item after a nested list ===\n  looseDOM: ${JSON.stringify(loose)}\n  BEFORE(empty item made):\n${beforeBk.replace(/^/gm, '  | ')}\n  AFTER Backspace:\n${afterBk.replace(/^/gm, '  | ')}`,
  )
})
