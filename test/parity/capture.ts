// Task 532 §D — the capture SEQUENCE of the parity gate, shared by the chromium harness and the
// real-VS-Code spec. It drives one already-open editor through every stage and returns a flat
// snapshot per stage. The runner supplies only `evaluate(expression)` (page.evaluate in the harness,
// frame.locator('body').evaluate in VS Code), so the two layers cannot capture differently.
//
// Order: overlay (held) → IR → full Preview (entered from IR) → WYSIWYG → split (sv). The overlay is
// held by VMARKD_PRERENDER_PARITY_HOLD; its CSS is the live editor's, so the held overlay stands in
// for the prepaint frame (measured in tmp/fable-overlay/report.md).
//
// The caret is parked in the editor's trailing paragraph before every edit-surface snapshot: a caret
// inside a block expands that IR node (markers + source panel) and the gate compares COLLAPSED
// renders only.

import { type ParityStage, stageFamily } from './elements'
import {
  flattenSnapshot,
  type FlatSnapshot,
  snapshotExpression,
  type StageSnapshot,
} from './snapshot'
import type { RunSnapshots } from './compare'

export interface PageDriver {
  evaluate<T>(expression: string): Promise<T>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ROOTS: Readonly<Record<ParityStage, string>> = {
  overlay: '#vmarkd-prerender pre.vditor-reset',
  ir: '#app .vditor-ir pre.vditor-reset',
  wysiwyg: '#app .vditor-wysiwyg pre.vditor-reset',
  preview: '#app .vditor-preview .vditor-reset',
  sv: '#app .vditor-preview .vditor-reset',
}

async function until(
  d: PageDriver,
  label: string,
  expression: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let ok = false
    try {
      ok = (await d.evaluate<boolean>(expression)) === true
    } catch {
      // The page can be mid-navigation / mid-rebuild; keep polling until the deadline.
    }
    if (ok) return
    if (Date.now() > deadline)
      throw new Error(`parity: timed out waiting for ${label}`)
    await sleep(250)
  }
}

const q = (sel: string) => JSON.stringify(sel)

/** All of a stage's async content has landed (text, decorations, diagram renders). */
const settledExpr = (root: string): string => `(() => {
  const r = document.querySelector(${q(root)})
  if (!r || !(r.textContent || '').includes('PXfndef')) return false
  if (!r.querySelector('.language-mermaid svg')) return false
  if (!r.querySelector('.language-d2 svg')) return false
  if (!r.querySelector('.language-nomnoml svg')) return false
  if (!r.querySelector('.language-vega-lite svg')) return false
  return true
})()`

const parkExpr = (mode: 'ir' | 'wysiwyg'): string => `(() => {
  const root = document.querySelector(${q(`#app .vditor-${mode} pre.vditor-reset`)})
  if (!root) return 'no-root'
  const kids = Array.from(root.children)
  const target = kids[kids.length - 1]
  if (!target) return 'no-trailing'
  const range = document.createRange()
  range.setStart(target, 0)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return 'ok'
})()`

const expandedExpr = (mode: 'ir' | 'wysiwyg'): string =>
  `document.querySelectorAll(${q(`#app .vditor-${mode} .vditor-ir__node--expand`)}).length`

async function park(d: PageDriver, mode: 'ir' | 'wysiwyg'): Promise<void> {
  // The editor re-asserts its own caret for a moment after a mode switch / init; re-park until
  // nothing is expanded and it stays so (a synthetic range is not authoritative — vmarkd-testing).
  let calm = 0
  for (let i = 0; i < 40 && calm < 3; i++) {
    await d.evaluate(parkExpr(mode))
    await sleep(150)
    calm = (await d.evaluate<number>(expandedExpr(mode))) === 0 ? calm + 1 : 0
  }
  if (calm < 3)
    throw new Error(
      `parity: ${mode} still has an expanded node after parking the caret`,
    )
}

async function snapshotStable(
  d: PageDriver,
  stage: ParityStage,
): Promise<FlatSnapshot> {
  const expr = snapshotExpression(ROOTS[stage], stageFamily(stage))
  let prev = ''
  for (let i = 0; i < 30; i++) {
    const snap = await d.evaluate<StageSnapshot>(expr)
    const flat = flattenSnapshot(snap)
    const json = JSON.stringify(flat)
    if (json === prev) return flat
    prev = json
    await sleep(400)
  }
  throw new Error(`parity: ${stage} snapshot never stabilised`)
}

const clickMode = (mode: 'ir' | 'wysiwyg' | 'sv') => `(() => {
  const b = document.querySelector('.vditor-toolbar button[data-mode="${mode}"]')
  if (!b) return false
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
})()`

const PREVIEW_ON = `(() => {
  const inst = window.vditor, v = inst.vditor
  v.preview.element.style.display = 'block'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
  v.preview.render(v)
  return true
})()`
const PREVIEW_OFF = `(() => {
  const inst = window.vditor, v = inst.vditor
  v.preview.element.style.display = 'none'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'block'
  return true
})()`

/** The decorators every live stage must show before the gate trusts a snapshot. */
const decoratedExpr = (root: string): string => `(() => {
  const r = document.querySelector(${q(root)})
  return !!r && r.querySelectorAll('.vmarkd-callout__title').length >= 2
    && r.querySelectorAll('.hljs span[class*="hljs-"]').length > 0
    && r.querySelectorAll('.katex').length >= 2
})()`

export async function captureStages(d: PageDriver): Promise<RunSnapshots> {
  const out: RunSnapshots = {}

  // Live IR first so its async decorators have run; the overlay is still held on top.
  await until(
    d,
    'the live IR editor + the held overlay',
    `!!window.vditor && !!document.querySelector(${q(ROOTS.ir)}) && typeof window.__vmarkdReleasePrerender === 'function' && !!document.querySelector(${q(ROOTS.overlay)})`,
  )
  await until(d, 'IR content to settle', settledExpr(ROOTS.ir))
  await until(d, 'IR decorations', decoratedExpr(ROOTS.ir))
  await park(d, 'ir')
  out.overlay = await snapshotStable(d, 'overlay')
  out.ir = await snapshotStable(d, 'ir')

  await d.evaluate(PREVIEW_ON)
  await until(d, 'the Preview to render', settledExpr(ROOTS.preview))
  await until(d, 'Preview decorations', decoratedExpr(ROOTS.preview))
  out.preview = await snapshotStable(d, 'preview')
  await d.evaluate(PREVIEW_OFF)

  await d.evaluate(clickMode('wysiwyg'))
  await until(d, 'WYSIWYG to settle', settledExpr(ROOTS.wysiwyg))
  await until(d, 'WYSIWYG decorations', decoratedExpr(ROOTS.wysiwyg))
  await park(d, 'wysiwyg')
  out.wysiwyg = await snapshotStable(d, 'wysiwyg')

  await d.evaluate(clickMode('sv'))
  await until(
    d,
    'split view to be active',
    `window.vditor.getCurrentMode() === 'sv'`,
  )
  await until(d, 'the split pane to render', settledExpr(ROOTS.sv))
  await until(d, 'split decorations', decoratedExpr(ROOTS.sv))
  out.sv = await snapshotStable(d, 'sv')
  return out
}
