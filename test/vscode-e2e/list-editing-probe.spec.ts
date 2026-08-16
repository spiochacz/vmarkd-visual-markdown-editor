import { settle, stickySelection, wf } from './webview-helpers'
// PROBE (task 428) — records the CURRENT behaviour of list-editing key handling in the real VS Code
// webview, so "list usability, itp" becomes a concrete pass/fail matrix. NOT a regression net: it logs
// each operation's markdown before→after and a heuristic verdict against the real-editor baseline. IR
// mode (the default the user edits in). Run and read the [list-probe] lines.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'list-probe.md')

const getValue = (frame: ReturnType<typeof wf>) =>
  frame
    .locator('body')
    .evaluate(
      () =>
        (
          window as unknown as { vditor?: { getValue?: () => string } }
        ).vditor?.getValue?.() ?? '',
    ) as Promise<string>

// Collapsed caret at `where` of the first text node containing `needle` in the IR surface.
async function caret(
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
        // Skip the editable-marker source copy (IR keeps a hidden source <pre>) — take the one that
        // is NOT inside a marker/pre so the caret lands in the live editable text.
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

// Lines of `md` from the one containing `from` to just before the next blank line — the affected list.
function block(md: string, from: string): string {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => l.includes(from))
  if (start < 0) return `(anchor ${from} gone)`
  let end = start
  while (end < lines.length && lines[end].trim() !== '') end++
  // include one line above if it's a list line too (for split cases)
  let top = start
  while (
    top > 0 &&
    lines[top - 1].trim() !== '' &&
    /^\s*([-*]|\d+\.)\s/.test(lines[top - 1])
  )
    top--
  return lines.slice(top, end).join('\n')
}

test('probe: list editing key behaviour (IR) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
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

  const run = async (
    label: string,
    anchor: string,
    where: 'start' | 'end',
    keys: string[],
    baseline: string,
  ) => {
    const before = block(await getValue(frame), anchor)
    await caret(frame, anchor, where)
    for (const k of keys) {
      await workbox.keyboard.press(k)
      await settle(frame, 250)
    }
    await settle(frame, 400)
    const after = block(await getValue(frame), anchor)
    // eslint-disable-next-line no-console
    console.log(
      `\n[list-probe] === ${label} ===\n  keys: ${keys.join(' , ')}\n  baseline: ${baseline}\n  BEFORE:\n${before.replace(/^/gm, '    ')}\n  AFTER:\n${after.replace(/^/gm, '    ')}`,
    )
  }

  // 1. Enter at the START of a non-empty item → real editors push the text down as a NEW item, leaving
  //    an empty item above (or split), NOT duplicate/merge.
  await run(
    '1 Enter at start of non-empty item (ubanana)',
    'ubanana',
    'start',
    ['Enter'],
    'an empty "- " item appears ABOVE ubanana; ubanana stays its own item',
  )

  // 2. Enter on an EMPTY item should EXIT the list (→ plain paragraph). Make the empty item first:
  //    caret at end of ebeta, Enter (new empty item), Enter again (should exit).
  await run(
    '2 Enter on empty item exits list (after ebeta)',
    'ebeta',
    'end',
    ['Enter', 'Enter'],
    'second Enter leaves the list: an empty PARAGRAPH, not a third "- " bullet',
  )

  // 3. Backspace on the marker of an item WITH text (caret at start of otwo's text) → real editors
  //    outdent / convert the item to a plain paragraph cleanly, no text mangling, siblings renumber.
  await run(
    '3 Backspace on marker, ordered item with text (otwo)',
    'otwo',
    'start',
    ['Backspace'],
    'otwo becomes a plain paragraph (or outdents); oone/othree stay a clean 1. / 2. list',
  )

  // 4. Backspace on the marker of a NESTED item (caret at start of nchildone) → outdent to parent level.
  await run(
    '4 Backspace on marker, nested item (nchildone)',
    'nchildone',
    'start',
    ['Backspace'],
    'nchildone outdents to the nparent level (becomes a top-level "- " item), text intact',
  )

  // 5. Enter on a checklist item → the new item is also a checklist "- [ ] ", not a plain bullet.
  await run(
    '5 Enter continues checklist (after ctaskone)',
    'ctaskone',
    'end',
    ['Enter'],
    'a new "- [ ] " checklist item appears after ctaskone',
  )

  // 6. Backspace on the marker of a checklist item with text (caret at start of ctasktwo text).
  await run(
    '6 Backspace on marker, checklist item (ctasktwo)',
    'ctasktwo',
    'start',
    ['Backspace'],
    'ctasktwo becomes a plain paragraph / loses the checkbox cleanly, text intact',
  )
})
