import {
  type EvaluateInVSCode,
  docText,
  ev,
  settle,
  stickySelection,
  wf,
} from './webview-helpers'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 389 — the caret must survive leaving the vMarkd tab and coming back.
//
// Measured cause, not assumed: the panel is created with `retainContextWhenHidden`, so the DOM
// selection survives the round trip intact — `rangeCount` stays 1 and the caret offset is unchanged.
// What VS Code does NOT restore is focus: `document.activeElement` comes back as BODY, and a Range
// in an unfocused document paints no caret and receives no keystrokes. That is the whole bug.
//
// Which is why the assertion is in two halves, and the second is the load-bearing one: a spec that
// only checked the selection offset would have PASSED against the bug, because the offset was never
// what broke. Typing after the return is what separates a real restore from a cosmetic one.
const SRC = path.join(__dirname, 'fixtures', 'torture.md')
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })

/**
 * What the webview thinks the caret is: where focus sits, and the caret's text offset.
 *
 * The editable surface is resolved the way the product resolves it — `vditor.vditor[mode].element`
 * — and not by a CSS selector, because the three modes do not agree on shape: in sv the mode element
 * IS `.vditor-sv` (a contenteditable `<pre>`), while in wysiwyg `.vditor-wysiwyg` is a plain `<div>`
 * wrapping the editable `<pre>`. A `.vditor-sv [contenteditable]` selector silently matches nothing,
 * which reads in the report as "focus did not come back" when nothing of the sort happened.
 */
function caretState(
  frame: ReturnType<typeof wf>,
  mode: 'ir' | 'wysiwyg' | 'sv',
) {
  return frame.locator('body').evaluate((_el, m) => {
    const s = window.getSelection()
    const r = s?.rangeCount ? s.getRangeAt(0) : null
    const v = (
      window as unknown as {
        vditor: { vditor: Record<string, { element?: HTMLElement }> }
      }
    ).vditor?.vditor
    const editor = (v?.[m as string]?.element ?? null) as HTMLElement | null
    let offset: number | null = null
    if (r && editor?.contains(r.startContainer)) {
      const pre = r.cloneRange()
      pre.selectNodeContents(editor)
      pre.setEnd(r.startContainer, r.startOffset)
      offset = pre.toString().length
    }
    const active = document.activeElement
    return {
      // The question the bug is about: is focus inside the editable surface at all?
      focusedInEditor: !!(editor && active && editor.contains(active)),
      offset,
    }
  }, mode)
}

/**
 * Collapsed caret just after `anchor`, set on the text node itself.
 *
 * Deliberately NOT a bare `.click()` on the paragraph: a click lands on the element's centre, which
 * for a soft-wrapped paragraph is not the line the anchor text is on — measured, it put the caret in
 * a different paragraph entirely and the spec then "passed" its offset check while the typed
 * character landed somewhere else. The click into the editor still happens (it is what focuses the
 * webview); only the caret placement is exact.
 */
async function caretAfter(
  frame: ReturnType<typeof wf>,
  anchor: string,
  surface = '.vditor-ir',
) {
  await frame
    .locator(surface)
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    (_el, args) => {
      const [sel, needle] = args as [string, string]
      // Walk the surface's text nodes rather than its paragraphs: sv has no <p> at all (it is one
      // contenteditable <pre> of spans), so a `${surface} p` query would find nothing there.
      const root = document.querySelector(sel) as HTMLElement | null
      if (!root) throw new Error(`surface ${sel} not found`)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(needle)
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n as Text, i + needle.length)
        r.collapse(true)
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(r)
        ;(n.parentElement as HTMLElement | null)?.focus()
        return
      }
      throw new Error(`anchor ${needle} not found in ${sel}`)
    },
    [surface, anchor] as [string, string],
  )
}

let bootCount = 0

async function boot(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  name: string,
) {
  // A unique path per test: VS Code keeps a TextDocument alive per fsPath, so a reused name hands
  // the next test the previous one's in-memory content whatever is written to disk.
  const tmp = path.join(TEMP_DIR, `${process.pid}-${bootCount++}-${name}`)
  const other = path.join(TEMP_DIR, `${process.pid}-${bootCount}-other-389.md`)
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  writeFileSync(
    other,
    '# a plain text editor to switch to\n\nnot markdown-y.\n',
  )
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    tmp,
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  return { tmp, other, frame }
}

/** Leave the vMarkd tab for a plain text editor, then come back to it. */
async function leaveAndReturn(
  evaluateInVSCode: EvaluateInVSCode,
  workbox: import('@playwright/test').Page,
  other: string,
) {
  await ev(
    evaluateInVSCode,
    async (vscode: typeof import('vscode'), args: string[]) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(args[0]),
      )
      await vscode.window.showTextDocument(doc, { preview: false })
    },
    other,
  )
  await workbox.waitForTimeout(1500)
  await ev(evaluateInVSCode, async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.previousEditor')
  })
  await workbox.waitForTimeout(2000)
}

test('the caret survives leaving the vMarkd tab and coming back', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const { tmp, other, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-caret-return.md',
  )

  // Put a caret in a known paragraph, and PROVE it is live by typing there — an assertion about a
  // caret that was never where the test thinks proves nothing (that is exactly how the first draft
  // of this spec passed its offset check while the character landed in another paragraph).
  await caretAfter(frame, 'Anchor line BRAVO')
  await settle(frame, 400)
  await workbox.keyboard.type('α')
  // POLL rather than sleep-then-read: the webview→host edit is debounced, and a fixed wait that is
  // long enough on an idle machine is not long enough on a loaded one. Measured — this test passed
  // with a 1.5 s sleep and failed three times in a row when the box was busy, which reads as a
  // product failure and is not one.
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
    .toContain('Anchor line BRAVOα')

  const before = await caretState(frame, 'ir')
  expect(before.focusedInEditor, 'baseline: the editor has focus').toBe(true)
  expect(
    before.offset,
    'baseline: the caret is inside the editor',
  ).not.toBeNull()

  await leaveAndReturn(evaluateInVSCode, workbox, other)

  const after = await caretState(frame, 'ir')
  // (1) Focus is back on the editable surface — without it there is no caret to blink.
  expect(after.focusedInEditor, 'focus returned to the editor').toBe(true)
  // (2) …at the SAME place. The selection survives the round trip on its own; what must not happen
  // is the restore itself dragging the caret to the top of the document.
  expect(after.offset, 'the caret is where it was left').toBe(before.offset)

  // (3) The one that cannot be faked: a keystroke lands at that caret, in the real TextDocument —
  // right after the baseline character, not merely "somewhere in the document", which a caret
  // dumped at the top of the file would also satisfy.
  await workbox.keyboard.type('Ω')
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
    .toContain('Anchor line BRAVOαΩ')

  rmSync(tmp, { force: true })
  rmSync(other, { force: true })
})

// The restore resolves the editable surface through `activeModeElement`, so it is mode-agnostic by
// construction — but "by construction" is not evidence, and the task asks for all three modes. These
// two hold to the same standard as the IR case: focus, offset, AND a character typed after the
// return landing next to one typed before it. Focus-and-offset alone would be the cosmetic check the
// header of this file argues against.
for (const mode of ['wysiwyg', 'sv'] as const) {
  test(`the caret survives the round trip in ${mode} too`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    const { tmp, other, frame } = await boot(
      evaluateInVSCode,
      workbox,
      `vmarkd-caret-return-${mode}.md`,
    )
    await frame.locator('body').evaluate((_el, target) => {
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
        .querySelector(`button[data-mode="${target}"]`)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, mode)
    const surface = `.vditor-${mode}`
    await frame.locator(surface).first().waitFor({ timeout: 30_000 })
    await settle(frame, 2500)

    // Put the caret on the anchor line of this mode's surface, and prove it is live by typing.
    await caretAfter(frame, 'Anchor line BRAVO', surface)
    await settle(frame, 500)
    await workbox.keyboard.type('α')
    await expect
      .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
      .toContain('Anchor line BRAVOα')

    const before = await caretState(frame, mode)
    expect(before.focusedInEditor, `baseline: ${mode} has focus`).toBe(true)

    await leaveAndReturn(evaluateInVSCode, workbox, other)

    const after = await caretState(frame, mode)
    expect(after.focusedInEditor, `focus returned to the ${mode} editor`).toBe(
      true,
    )
    expect(after.offset, 'the caret is where it was left').toBe(before.offset)

    // The assertion that cannot be satisfied by a cosmetic restore.
    await workbox.keyboard.type('Ω')
    await expect
      .poll(() => docText(evaluateInVSCode, tmp), { timeout: 20_000 })
      .toContain('Anchor line BRAVOαΩ')

    rmSync(tmp, { force: true })
    rmSync(other, { force: true })
  })
}

test('returning does not scroll the document away from where it was left', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // Restoring the caret must not be a licence to scroll to it — the view has to stay put (the same
  // rule the toolbar focus-scroll guard enforces, task 71). Scroll well past the caret, leave,
  // return, and the viewport must be where it was.
  const { tmp, other, frame } = await boot(
    evaluateInVSCode,
    workbox,
    'vmarkd-caret-return-scroll.md',
  )
  await caretAfter(frame, 'Anchor line BRAVO')
  await settle(frame, 400)

  const scroller = frame.locator('.vditor-ir .vditor-reset')
  await scroller.evaluate((el) => {
    el.scrollTop = Math.min(600, el.scrollHeight - el.clientHeight)
  })
  await settle(frame, 400)
  const scrollBefore = await scroller.evaluate((el) => el.scrollTop)

  await leaveAndReturn(evaluateInVSCode, workbox, other)

  const scrollAfter = await scroller.evaluate((el) => el.scrollTop)
  expect(
    Math.abs(scrollAfter - scrollBefore),
    'the viewport stayed where the user left it',
  ).toBeLessThanOrEqual(4)

  rmSync(tmp, { force: true })
  rmSync(other, { force: true })
})
