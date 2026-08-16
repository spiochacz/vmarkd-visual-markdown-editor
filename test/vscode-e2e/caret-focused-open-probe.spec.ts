import { type EvaluateInVSCode, settle } from './webview-helpers'
// PROBE (investigation follow-up, no task file) — every prior probe (caret-on-open-probe.spec.ts,
// caret-first-click-probe.spec.ts) opened its fixture as the harness's FIRST action, when the VS
// Code window had no real OS focus (`document.hasFocus() === false`). placeInitialCaret
// (media-src/src/initial-caret.ts) is gated on `document.hasFocus()` before it calls
// `editor.focus()` — so every prior measurement took the "don't steal focus" branch, and the
// user's ACTUAL condition (they always have the window focused when they open a file) was never
// exercised. The user has since reported the empty-document symptom precisely: "it flashed and
// disappeared" — no click involved — meaning the caret WAS placed and WAS painted, then something
// took it away. That is a different bug from "never placed", and this probe is built to catch it:
// grant the window real OS focus FIRST (a real click on an unrelated document), THEN open the
// empty fixture, so placeInitialCaret takes its focus-stealing branch for the first time under
// measurement, and watch what happens to the Range/focus over the following few seconds via an
// interleaved event + DOM-mutation timeline.
//
// Pure measurement: no fix lives here. Any temporary neutralising edit would be restored and
// declared, but none was needed for this file.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

function wf(workbox: import('@playwright/test').Page) {
  // `.last()` — when a donor tab is left open, TWO vmarkd webview iframes coexist in the DOM and a
  // bare `iframe.webview` locator is ambiguous (Playwright strict mode throws). VS Code appends
  // the most-recently-created (currently active) editor's iframe last.
  return workbox
    .frameLocator('iframe.webview')
    .last()
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

async function openViaCommand(
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
  closeFirst: boolean,
) {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri, close] = args as [string, boolean]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      if (close) {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [fixture, closeFirst] as unknown as [string],
  )
}

// Grant the VS Code window real OS focus via a genuine click on an unrelated document (mirrors
// what a real user has already done before they open the file under test), then return once the
// click's focus handover is measured stable. Uses the with-text fixture as the "focus donor".
async function focusWindowViaClick(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
) {
  await openViaCommand(evaluateInVSCode, TEXT_FIXTURE, true)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await settle(frame, 300)
  const hasFocus = await frame
    .locator('body')
    .evaluate(() => document.hasFocus())
  return hasFocus as boolean
}

// Installed inside the webview as early as possible after the target fixture's editable appears.
// Combines the focus/selection event timeline from caret-first-click-probe.spec.ts with a
// MutationObserver on document.body (subtree) — every mutation is tagged with whether its target
// sits inside the IR editable, and the current focus/selection state at that instant, so the
// event log and the mutation log read as ONE interleaved timeline ordered by timestamp.
async function installFullTimeline(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as { __probeLog: unknown[] }
    w.__probeLog = []
    const editorOf = () =>
      (
        window as unknown as {
          vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
        }
      ).vditor?.vditor?.ir?.element
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page probe reading caret offset/collapsed/node-kind state across the selection-present/absent branches; pre-existing (task 469 baseline)
    const state = () => {
      const sel = window.getSelection()
      const active = document.activeElement
      const editor = editorOf()
      let range: unknown = null
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0)
        range = {
          startContainer: r.startContainer.nodeName,
          startOffset: r.startOffset,
          collapsed: r.collapsed,
          insideEditor: !!editor?.contains(r.startContainer),
        }
      }
      const cls = (active as HTMLElement | null)?.className
      return {
        hasFocus: document.hasFocus(),
        activeElement: active
          ? active.tagName +
            (cls ? `.${String(cls).trim().replace(/\s+/g, '.')}` : '')
          : null,
        rangeCount: sel ? sel.rangeCount : -1,
        range,
        editorChildCount: editor ? editor.childElementCount : -1,
      }
    }
    const push = (type: string, extra?: Record<string, unknown>) => {
      w.__probeLog.push({
        t: Math.round(performance.now()),
        type,
        ...state(),
        ...extra,
      })
    }
    document.addEventListener('selectionchange', () => push('selectionchange'))
    window.addEventListener('focus', () => push('window:focus'))
    window.addEventListener('blur', () => push('window:blur'))
    document.addEventListener('focusin', (e) =>
      push('document:focusin', {
        target: (e.target as Element | null)?.tagName,
      }),
    )
    document.addEventListener('focusout', (e) =>
      push('document:focusout', {
        target: (e.target as Element | null)?.tagName,
      }),
    )
    const describe = (n: Node) =>
      n.nodeName +
      (n.nodeType === Node.TEXT_NODE
        ? `("${(n.textContent ?? '').slice(0, 20)}")`
        : (n as HTMLElement).id
          ? `#${(n as HTMLElement).id}`
          : (n as HTMLElement).getAttribute?.('data-type')
            ? `[data-type=${(n as HTMLElement).getAttribute('data-type')}]`
            : '')
    const obs = new MutationObserver((mutations) => {
      const editor = editorOf()
      for (const m of mutations) {
        const insideEditor = !!(
          editor &&
          (editor === m.target || editor.contains(m.target))
        )
        push(`mutation:${m.type}`, {
          insideEditor,
          targetNodeName: (m.target as Element).nodeName,
          added: Array.from(m.addedNodes).map(describe),
          removed: Array.from(m.removedNodes).map(describe),
        })
      }
    })
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: false,
    })
    ;(w as unknown as { __probeObs: MutationObserver }).__probeObs = obs
    ;(w as unknown as { __probeSample: (l: string) => void }).__probeSample = (
      l: string,
    ) => push(`sample:${l}`)
    push('sample:instrumented')
  })
}

async function sample(frame: ReturnType<typeof wf>, label: string) {
  await frame.locator('body').evaluate((_el, l) => {
    ;(
      window as unknown as { __probeSample: (l: string) => void }
    ).__probeSample(l as string)
  }, label)
}

async function dumpLog(frame: ReturnType<typeof wf>): Promise<unknown[]> {
  return frame
    .locator('body')
    .evaluate(
      () => (window as unknown as { __probeLog: unknown[] }).__probeLog ?? [],
    )
}

function logTimeline(label: string, log: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] ${label} INTERLEAVED TIMELINE (${log.length} entries):`,
  )
  for (const e of log) {
    // eslint-disable-next-line no-console
    console.log(`[focused-open-probe]   ${JSON.stringify(e)}`)
  }
}

test('probe: empty document opens with window ALREADY OS-focused — does the caret survive? @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const donorHasFocus = await focusWindowViaClick(workbox, evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] donor click established hasFocus=${donorHasFocus}`,
  )

  // Re-open the EMPTY fixture. Per the investigation brief: close all editors, then open it — the
  // window itself keeps real OS focus across that (nothing outside the webview took it), so this
  // exercises placeInitialCaret's document.hasFocus()===true branch for the first time.
  await evaluateInVSCode(
    async (vscode) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await openViaCommand(evaluateInVSCode, EMPTY_FIXTURE, false)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  // Install the timeline as early as physically possible — before any deliberate settle.
  await installFullTimeline(frame)

  await sample(frame, 't0')
  await settle(frame, 100)
  await sample(frame, 't100')
  await settle(frame, 200) // total 300
  await sample(frame, 't300')
  await settle(frame, 200) // total 500
  await sample(frame, 't500')
  await settle(frame, 500) // total 1000
  await sample(frame, 't1000')
  await settle(frame, 1000) // total 2000
  await sample(frame, 't2000')
  await settle(frame, 2000) // total 4000
  await sample(frame, 't4000')

  const log = await dumpLog(frame)
  logTimeline('empty-doc-preFocused-open', log)
})

test('probe: empty document opens with window ALREADY OS-focused, WITHOUT closeAllEditors (donor tab stays open) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const donorHasFocus = await focusWindowViaClick(workbox, evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] donor click established hasFocus=${donorHasFocus}`,
  )

  // NO closeAllEditors here — the prior test showed closeAllEditors itself drops OS focus (every
  // sample read hasFocus=false for the full 4s). Open the empty fixture as a SECOND tab instead,
  // leaving the donor tab in place, matching "the user already has the window focused, then opens
  // another file" without an intervening close-everything step.
  await openViaCommand(evaluateInVSCode, EMPTY_FIXTURE, false)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  await installFullTimeline(frame)

  await sample(frame, 't0')
  await settle(frame, 100)
  await sample(frame, 't100')
  await settle(frame, 200) // total 300
  await sample(frame, 't300')
  await settle(frame, 200) // total 500
  await sample(frame, 't500')
  await settle(frame, 500) // total 1000
  await sample(frame, 't1000')
  await settle(frame, 1000) // total 2000
  await sample(frame, 't2000')
  await settle(frame, 2000) // total 4000
  await sample(frame, 't4000')

  const log = await dumpLog(frame)
  logTimeline('empty-doc-preFocused-open-NO-close', log)
})

test('probe: empty document opens, then host-side focusActiveEditorGroup command is issued (no click at all) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const donorHasFocus = await focusWindowViaClick(workbox, evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] donor click established hasFocus=${donorHasFocus}`,
  )

  await openViaCommand(evaluateInVSCode, EMPTY_FIXTURE, false)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await installFullTimeline(frame)
  await sample(frame, 't0-before-focus-command')

  // Try to grant focus WITHOUT any click at all — a host-side command, which is what VS Code's
  // own "open this editor" flow is supposed to do for the user in real life.
  await evaluateInVSCode(
    async (vscode) => {
      await vscode.commands.executeCommand(
        'workbench.action.focusActiveEditorGroup',
      )
    },
    [] as unknown as [string],
  )
  await settle(frame, 100)
  await sample(frame, 't100-after-focus-command')
  await settle(frame, 400) // total 500
  await sample(frame, 't500-after-focus-command')
  await settle(frame, 1500) // total 2000
  await sample(frame, 't2000-after-focus-command')

  const log = await dumpLog(frame)
  logTimeline('empty-doc-hostFocusCommand-noClick', log)
})

// Reads the TEMPORARY diagnostic log initial-caret.ts's placeInitialCaret writes to
// window.__pic445Log (synchronous sequence inside placeInitialCaret itself, plus a
// MutationObserver installed from the moment the Range is placed) — see initial-caret.ts,
// pic445Log(). Returns [] if the instrumentation isn't present (already reverted).
async function dumpPic445Log(frame: ReturnType<typeof wf>): Promise<unknown[]> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (window as unknown as { __pic445Log?: unknown[] }).__pic445Log ?? [],
    )
}

function logPic445(label: string, log: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(
    `[pic445] ${label} placeInitialCaret internal sequence (${log.length} entries):`,
  )
  for (const e of log) {
    // eslint-disable-next-line no-console
    console.log(`[pic445]   ${JSON.stringify(e)}`)
  }
}

test('probe: empty doc opens with focus command issued IMMEDIATELY after openWith (same host call) — catches placeInitialCaret own focus() branch via pic445Log @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const donorHasFocus = await focusWindowViaClick(workbox, evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] donor click established hasFocus=${donorHasFocus}`,
  )

  // Single host round trip: open the empty fixture, THEN immediately ask VS Code to focus the
  // active editor group — no separate evaluateInVSCode call in between, to give the focus command
  // the best chance of reaching the webview before (or right as) its own init/finish-init runs.
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
      await vscode.commands.executeCommand(
        'workbench.action.focusActiveEditorGroup',
      )
    },
    [EMPTY_FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  // Dump the INTERNAL placeInitialCaret sequence first — this ran before we could attach anything
  // externally, so it is the only view of what happened at the exact moment of placement.
  const picLog0 = await dumpPic445Log(frame)
  logPic445('immediately after .vditor-ir appears', picLog0)

  await installFullTimeline(frame)
  await sample(frame, 't0')
  await settle(frame, 100)
  await sample(frame, 't100')
  await settle(frame, 400) // total 500
  await sample(frame, 't500')
  await settle(frame, 1500) // total 2000
  await sample(frame, 't2000')
  await settle(frame, 2000) // total 4000
  await sample(frame, 't4000')

  const log = await dumpLog(frame)
  logTimeline('empty-doc-immediateFocusCommand', log)

  // Final pic445Log dump — the MutationObserver installed inside placeInitialCaret keeps recording
  // for as long as the page lives, so this shows anything that happened over the whole 4s window.
  const picLog1 = await dumpPic445Log(frame)
  logPic445('after 4s of settling', picLog1)
})

test('probe: first-click behaviour when the window is ALREADY OS-focused (text fixture) @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  const donorHasFocus = await focusWindowViaClick(workbox, evaluateInVSCode)
  // eslint-disable-next-line no-console
  console.log(
    `[focused-open-probe] donor click established hasFocus=${donorHasFocus}`,
  )

  await evaluateInVSCode(
    async (vscode) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    },
    [] as unknown as [string],
  )
  await openViaCommand(evaluateInVSCode, TEXT_FIXTURE, false)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await installFullTimeline(frame)
  await sample(frame, 'after-open')

  // First real click — same gesture as caret-first-click-probe.spec.ts, but this time the window
  // already had OS focus BEFORE this webview even opened.
  await sample(frame, 'click1-before-click')
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await sample(frame, 'click1-t0')
  await settle(frame, 100)
  await sample(frame, 'click1-t100')
  await settle(frame, 400) // total 500
  await sample(frame, 'click1-t500')
  await settle(frame, 1500) // total 2000
  await sample(frame, 'click1-t2000')

  await sample(frame, 'click2-before-click')
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await sample(frame, 'click2-t0')
  await settle(frame, 100)
  await sample(frame, 'click2-t100')
  await settle(frame, 400) // total 500
  await sample(frame, 'click2-t500')

  const log = await dumpLog(frame)
  logTimeline('text-doc-preFocused-clicks', log)
})
