import { type EvaluateInVSCode, settle, wf } from './webview-helpers'
// PROBE for task 445 (first click into the editor loses the caret; only the second click makes
// it stick — NOT REPRODUCED after four rounds of probing, see tasks/445-*.md). Every prior probe
// (caret-first-click-probe.spec.ts and friends) settled 1.5-3s after open BEFORE the first click.
// A real user clicks immediately — while runFinishInit (finish-init.ts) is still executing and
// several of its observers mutate the editor DOM synchronously (observeTrailingParagraph,
// observeCallouts' first batch, placeInitialCaret's own Range write). A caret placed by a click
// that lands mid-rebuild could be destroyed by the very next DOM replacement — this angle has
// never been tested. This probe clicks at t ≈ 0 / 50 / 150 / 300 / 600 ms after `.vditor-ir`
// first appears (one click per run, not a burst) and records, for 3s after, the selection/focus
// state AND every DOM mutation of the editor with a timestamp, interleaved — so if the caret
// dies, the exact mutation that killed it is visible. Then a second click, to see if it sticks.
//
// Pure measurement: no fix lives here, nothing is asserted pass/fail — the console output IS the
// deliverable.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`.
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
  // Do NOT settle here — install the instrumentation the instant the editable exists, so a
  // delayMs=0 click lands as close as physically possible to whatever finish-init has done so
  // far, which is the whole point of this probe.
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

// Combines the event timeline (caret-first-click-probe.spec.ts, incl. the caret PAINT-height
// measurement that cracked 439) with an interleaved DOM-mutation log on document.body (subtree —
// the editor element itself may not exist as a stable reference yet at t≈0), each entry tagged
// with whether its target sits inside the current editable. One array, one timestamp base
// (performance.now()), so events and mutations read as ONE ordered story.
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
          // Task 439: a Range can be perfectly placed and still UNPAINTABLE (zero-height rect
          // in an empty container). "The caret disappeared" is a paint question.
          caretHeight: Math.round(r.getBoundingClientRect().height),
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
        editorExists: !!editor,
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
          targetClass: (m.target as HTMLElement).className || undefined,
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
    `[click-during-init] ${label} INTERLEAVED TIMELINE (${log.length} entries):`,
  )
  for (const e of log) {
    // eslint-disable-next-line no-console
    console.log(`[click-during-init]   ${JSON.stringify(e)}`)
  }
}

async function probeClickTiming(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
  fixtureLabel: string,
  delayMs: number,
) {
  const frame = await openFixture(workbox, evaluateInVSCode, fixture)
  await installFullTimeline(frame)

  if (delayMs > 0) {
    await settle(frame, delayMs)
  }
  await sample(frame, 'before-click1')

  // Real click — a real user gesture, exercises the real focus path (per the established
  // ground rule in caret-first-click-probe.spec.ts: a synthetic focus event is not evidence).
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await sample(frame, 'click1-t0')
  await settle(frame, 100)
  await sample(frame, 'click1-t100')
  await settle(frame, 200) // total 300
  await sample(frame, 'click1-t300')
  await settle(frame, 300) // total 600
  await sample(frame, 'click1-t600')
  await settle(frame, 400) // total 1000
  await sample(frame, 'click1-t1000')
  await settle(frame, 1000) // total 2000
  await sample(frame, 'click1-t2000')
  await settle(frame, 1000) // total 3000
  await sample(frame, 'click1-t3000')

  // The second click — the asymmetry (does THIS one stick where the first may not have) is the
  // whole report.
  await sample(frame, 'before-click2')
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  await sample(frame, 'click2-t0')
  await settle(frame, 100)
  await sample(frame, 'click2-t100')
  await settle(frame, 400) // total 500
  await sample(frame, 'click2-t500')
  await settle(frame, 1500) // total 2000
  await sample(frame, 'click2-t2000')

  const log = await dumpLog(frame)
  logTimeline(`${fixtureLabel} delay=+${delayMs}ms`, log)
}

const DELAYS_MS = [0, 50, 150, 300, 600]

for (const delayMs of DELAYS_MS) {
  test(`probe: click +${delayMs}ms after editable appears, empty doc @probe`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(90_000)
    await probeClickTiming(
      workbox,
      evaluateInVSCode,
      EMPTY_FIXTURE,
      'empty',
      delayMs,
    )
  })

  test(`probe: click +${delayMs}ms after editable appears, with-text doc @probe`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(90_000)
    await probeClickTiming(
      workbox,
      evaluateInVSCode,
      TEXT_FIXTURE,
      'with-text',
      delayMs,
    )
  })
}
