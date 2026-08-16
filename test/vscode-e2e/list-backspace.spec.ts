import { settle, wf } from './webview-helpers'
// REGRESSION (task 428) — Backspace at the START of a list item's text must NOT merge the item into
// the previous one. Real VS Code, IR mode.
//
// The bug (probe-confirmed 2026-07-30): Vditor's fixList handles Backspace-at-start only for the FIRST
// item and for an EMPTY item; a NON-first item with text fell through to the browser default, which
// glued the two items' text together — "1. otwo" → "1. ooneotwo", "- nchildone" nested → merged onto
// its parent as "- nparentnchildone". list-backspace.ts intercepts that case: nested → outdent one
// level (like Shift+Tab), top-level → lift to a plain paragraph, splitting/renumbering the list.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

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

// Collapsed caret at the START of the first live (non-marker) text node containing `needle` in the
// active editor surface (.vditor-ir or .vditor-wysiwyg).
async function caretAtStart(
  frame: ReturnType<typeof wf>,
  needle: string,
  surface = '.vditor-ir',
) {
  await frame
    .locator(surface)
    .first()
    .click({ position: { x: 4, y: 4 } })
  // NOT stickySelection (2026-08-15): the caret lands in a LIST ITEM's text and the very next act is
  // a Backspace on it. The helper's ~200ms verification wait is enough for the item's dual node to
  // re-render around the caret, and the key then acts on a different node — this spec failed the
  // full suite twice in a row through it (retry included) and passes with the plain write. Same
  // exemption as the expanded-IR-source sites: place the caret and press IMMEDIATELY.
  await frame.locator('body').evaluate(
    (_el, args) => {
      const [n, sel] = args as [string, string]
      const root = document.querySelector(sel) as HTMLElement | null
      if (!root) throw new Error(`no ${sel}`)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = (node.textContent ?? '').indexOf(n)
        if (i < 0) continue
        if (
          (node.parentElement as HTMLElement)?.closest(
            '.vditor-ir__marker, .vditor-wysiwyg__preview',
          )
        )
          continue
        const r = document.createRange()
        r.setStart(node as Text, i)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(node.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`anchor ${n} not found in ${sel}`)
    },
    [needle, surface] as [string, string],
  )
}

async function backspaceAt(
  workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  needle: string,
  surface = '.vditor-ir',
) {
  await caretAtStart(frame, needle, surface)
  await workbox.keyboard.press('Backspace')
  await settle(frame, 500)
  return getValue(frame)
}

test('Backspace at the start of a list item outdents / lifts to a paragraph, never merges (IR)', async ({
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

  // 1. Ordered, TOP-LEVEL item with text → paragraph; the list splits and renumbers. NEVER "ooneotwo".
  const ordered = await backspaceAt(workbox, frame, 'otwo')
  expect(ordered, 'no text merge into the previous item').not.toContain(
    'ooneotwo',
  )
  expect(ordered, 'otwo lifted to a plain paragraph line').toMatch(/^otwo$/m)
  expect(ordered, 'oone stays an ordered item').toMatch(/^1\. oone$/m)
  expect(ordered, 'othree stays an ordered item').toMatch(/^\d+\. othree$/m)

  // 2. NESTED item → outdent one level; text intact. NEVER "nparentnchildone".
  const nested = await backspaceAt(workbox, frame, 'nchildone')
  expect(nested, 'no merge into the parent item').not.toContain(
    'nparentnchildone',
  )
  expect(nested, 'nchildone survives as its own item').toContain('nchildone')
  expect(nested, 'nparent stays its own item').toMatch(/^- nparent$/m)

  // 3. CHECKLIST item with text → plain paragraph, checkbox dropped. NEVER a literal "[ ] ctasktwo".
  const check = await backspaceAt(workbox, frame, 'ctasktwo')
  expect(check, 'ctasktwo lifted to a plain paragraph line').toMatch(
    /^ctasktwo$/m,
  )
  expect(check, 'no leftover literal checkbox on the lifted item').not.toMatch(
    /^\[ \]\s*ctasktwo/m,
  )
  expect(check, 'ctaskone stays a checklist item').toMatch(
    /^- \[ \]\s+ctaskone$/m,
  )

  // 4. PRESERVATION — Vditor still owns the FIRST-item case (→ paragraph), we do NOT intercept it and
  //    it must not merge. uapple is the first item of its list; Backspace lifts it to a paragraph.
  const first = await backspaceAt(workbox, frame, 'uapple')
  expect(first, 'first item did not merge with the next').not.toContain(
    'uappleubanana',
  )
  expect(first, 'ubanana stays a bullet').toMatch(/^- ubanana$/m)

  // 5. WYSIWYG mode uses the SAME handler (SpinVditorDOM path). Switch modes and lift a top-level
  //    unordered item IR never touched (ebeta, with ealpha above) — it must become a paragraph, not
  //    merge into ealpha ("ealphaebeta").
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
  const wy = await backspaceAt(workbox, frame, 'ebeta', '.vditor-wysiwyg')
  expect(wy, 'WYSIWYG: no merge into the previous item').not.toContain(
    'ealphaebeta',
  )
  expect(wy, 'WYSIWYG: ebeta lifted to a paragraph').toMatch(/^ebeta$/m)
  expect(wy, 'WYSIWYG: ealpha stays a bullet').toMatch(/^- ealpha$/m)
})
