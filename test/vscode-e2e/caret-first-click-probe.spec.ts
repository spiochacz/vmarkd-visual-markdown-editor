import { type EvaluateInVSCode, settle, wf } from './webview-helpers'
// PROBE (investigation, no task file — see AGENTS.md convention for probes like
// caret-on-open-probe.spec.ts) — measures whether a REAL first click into the editor drops the
// caret/selection in the real VS Code webview ("click once, no caret; click again, caret sticks"),
// and if it does, captures the exact ORDER of selectionchange/focus/blur events around the click so
// the culprit can be identified. Pure measurement: no fix lives here, nothing is asserted pass/fail
// — the console output IS the deliverable.
//
// Ground rule (from the investigation brief, and see caret-on-open-probe.spec.ts before it):
// document.hasFocus() reads FALSE for seconds after a freshly opened editor in this xvfb/Electron
// harness, so a synthetic `window.dispatchEvent(new Event('focus'))` is not evidence about the real
// OS focus handover. A real `locator.click()`, however, IS a real user gesture in this harness and
// DOES exercise the real focus path — this probe therefore uses only real clicks, never a synthetic
// focus event, so a negative result here is genuine evidence, not a harness gap.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

async function openFixture(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
) {
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
    [fixture] as [string],
  )
  const frame = wf(workbox)
  // Wait for the editable IR surface to exist — do NOT settle here: the timeline must be
  // installed as early as possible, before finish-init/placeInitialCaret have necessarily run.
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

// Installed inside the webview, BEFORE any click. Appends every selectionchange / focus / blur /
// focusin / focusout to a page-global timeline (with timestamp, document.hasFocus(),
// document.activeElement, and the live selection's range), and exposes a Node-callable
// `__probeSample(label)` for explicit labelled readings between events.
async function installTimeline(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as { __probeLog: unknown[] }
    w.__probeLog = []
    const editorOf = () =>
      (
        window as unknown as {
          vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
        }
      ).vditor?.vditor?.ir?.element
    const snapshot = (type: string, extra?: Record<string, unknown>) => {
      const sel = window.getSelection()
      const active = document.activeElement
      const editor = editorOf()
      let range: unknown = null
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0)
        range = {
          // Task 439 taught us that a Range can be perfectly placed and still be INVISIBLE: in an
          // empty container its client rect has zero height, and a caret can only be painted where
          // the rect has height. So measure the height here too — "the caret disappeared" is a paint
          // question, and every earlier version of this probe only asked a DOM question.
          caretHeight: Math.round(r.getBoundingClientRect().height),
          startContainer: r.startContainer.nodeName,
          startOffset: r.startOffset,
          collapsed: r.collapsed,
          insideEditor: !!editor?.contains(r.startContainer),
        }
      }
      const cls = (active as HTMLElement | null)?.className
      w.__probeLog.push({
        t: Math.round(performance.now()),
        type,
        hasFocus: document.hasFocus(),
        activeElement: active
          ? active.tagName +
            (cls ? `.${String(cls).trim().replace(/\s+/g, '.')}` : '')
          : null,
        rangeCount: sel ? sel.rangeCount : -1,
        range,
        ...extra,
      })
    }
    document.addEventListener('selectionchange', () =>
      snapshot('selectionchange'),
    )
    window.addEventListener('focus', () => snapshot('window:focus'))
    window.addEventListener('blur', () => snapshot('window:blur'))
    document.addEventListener('focusin', (e) =>
      snapshot('document:focusin', {
        target: (e.target as Element | null)?.tagName,
      }),
    )
    document.addEventListener('focusout', (e) =>
      snapshot('document:focusout', {
        target: (e.target as Element | null)?.tagName,
      }),
    )
    ;(w as unknown as { __probeSample: (l: string) => void }).__probeSample = (
      l: string,
    ) => snapshot(`sample:${l}`)
    snapshot('sample:instrumented')
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

// Real click + immediate/100ms/500ms/2000ms readings, all labelled `${label}-*` in the timeline.
async function clickAndSample(
  _workbox: import('@playwright/test').Page,
  frame: ReturnType<typeof wf>,
  label: string,
) {
  await sample(frame, `${label}-before-click`)
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await sample(frame, `${label}-t0`) // immediately, no settle
  await settle(frame, 100)
  await sample(frame, `${label}-t100`)
  await settle(frame, 400) // total ~500ms since click
  await sample(frame, `${label}-t500`)
  await settle(frame, 1500) // total ~2000ms since click
  await sample(frame, `${label}-t2000`)
}

function reading(log: unknown[], label: string) {
  return (log as { type: string }[]).find((e) => e.type === `sample:${label}`)
}

function logReadings(fixtureLabel: string, log: unknown[]) {
  const labels = [
    'instrumented',
    'after-init-settle',
    'click1-before-click',
    'click1-t0',
    'click1-t100',
    'click1-t500',
    'click1-t2000',
    'click2-before-click',
    'click2-t0',
    'click2-t100',
    'click2-t500',
    'click2-t2000',
  ]
  // eslint-disable-next-line no-console
  console.log(`[click-probe] ${fixtureLabel} READINGS:`)
  for (const l of labels) {
    const e = reading(log, l)
    // eslint-disable-next-line no-console
    console.log(`[click-probe]   ${l}: ${e ? JSON.stringify(e) : 'MISSING'}`)
  }
}

function logTimeline(fixtureLabel: string, log: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(
    `[click-probe] ${fixtureLabel} FULL EVENT LOG (${log.length} entries):`,
  )
  for (const e of log) {
    // eslint-disable-next-line no-console
    console.log(`[click-probe]   ${JSON.stringify(e)}`)
  }
}

async function probeFirstClick(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
  fixtureLabel: string,
) {
  const frame = await openFixture(workbox, evaluateInVSCode, fixture)
  await installTimeline(frame)
  // Let finish-init (placeInitialCaret etc.) settle, same beat as caret-on-open.spec.ts.
  await settle(frame, 500)
  await sample(frame, 'after-init-settle')

  await clickAndSample(workbox, frame, 'click1')
  await clickAndSample(workbox, frame, 'click2')

  const log = await dumpLog(frame)
  logReadings(fixtureLabel, log)
  logTimeline(fixtureLabel, log)
}

test('probe: first-click caret drop, empty document @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeFirstClick(workbox, evaluateInVSCode, EMPTY_FIXTURE, 'empty')
})

test('probe: first-click caret drop, document with text @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeFirstClick(workbox, evaluateInVSCode, TEXT_FIXTURE, 'with-text')
})
