import { expect, test } from '@playwright/test'

// Task 522 — the caret authority's re-assert loop must not steal focus from UI outside the editor.
// Mechanism (measured in the real webview): the user types in VS Code's HOST find box, so the
// webview never sees keydown/pointerdown and the armed intent is never invalidated; each find
// keystroke focuses the frame briefly and changes the selection, and the loop's next
// removeAllRanges()+addRange() into the contenteditable then FOCUSES the editor. Here: arm an
// intent, focus an <input> outside the editor (document focused, editor not), change the selection
// the way find does, and assert the loop leaves focus and selection alone.

test('re-assert loop does not pull focus into the editor from an outside input', async ({
  page,
}) => {
  await page.goto('/codenav.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForTimeout(250)

  const result = await page.evaluate(async () => {
    const w = window as any
    const ir = w.__el() as HTMLElement
    const input = document.createElement('input')
    input.id = 'outside-find'
    document.body.appendChild(input)

    w.__requestCaret('document-start') // arms the intent + first (ungated) placement
    input.focus()
    const focusedBefore =
      document.hasFocus() && document.activeElement === input

    // Selection change that no longer matches the intent, the way find does.
    const p = ir.querySelector('p') as HTMLElement
    const r = document.createRange()
    r.selectNodeContents(p)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    // addRange alone can move focus inside a focused document; restore the "find" end state.
    input.focus()
    const selNode = sel.rangeCount ? sel.getRangeAt(0).startContainer : null

    for (let i = 0; i < 8; i++)
      await new Promise((res) => requestAnimationFrame(() => res(null)))
    return {
      focusedBefore,
      activeIsInput: document.activeElement === input,
      activeTag: document.activeElement?.tagName,
      selUntouched:
        !!sel.rangeCount && sel.getRangeAt(0).startContainer === selNode,
    }
  })

  expect(result.focusedBefore, 'harness page must report document focus').toBe(
    true,
  )
  expect(result.activeTag).toBe('INPUT')
  expect(result.activeIsInput).toBe(true)
  expect(result.selUntouched).toBe(true)
})

// Task 522 (host side) — the host's `find-open` message makes the webview skip BOTH the window-focus
// restore (focus-restore.ts) and the loop's re-asserts (caret.ts tick), because Electron's
// findInFrame focus handshake is indistinguishable from a tab return by timing. Leg 1: find open →
// window `focus` with a caret intent armed leaves focus on the BODY; leg 2: after `find-close`
// the same event restores focus to the editor (normal behaviour resumes); leg 3: a trusted
// pointerdown in the document also clears the flag.
test('host find open suppresses the focus restore and caret loop; close / user gesture resumes', async ({
  page,
}) => {
  await page.goto('/codenav.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForTimeout(250)

  const probe = () =>
    page.evaluate(async () => {
      const ir = (window as any).__el() as HTMLElement
      // The editor holds a caret but focus sits on BODY — the post-find/tab-return state.
      ;(window as any).__requestCaret('document-start')
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.dispatchEvent(new Event('focus'))
      await new Promise((r) => setTimeout(r, 200))
      return { inEditor: ir.contains(document.activeElement) }
    })

  await page.evaluate(() => (window as any).__installFocusRestore())

  await page.evaluate(() => (window as any).__hostFind.open())
  expect((await probe()).inEditor, 'find open: no focus theft').toBe(false)

  await page.evaluate(() => (window as any).__hostFind.close())
  expect((await probe()).inEditor, 'find closed: restore resumes').toBe(true)

  await page.evaluate(() => (window as any).__hostFind.open())
  await page.mouse.click(5, 5) // a REAL (trusted) pointerdown — the user is back in the document
  expect((await probe()).inEditor, 'user gesture resumes').toBe(true)
})
