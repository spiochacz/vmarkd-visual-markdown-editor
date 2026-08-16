import { type EvaluateInVSCode, wf } from './webview-helpers'
// PROBE (task 439, "Current behaviour" step) — measures, WITHOUT any click/keypress, where the
// caret/focus/scroll actually land right after a document opens in the default IR mode. This is
// pure measurement: no fix lives here, nothing in the task's checklist gets ticked from this file.
//
// Deliberately distinguishes "no selection exists" (rangeCount === 0) from "a selection exists at
// the wrong place" (rangeCount === 1, anchor not at block 0 offset 0) — see
// dont-assert-unverified-symptoms: those are different bugs with different fixes, and collapsing
// them into a single pass/fail would hide which one is real.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

const settle = (frame: ReturnType<typeof wf>, ms: number) =>
  frame
    .locator('body')
    .evaluate((_el, d) => new Promise((r) => setTimeout(r, d as number)), ms)

/**
 * Raw caret/focus/scroll state, read INSIDE the webview iframe. No assumption about where the
 * caret "should" be — just what document.activeElement / getSelection() / scrollTop report right
 * now, for the default IR mode's editable element.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: in-page probe reading caret/focus/selection state across the editable-element-present/absent branches; pre-existing (task 469 baseline)
function measure(_body: Element) {
  const editor = (
    window as unknown as {
      vditor?: { vditor?: { ir?: { element?: HTMLElement } } }
    }
  ).vditor?.vditor?.ir?.element
  const active = document.activeElement
  const sel = window.getSelection()
  const rangeCount = sel?.rangeCount ?? 0

  let range: {
    anchorNode: string
    anchorText: string
    anchorOffset: number
    isCollapsed: boolean
    // top-level block (direct child of the editable element) the anchor sits in
    blockTag: string | null
    blockIndex: number
    totalBlocks: number
  } | null = null

  if (rangeCount > 0 && sel) {
    const r = sel.getRangeAt(0)
    let blockTag: string | null = null
    let blockIndex = -1
    if (editor) {
      let el: Element | null =
        r.startContainer.nodeType === Node.ELEMENT_NODE
          ? (r.startContainer as Element)
          : r.startContainer.parentElement
      while (el && el.parentElement !== editor && el !== editor) {
        el = el.parentElement
      }
      if (el && el.parentElement === editor) {
        blockTag = el.tagName
        blockIndex = Array.from(editor.children).indexOf(el)
      }
    }
    range = {
      anchorNode: r.startContainer.nodeName,
      anchorText: (r.startContainer.textContent ?? '').slice(0, 40),
      anchorOffset: r.startOffset,
      isCollapsed: r.collapsed,
      blockTag,
      blockIndex,
      totalBlocks: editor ? editor.children.length : -1,
    }
  }

  // Nearest scrollable ancestor of the editable element (the real scroller in the VS Code webview
  // is `pre.vditor-reset`, per toolbar-scroll-guard's findScroller) — walk up rather than assume a
  // selector, so this doesn't silently match nothing if the DOM shape differs.
  let scroller: HTMLElement | null = editor ?? null
  while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
    scroller = scroller.parentElement
  }

  return {
    activeTag: active?.tagName ?? null,
    activeClass: (active as HTMLElement | null)?.className ?? null,
    activeIsEditor: !!(editor && active && editor.contains(active)),
    rangeCount,
    range,
    editorScrollTop: editor?.scrollTop ?? null,
    scrollerScrollTop: scroller?.scrollTop ?? null,
    scrollerTag: scroller?.tagName ?? null,
  }
}

type Measurement = ReturnType<typeof measure>

function logMeasurement(label: string, fixture: string, m: Measurement) {
  // eslint-disable-next-line no-console
  console.log(
    `[caret-probe] ${fixture} @ ${label}: ${JSON.stringify(m, null, 0)}`,
  )
}

async function probe(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
  label: string,
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
  // Wait for the editable IR surface to exist — this alone does NOT click or focus anything.
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  // Sample point 1: right after the editable element appears.
  const t0 = (await frame.locator('body').evaluate(measure)) as Measurement
  logMeasurement(`${label} T0 (editable just appeared)`, fixture, t0)

  // Sample point 2: a short settle (finish-init helpers + any async wiring had a beat to run).
  await settle(frame, 500)
  const t1 = (await frame.locator('body').evaluate(measure)) as Measurement
  logMeasurement(`${label} T1 (+500ms)`, fixture, t1)

  // Sample point 3: a longer settle, to catch anything that changes late (streaming tail,
  // deferred observers, a late focus/scroll restore).
  await settle(frame, 2000)
  const t2 = (await frame.locator('body').evaluate(measure)) as Measurement
  logMeasurement(`${label} T2 (+2500ms total)`, fixture, t2)

  return { t0, t1, t2 }
}

test('probe: caret/focus/scroll on open, no click, empty document @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probe(workbox, evaluateInVSCode, EMPTY_FIXTURE, 'empty')
})

test('probe: caret/focus/scroll on open, no click, document with text @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probe(workbox, evaluateInVSCode, TEXT_FIXTURE, 'with-text')
})
