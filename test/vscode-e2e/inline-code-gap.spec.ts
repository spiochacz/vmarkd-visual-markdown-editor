import { docText, stickySelection, wf } from './webview-helpers'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 370 — switching IR → WYSIWYG must not rewrite the document.
//
// Lute's WYSIWYG renderer invents a space in front of inline code that is glued to text
// (`a`b`` → `a `b``). That is a CONTENT change — Lute renders `post-processing<code>` for one and
// `post-processing <code>` for the other — so the mode switch silently altered the user's text, and
// the next keystroke propagated it: measured at 88 characters written for one typed character,
// against 1 character with no mode switch.
//
// This is webview-only behaviour (the whole defect lives in the Lute instance Vditor builds), so
// the real editor is the only place the contract can be checked end to end: switch, type ONE
// character, and read the TextDocument the way any other tab would.
const SRC = path.join(__dirname, 'fixtures', 'inline-code-gap.md')

async function open(
  evaluateInVSCode: (fn: unknown, args: [string]) => Promise<unknown>,
  file: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [file] as [string],
  )
}

/** Switch to WYSIWYG through the edit-mode toolbar panel — the user's own path. */
async function switchToWysiwyg(frame: ReturnType<typeof wf>) {
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
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
}

/**
 * Put the caret at the end of the TYPE-HERE paragraph and type one character. The page-level click
 * first: `focus()` below is DOM-level INSIDE the iframe while `workbox.keyboard` dispatches to the
 * top Electron window, and without it the keystroke is silently dropped (see doc-sync.spec.ts).
 */
async function typeOneChar(
  frame: ReturnType<typeof wf>,
  workbox: import('@playwright/test').Page,
) {
  await frame
    .locator('.vditor-wysiwyg')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-wysiwyg p')].find((x) =>
        x.textContent?.includes('TYPE-HERE'),
      ) as HTMLElement | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('TYPE-HERE anchor not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )
  await workbox.keyboard.type('Z', { delay: 40 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))
}

test('IR → WYSIWYG + one keystroke leaves the rest of the document byte-identical', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), 'vmarkd-inline-code-gap.md')
  const original = readFileSync(SRC, 'utf8')
  writeFileSync(tmp, original)
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  await switchToWysiwyg(frame)

  // Task 419 — poll instead of trusting switchToWysiwyg's/typeOneChar's internal fixed settles
  // (this file shares the clipboard/cut family's fixed-settle idiom — task 419's scope explicitly
  // covers it. One sibling test here needed 2 retries once, the worst-observed instance of this
  // flake). The switch alone must not dirty the document (it never did — the damage lands on the
  // edit).
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'switch alone is inert',
    })
    .toBe(original)

  await typeOneChar(frame, workbox)
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'one keystroke reaches the file',
    })
    .toContain('TYPE-HERE anchor paragraph.Z')
  const after = await docText(evaluateInVSCode, tmp)

  // eslint-disable-next-line no-console
  console.log(`[inline-code-gap] delta=${after.length - original.length} chars`)
  // The defect, stated directly: the invented space must not be in the file.
  expect(
    after,
    'glued inline code must stay glued (this is what the bug rewrote)',
  ).toContain('SVG post-processing`currentColor`')
  expect(after).toContain('text`glued`')
  // The control that proves we did not over-correct: a space the SOURCE has stays.
  expect(after, 'a genuine space before inline code survives').toContain(
    'a genuine `spaced` one',
  )
  // …and the net effect on the file is the one character that was typed, not a reflowed document.
  expect(after.length - original.length, 'one keystroke writes one char').toBe(
    1,
  )
  expect(after).toContain('TYPE-HERE anchor paragraph.Z')
  rmSync(tmp, { force: true })
})

test('the boundary stays editable: typing a space there, then removing it', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // The repair puts a ZWSP where Lute had a space, and that character sits exactly where Vditor
  // resolves the caret between text and inline code. wiki-serialize.ts documents what goes wrong
  // when a marker at that boundary is mishandled ("press space → caret jumps to line start"), so
  // drive the boundary by hand: the caret must stay put and both edits must reach the file.
  const tmp = path.join(tmpdir(), 'vmarkd-inline-code-gap-caret.md')
  writeFileSync(tmp, readFileSync(SRC, 'utf8'))
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  await switchToWysiwyg(frame)

  // Caret immediately AFTER "text", i.e. right on the repaired separator.
  await frame
    .locator('.vditor-wysiwyg')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-wysiwyg p')].find((x) =>
        x.textContent?.includes('glued'),
      ) as HTMLElement | undefined
      const t = [...(p?.childNodes ?? [])].find(
        (n) => n.nodeType === 3 && (n.textContent ?? '').includes('text'),
      ) as Text | undefined
      if (!t) throw new Error('boundary text node not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').indexOf('text') + 'text'.length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )
  await workbox.keyboard.press('Space')
  // Task 419 — this is one of the two named repros (needed 2 retries once, the worst-observed
  // instance of the flake this task fixes). Poll instead of a fixed settle(2000).
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'a space typed at the boundary reaches the file',
    })
    .toContain('text `glued`')
  // The caret must still be at the boundary — a jump to line start would put the backspace
  // somewhere else entirely, so this doubles as the caret assertion.
  await workbox.keyboard.press('Backspace')
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'backspace across the boundary takes it back out',
    })
    .toContain('text`glued`')
  rmSync(tmp, { force: true })
})

test('typing next to glued inline code keeps it glued (the spin path, every keystroke)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  const tmp = path.join(tmpdir(), 'vmarkd-inline-code-gap-spin.md')
  const original = readFileSync(SRC, 'utf8')
  writeFileSync(tmp, original)
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  await switchToWysiwyg(frame)

  // Type INSIDE the paragraph that holds the glued span, so Vditor re-spins that very block
  // (SpinVditorDOM re-inserts the space on every edit — a one-shot repair would not survive this).
  await frame
    .locator('.vditor-wysiwyg')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const p = [...document.querySelectorAll('.vditor-wysiwyg p')].find((x) =>
        x.textContent?.includes('glued'),
      ) as HTMLElement | undefined
      const t = p?.lastChild as Text | null
      if (!t) throw new Error('glued paragraph not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      p?.focus()
    },
    null,
  )
  await workbox.keyboard.type('QQQ', { delay: 60 })
  // Task 419 — this fixed settle was already bumped once (1500ms → 4500ms) chasing an "observed
  // flake" instead of fixing the actual bet-on-machine-speed cause: three keystrokes restart the
  // edit→host debounce each time, so a fixed delay has to out-guess a moving target. Poll on all
  // three conditions at once instead — the real fix, not a bigger number. Named object, not a bare
  // boolean: a genuine timeout then prints WHICH condition never landed.
  await expect
    .poll(
      async () => {
        const t = await docText(evaluateInVSCode, tmp)
        return {
          typedTextLanded: t.includes('QQQ'),
          stillGlued: t.includes('text`glued`'),
          genuineSpaceSurvived: t.includes('a genuine `spaced` one'),
        }
      },
      {
        message:
          'typed text landed, glued span stayed glued, genuine space survived',
      },
    )
    .toEqual({
      typedTextLanded: true,
      stillGlued: true,
      genuineSpaceSurvived: true,
    })

  const after = await docText(evaluateInVSCode, tmp)
  expect(after, 'the typed text landed').toContain('QQQ')
  expect(after, 'still glued after re-spinning the edited block').toContain(
    'text`glued`',
  )
  expect(after, 'the genuine space is still there').toContain(
    'a genuine `spaced` one',
  )
  rmSync(tmp, { force: true })
})

test('editing a table cell in IR keeps the space before its inline marker (task 60)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // The mirror-image defect, in the DEFAULT mode: `Md2VditorIRDOM` DELETES the whitespace in front
  // of a cell's first inline element, and `SpinVditorIRDOM` re-deletes it on every keystroke. The
  // cell-level write-back used to contain it for cells the user didn't touch; the cell being TYPED
  // in was the accepted residual gap. This drives exactly that gap.
  const tmp = path.join(tmpdir(), 'vmarkd-cell-gap.md')
  const original = readFileSync(SRC, 'utf8')
  writeFileSync(tmp, original)
  await open(evaluateInVSCode, tmp)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // The space must already be on screen — the parse is where it used to die.
  expect(
    await frame
      .locator('.vditor-ir td', { hasText: 'CELL-EDIT' })
      .first()
      .innerText(),
    'the cell renders with its space',
  ).toContain('CELL-EDIT see ')

  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await stickySelection(
    frame,
    () => {
      const td = [...document.querySelectorAll('.vditor-ir td')].find((x) =>
        x.textContent?.includes('CELL-EDIT'),
      ) as HTMLElement | undefined
      const t = td?.lastChild as Text | null
      if (!t) throw new Error('CELL-EDIT cell not found')
      const r = document.createRange()
      r.setStart(t, (t.textContent ?? '').length)
      r.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      td?.focus()
    },
    null,
  )
  await workbox.keyboard.type('!', { delay: 40 })
  // Task 419 — poll instead of a fixed settle(2500).
  await expect
    .poll(() => docText(evaluateInVSCode, tmp), {
      message: 'the edit landed in the cell',
    })
    .toContain('CELL-EDIT')

  const after = await docText(evaluateInVSCode, tmp)
  expect(after, 'the edit landed in the cell').toContain('CELL-EDIT')
  expect(after, 'the space before ** survives being typed in').toContain(
    'see **notes**',
  )
  expect(after, 'the other rows still hold their own content').toContain(
    'SVG post-processing`currentColor`',
  )
  rmSync(tmp, { force: true })
})
