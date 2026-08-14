import { settle } from './webview-helpers'
// REGRESSION (task 439) — the two things every earlier probe skipped, now asserted:
// NAMING: this file deliberately does NOT end in `-probe.spec.ts`. It began as a probe, but it
// carries real assertions (a caret that can be PAINTED, typing without clicking, and no zero-width
// space leaking into the saved file), so it belongs in the default run, not the `@probe` tier
// (task 449). The two things every earlier probe skipped:
//   1. is the caret actually PAINTED (pixels), not merely present in the DOM, and
//   2. can the user TYPE without clicking first — which is the whole point of the feature.
// Plus: run under the REPORTER'S settings (content theme, full width, heading markers off, a
// light code theme), because every prior measurement used harness defaults and a caret's
// visibility is a CSS question, not a DOM one.
//
// The window is given real OS focus the only way that works headless (a donor click, then the
// host-side focusActiveEditorGroup command — measured in caret-focused-open-probe.spec.ts to be
// the one route that flips document.hasFocus() to true without a click on the editable itself,
// which would place the caret and destroy what we are measuring).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

// The reporter's own settings (see the block below, in the test, for why these specific values).
// GLOBAL and the whole suite shares one worker-scoped VS Code profile, so leaving them behind
// poisons every spec that runs later — `theme.code = 'a11y-light'` leaking from here is what made
// `d2-render-sweep`'s code-highlight case flaky (task 516 triage).
usePinnedSettings(test, {
  'vmarkd.theme.content': 'vscode-dark-2026',
  'vmarkd.theme.code': 'a11y-light',
  'vmarkd.editor.fullWidth': true,
  'vmarkd.editor.headingMarkers': false,
  'vmarkd.diagram.mermaid.layout': 'elk',
})

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .last()
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Everything that decides whether a caret paints: the editable's own box and text metrics, and
// the caret Range's client rect (a collapsed Range reports a zero-WIDTH but non-zero HEIGHT rect
// where a caret would be drawn — height 0 means there is nowhere to draw one).
const MEASURE_PAINT = () => {
  const editor = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  if (!editor) return { error: 'no editor' }
  const cs = getComputedStyle(editor)
  const box = editor.getBoundingClientRect()
  const sel = window.getSelection()
  const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const caretRect = r ? r.getBoundingClientRect() : null
  return {
    hasFocus: document.hasFocus(),
    active: document.activeElement?.tagName ?? null,
    activeIsEditor: !!(
      document.activeElement && editor.contains(document.activeElement)
    ),
    rangeCount: sel?.rangeCount ?? 0,
    children: editor.childElementCount,
    innerHTML: editor.innerHTML.slice(0, 80),
    editorBox: { w: Math.round(box.width), h: Math.round(box.height) },
    editorStyle: {
      lineHeight: cs.lineHeight,
      fontSize: cs.fontSize,
      minHeight: cs.minHeight,
      display: cs.display,
      caretColor: cs.caretColor,
      color: cs.color,
    },
    // The decisive number: a caret can only be drawn where the collapsed Range has height.
    caretRect: caretRect
      ? {
          x: Math.round(caretRect.x),
          y: Math.round(caretRect.y),
          w: Math.round(caretRect.width),
          h: Math.round(caretRect.height),
        }
      : null,
  }
}

test('empty doc under the reporter settings: is the caret paintable, and can you type without clicking?', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

  // ── donor click grants the window real OS focus ──
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [TEXT_FIXTURE] as [string],
  )
  let frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 400)
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await settle(frame, 200)

  // ── open the EMPTY file and hand it focus the way VS Code does for a real user ──
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [EMPTY_FIXTURE] as [string],
  )
  frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Focus AFTER the webview is mounted, as its own host round trip — measured (in
  // caret-focused-open-probe.spec.ts) to be the reliable way to get document.hasFocus() === true
  // here; issuing it in the same call as openWith raced the mount and left the window unfocused.
  await evaluateInVSCode(
    async (vscode) => {
      await vscode.commands.executeCommand(
        'workbench.action.focusActiveEditorGroup',
      )
    },
    [] as unknown as [string],
  )
  await settle(frame, 200)

  for (const ms of [200, 800, 3000]) {
    await settle(frame, ms === 200 ? 200 : 600)
    const m = await frame.locator('body').evaluate(MEASURE_PAINT)
    console.log(`[paint] t≈${ms}ms ${JSON.stringify(m)}`)
  }
  await workbox.screenshot({
    path: 'tmp/caret-empty-before-typing.png',
    fullPage: false,
  })

  // ── THE functional test: type without ever clicking in this document ──
  await workbox.keyboard.type('Zażółć')
  await settle(frame, 500)
  const after = await frame.locator('body').evaluate(() => {
    const v = (window as unknown as { vditor?: { getValue?: () => string } })
      .vditor
    const editor = (
      window as unknown as {
        vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
      }
    ).vditor?.vditor?.ir?.element
    return {
      value: v?.getValue?.() ?? '',
      children: editor?.childElementCount ?? -1,
      innerHTML: editor?.innerHTML.slice(0, 120) ?? '',
    }
  })
  console.log(`[paint] after typing: ${JSON.stringify(after)}`)
  await workbox.screenshot({
    path: 'tmp/caret-empty-after-typing.png',
    fullPage: false,
  })

  expect(
    after.value.trim(),
    'typing without clicking reached the document',
  ).toBe('Zażółć')
  // The seed paragraph must not reach the file: `Zażółć`, not `​Zażółć` with a zero-width space.
  expect(
    after.value.codePointAt(0),
    'no zero-width space leaked into the saved markdown',
  ).not.toBe(0x200b)
})
