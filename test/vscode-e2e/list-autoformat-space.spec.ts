import { settle, wf } from './webview-helpers'
// REGRESSION (task 441) — a leading list marker must become a list on the SPACE, not only after a
// content character. Real VS Code, IR and WYSIWYG.
//
// The bug (probe-confirmed 2026-07-30): IR input() has an `endSpace` fast-path that early-returns
// WITHOUT spinning when the block is only a marker + trailing space, so `9. ` / `- ` stayed a plain
// paragraph until a letter re-triggered the spin. Vditor already exempts ATX headings from that path
// (`# ` → heading on the space); patchIrListMarkerOnSpace (esbuild-shared.mjs) widens the exemption to
// list markers, so the empty item forms immediately with the caret inside it.
//
// WYSIWYG needed the SAME fix, and this spec is what proved it: the header used to claim WYSIWYG
// "has no such fast-path (it always spins) and already formed the list". False — WYSIWYG's guard
// lives one level up, in the `input` event LISTENER (wysiwyg/index.ts), and returns before input()
// is ever called, so `9. ` and `- ` both stayed plain paragraphs there. patchWysiwygListMarkerOnSpace
// widens the identical heading carve-out in that file.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'list-typing.md')

// List elements on the active editor surface + whether the collapsed caret sits inside an EMPTY list
// item (the content-less item the marker's space should have just created).
const listState = (frame: ReturnType<typeof wf>, surface: string) =>
  frame.locator('body').evaluate((_el, sel) => {
    const root = document.querySelector(sel as string)
    const space = window.getSelection()
    let caretInEmptyLi = false
    if (spaceGuard(space)) {
      const li = (
        space.anchorNode instanceof Element
          ? space.anchorNode
          : space.anchorNode?.parentElement
      )?.closest('li')
      // "empty" ignores the zero-width space Vditor seeds the item with.
      if (li && (li.textContent ?? '').replace(/​/g, '').trim() === '')
        caretInEmptyLi = true
    }
    function spaceGuard(s: Selection | null): s is Selection {
      return !!s && s.rangeCount > 0 && !!s.anchorNode
    }
    return {
      ol: root?.querySelectorAll('ol').length ?? -1,
      ul: root?.querySelectorAll('ul').length ?? -1,
      caretInEmptyLi,
    }
  }, surface)

// Put the caret at the end of the `typehere` prose line, then Enter → a fresh empty block to type into.
async function freshLine(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  surface: string,
) {
  await frame
    .locator(surface)
    .first()
    .click({ position: { x: 4, y: 4 } })
  // NOT stickySelection (2026-08-15): the caret is placed and Enter is pressed IMMEDIATELY after,
  // and the helper's ~200ms verification wait is enough for the block to re-render around it — the
  // Enter then splits a different node. Flaky in the full suite through the helper, clean with the
  // plain write. Same exemption as list-backspace and the expanded-IR-source sites.
  await frame.locator('body').evaluate((_el, sel) => {
    const root = document.querySelector(sel as string) as HTMLElement | null
    if (!root) throw new Error(`no ${sel}`)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf('typehere')
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n as Text, i + 'typehere'.length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      ;(n.parentElement as HTMLElement | null)?.focus()
      return
    }
    throw new Error('typehere anchor not found')
  }, surface)
  await workbox.keyboard.press('Enter')
  await settle(frame, 300)
}

// Undo repeatedly until no list element remains on the surface (restores the fresh-line baseline).
async function undoUntilNoList(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  surface: string,
) {
  for (let i = 0; i < 6; i++) {
    const { ol, ul } = await listState(frame, surface)
    if (ol === 0 && ul === 0) return
    await workbox.keyboard.press('Control+z')
    await settle(frame, 250)
  }
}

// Type `marker` + Space on a fresh line and assert the list formed BEFORE any content character, with
// the caret inside the new empty item. `kind` picks which list element must appear.
async function assertFormsOnSpace(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  surface: string,
  marker: string,
  kind: 'ol' | 'ul',
) {
  await freshLine(workbox, frame, surface)
  await workbox.keyboard.type(marker)
  await workbox.keyboard.press('Space')
  await settle(frame, 600)
  const st = await listState(frame, surface)
  const label = `${surface} "${marker} "`
  if (kind === 'ol') {
    expect(st.ol, `${label}: ordered list formed on the space`).toBeGreaterThan(
      0,
    )
  } else {
    expect(
      st.ul,
      `${label}: unordered list formed on the space`,
    ).toBeGreaterThan(0)
  }
  expect(
    st.caretInEmptyLi,
    `${label}: caret sits inside the new empty item`,
  ).toBe(true)
  await undoUntilNoList(workbox, frame, surface)
}

test('a list marker forms a list on the SPACE, caret inside the empty item (IR + WYSIWYG)', async ({
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

  // IR — ordered and every unordered marker must all form on the space.
  await assertFormsOnSpace(workbox, frame, '.vditor-ir', '9.', 'ol')
  await assertFormsOnSpace(workbox, frame, '.vditor-ir', '-', 'ul')
  await assertFormsOnSpace(workbox, frame, '.vditor-ir', '*', 'ul')
  await assertFormsOnSpace(workbox, frame, '.vditor-ir', '+', 'ul')

  // WYSIWYG — same gesture, via the always-spin path (no companion patch, must already work).
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
  await assertFormsOnSpace(workbox, frame, '.vditor-wysiwyg', '9.', 'ol')
  await assertFormsOnSpace(workbox, frame, '.vditor-wysiwyg', '-', 'ul')
})
