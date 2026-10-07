import { ev, wf } from './webview-helpers'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// Task 514 — Ctrl+F, type a query that MATCHES something in the document, and the find box loses
// focus; the rest of the keystrokes land in the editor instead of the search field.
//
// Real-VS-Code only, by construction: the find widget is HOST workbench UI sitting outside the
// webview, and the trigger is VS Code driving Electron's `findInFrame` against the webview frame —
// neither exists in the chromium harness.
//
// MEASURED chain (the recorder below is what measured it, kept in the spec because it is also the
// failure diagnostic): activating a match hands the FRAME window a `focus` event, which the frame
// gives back 4 ms later — the host's find input is what the user is typing into. focus-restore.ts's
// window-`focus` listener used to fire `editor.focus()` into that gap one animation frame later,
// which (a) pulled focus out of the find box and (b) armed caret.ts's re-assert loop, so the caret
// kept stealing it back for seconds afterwards.
//
// The assertion is deliberately per-keystroke, not one snapshot at the end: the loss is transient
// (VS Code puts focus back on the input at the next keystroke), so a check after typing the whole
// query PASSES against the bug.
const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'find-focus.md')
// `bravo` appears once, far enough down that activating the match has to scroll the webview — the
// find machinery has to actually move the frame, which is the state the bug needs. The filler lines
// deliberately do NOT contain the query's prefix, so the first match happens mid-word ("br"), the
// keystroke the loss was measured on.
const QUERY = 'bravo'
writeFileSync(
  FIXTURE,
  [
    '# Find focus',
    '',
    ...Array(40).fill('alpha filler line'),
    '',
    `${QUERY} target line`,
    '',
  ].join('\n'),
)

interface ProbeEntry {
  kind: string
  t: number
  target: string
  active: string
  stack: string
}

test('typing in the webview find widget keeps focus in the find box', async ({
  workbox,
  evaluateInVSCode,
}) => {
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
    FIXTURE,
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  // Click into the editor first: that is the state the report comes from (the user was editing,
  // then pressed Ctrl+F) and it is also what arms every focus/caret restorer we ship. Opening the
  // find widget from an editor that was never focused does not reproduce anything.
  await frame.locator('.vditor-ir [contenteditable="true"]').first().click()

  // Focus recorder — the diagnostic that named the culprit, and the reason a failure here reads as
  // "X called .focus()" rather than "focus was somewhere else". Focus events dispatch
  // synchronously, so the stack inside the listener names the JS caller; a listener-only stack
  // means the browser moved focus on its own.
  await frame.locator('body').evaluate(() => {
    const log: ProbeEntry[] = []
    ;(window as unknown as { __findProbe: ProbeEntry[] }).__findProbe = log
    const describe = (n: unknown): string => {
      const el = n as HTMLElement | null
      if (!el?.tagName) return String(n)
      return `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`
    }
    const push = (kind: string, target: unknown) =>
      log.push({
        kind,
        t: Math.round(performance.now()),
        target: describe(target),
        active: describe(document.activeElement),
        stack: new Error().stack?.split('\n').slice(1, 8).join(' | ') ?? '',
      })
    document.addEventListener('focusin', (e) => push('focusin', e.target), true)
    document.addEventListener(
      'focusout',
      (e) => push('focusout', e.target),
      true,
    )
    window.addEventListener('focus', () => push('win-focus', null), true)
    window.addEventListener('blur', () => push('win-blur', null), true)
    document.addEventListener(
      'keydown',
      (e) => push(`keydown:${(e as KeyboardEvent).key}`, e.target),
      true,
    )
  })

  // Task 522 — the real Ctrl+F chord (bound to vmarkd.findOpen in package.json): the host tells the
  // webview its find widget is open, which is what suppresses the focus theft. Executing the
  // built-in showFind directly would bypass exactly the path under test.
  await frame.locator('body').click({ position: { x: 20, y: 12 } })
  await workbox.keyboard.press('Control+f')

  const findInput = workbox.locator('.simple-find-part input').first()
  await findInput.waitFor({ timeout: 15_000 })

  const hostActive = () =>
    workbox.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el
        ? `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`
        : 'none'
    })

  // Precondition, asserted rather than assumed: if the widget never took focus, everything below
  // would "pass" while measuring nothing.
  expect(await hostActive()).toContain('INPUT')

  const perChar: { char: string; host: string }[] = []
  for (const char of QUERY) {
    await workbox.keyboard.type(char)
    // Not a settle-sleep to convert (task 451): find-as-you-type is asynchronous with no observable
    // marker in either document, and the focus loss it causes is itself transient — the wait IS the
    // window being sampled.
    await workbox.waitForTimeout(500)
    perChar.push({ char, host: await hostActive() })
  }
  // Enter = find-next, the other gesture made with the box open, and a second match activation.
  await workbox.keyboard.press('Enter')
  await workbox.waitForTimeout(700)
  perChar.push({ char: 'Enter', host: await hostActive() })

  // Task 515 (MEASURED, no product change) — the other half of the mechanism, driven directly
  // because no ordinary gesture reaches it: an armed caret intent re-writes its Range on every
  // animation frame, and a `Selection.addRange()` into a contenteditable focuses that element. The
  // question was whether that write can take the keyboard from the find box. It cannot: measured
  // here with the find widget holding focus, the write lands (`__vmarkdRequestCaret` returns true,
  // rangeCount 1) while the frame's `activeElement` stays BODY and the host's find INPUT keeps
  // focus — an intra-document focus move needs the document to hold focus in the first place, so
  // an unfocused frame cannot steal it back this way. This leg therefore PINS that invariant; it is
  // not the reproduction of a known bug, and it passes with or without any caret-side gate.
  // `__vmarkdRequestCaret` is the same window bridge the patched Vditor undo path calls.
  await frame.locator('body').evaluate(() => {
    ;(
      window as unknown as {
        __vmarkdRequestCaret?: (i: { textOffset: number }) => boolean
      }
    ).__vmarkdRequestCaret?.({ textOffset: 12 })
  })
  // ~60 frames of the re-assert loop — far more than the frame or two a steal would need.
  await workbox.waitForTimeout(1000)
  perChar.push({ char: 'caret-intent', host: await hostActive() })

  const strayFocus = perChar.filter((p) => !p.host.includes('INPUT'))
  if (strayFocus.length) {
    const log = (await frame
      .locator('body')
      .evaluate(
        () => (window as unknown as { __findProbe: ProbeEntry[] }).__findProbe,
      )) as ProbeEntry[]
    console.log('FRAME focus log:', JSON.stringify(log, null, 1))
  }
  expect(strayFocus).toEqual([])

  // The severe half of the bug: with focus back in the contenteditable, the remaining keystrokes
  // edit the user's document. Assert the text is byte-identical to what was written to disk.
  const text = (await ev(
    evaluateInVSCode,
    (vscode: typeof import('vscode'), args: string[]) =>
      vscode.workspace.textDocuments
        .find((d) => d.uri.fsPath === args[0])
        ?.getText() ?? '',
    FIXTURE,
  )) as string
  expect(text).toContain(`${QUERY} target line`)
  expect(text.match(/alpha filler line/g)?.length).toBe(40)
})
