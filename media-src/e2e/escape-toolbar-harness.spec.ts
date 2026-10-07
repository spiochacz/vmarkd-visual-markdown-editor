import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Task 456 — chromium-harness net for escape-toolbar.ts: runs the SAME module against a REAL
// toolbar DOM in plain chromium (no VS Code boot, no shared .vscode-test state), so the toolbar-
// traversal logic and the caret-restore fix below can both be checked fast, without paying for a
// VS Code boot per iteration. (History: an earlier real-VS-Code-only "focus never moves" failure
// traced back to a stale synchronous `document.activeElement` read in a diagnostic, not a real bug
// — see task 456's thread. The actual product bug this harness now also covers: returning focus to
// the editor after a toolbar visit left it focused but with NO caret, because focusing a <button>
// collapses the browser's Selection — see escape-toolbar.ts's returnFocusToEditor().)

async function open(page: Page) {
  await page.goto('/escape-toolbar.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  const box = await page.evaluate(() => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const r = el.getBoundingClientRect()
    return { x: r.x + 8, y: r.y + 8 }
  })
  await page.mouse.click(box.x, box.y)
}

// Place the caret INSIDE the word "paragraph" (not at column 0 of the line): a tab inserted at the
// very start of the first line is CommonMark-valid indentation for an INDENTED CODE BLOCK, so
// Lute's round-trip re-serializes it as a fenced block instead of preserving the literal "\t" —
// a real Markdown-semantics quirk, not a bug, but it makes "does getValue() still contain \t" the
// wrong check at column 0. Every test that asserts on a literal inserted tab character places the
// caret here first so that check means what it says.
async function placeCaretMidWord(page: Page) {
  await page.evaluate(() => {
    const editor = (window as any).vditor.vditor.ir.element as HTMLElement
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf('paragraph')
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n as Text, i + 2) // mid-word, never column 0
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      ;(n.parentElement as HTMLElement | null)?.focus()
      return
    }
    throw new Error('"paragraph" text not found')
  })
}

function state(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return {
      value: (window as any).vditor.getValue() as string,
      activeTag: active?.tagName ?? null,
      inEditor: !!active?.closest?.('.vditor-ir'),
      inToolbarItem: !!active?.closest?.('.vditor-toolbar__item'),
      activeTabIndex: active ? active.tabIndex : null,
    }
  })
}

// Lead 1 + 3: does the roving-item walk find real, LIVE, attached toolbar buttons?
function toolbarProbe(page: Page) {
  return page.evaluate(() => {
    const toolbarEl = (window as any).vditor.vditor.toolbar
      .element as HTMLElement
    const isLive = document.body.contains(toolbarEl)
    const items = Array.from(toolbarEl.children).filter((c) =>
      (c as HTMLElement).classList.contains('vditor-toolbar__item'),
    )
    const first = items[0]?.firstElementChild as HTMLElement | undefined
    return {
      toolbarIsLive: isLive,
      itemCount: items.length,
      firstTag: first?.tagName ?? null,
      firstTabIndexAttr: first?.getAttribute('tabindex'),
      firstDisabled: (first as any)?.disabled ?? null,
    }
  })
}

test('toolbar DOM sanity: live, attached, real focusable buttons', async ({
  page,
}) => {
  await open(page)
  const probe = await toolbarProbe(page)
  expect(
    probe.toolbarIsLive,
    'toolbar.element is attached to the document',
  ).toBe(true)
  expect(
    probe.itemCount,
    'at least one .vditor-toolbar__item found',
  ).toBeGreaterThan(0)
  expect(probe.firstTag, 'the roving target is a real <button>').toBe('BUTTON')
})

test('Escape then Tab moves focus to a toolbar button without mutating the document', async ({
  page,
}) => {
  await open(page)
  const before = await state(page)
  expect(before.inEditor).toBe(true)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  const after = await state(page)
  expect(after.value, 'no mutation').toBe(before.value)
  expect(after.inEditor, 'focus left the editor').toBe(false)
  expect(after.inToolbarItem, 'focus landed on a toolbar item').toBe(true)
  expect(after.activeTabIndex).toBe(0)
})

// The root-cause bug (task 456): Escape from the toolbar returned DOM focus to the editor, but
// focusing the toolbar button earlier had already collapsed the browser's Selection, so the editor
// came back with focus and NO caret — Tab (and typing) then did nothing. returnFocusToEditor()
// fixes this via editor-caret.ts's restoreEditorCaretIfLost(), which needs the continuously-updated
// snapshot from installEditorCaretTracking() (wired in this harness's after(), matching main.ts).
test('Escape back from the toolbar restores a WORKING caret — Tab indents again afterward', async ({
  page,
}) => {
  await open(page)
  await placeCaretMidWord(page)
  const before = await state(page)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  const onToolbar = await state(page)
  expect(onToolbar.inToolbarItem, 'sanity: reached the toolbar').toBe(true)

  await page.keyboard.press('Escape') // return leg
  await page.waitForTimeout(100)
  const backInEditor = await state(page)
  expect(backInEditor.inEditor, 'focus returned to the editor').toBe(true)
  expect(backInEditor.value, 'the return leg did not mutate the document').toBe(
    before.value,
  )

  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  const afterReturnTab = await state(page)
  expect(
    afterReturnTab.value.includes('\t'),
    'a tab character was inserted — the caret survived the round trip, not just DOM focus',
  ).toBe(true)
  expect(
    afterReturnTab.inToolbarItem,
    'stayed in the editor, not the toolbar',
  ).toBe(false)
})

// Task 522 — VS Code's find widget (Electron findInFrame) gives the webview window a `focus` and
// takes it back with a `blur` a few ms later; focus-restore must not pull focus into the editor.
test('window focus followed by blur does not pull focus into the editor (task 522)', async ({
  page,
}) => {
  await page.goto('/escape-toolbar.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForTimeout(250)
  const result = await page.evaluate(async () => {
    const ed = document.querySelector('.vditor-ir .vditor-reset') as HTMLElement
    ed.focus()
    const range = document.createRange()
    range.selectNodeContents(ed.querySelector('p') as HTMLElement)
    range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    // The find handshake state: focus is NOT in the editor (a bare BODY, as VS Code hands it back).
    // The editor's own focusout path (a separate listener, not under test) is neutralised by
    // reporting "no OS focus" while it drains, then the real hasFocus() is put back.
    const realHasFocus = document.hasFocus.bind(document)
    document.hasFocus = () => false
    ed.blur()
    // Also lets Vditor's own delayed undo checkpoint (addCaret → setSelectionFocus, which refocuses
    // the editor by itself and is unrelated to focus-restore) drain before the handshake starts.
    await new Promise((r) => setTimeout(r, 1500))
    document.hasFocus = realHasFocus
    // Vditor's checkpoint may have refocused the editor during the drain: put the handshake state back.
    document.hasFocus = () => false
    ed.blur()
    await new Promise((r) => setTimeout(r, 150))
    document.hasFocus = realHasFocus
    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 15))
    window.dispatchEvent(new Event('blur'))
    await new Promise((r) => setTimeout(r, 400))
    return !ed.contains(document.activeElement)
  })
  expect(result).toBe(true)
})
