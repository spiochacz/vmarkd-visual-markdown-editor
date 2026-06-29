// @vitest-environment jsdom
import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isTyping,
  markEditActivity,
  deferUntilSettle,
  beginSettleRender,
  scheduleReveal,
  installEditActivity,
  hasFreshRender,
} from './edit-activity'

// The gate's quiet window is 220 ms (private const in edit-activity.ts); tests advance well under it
// (100 ms = "still typing") and well over it (300 ms = "settled") so they don't depend on the exact value.
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.runOnlyPendingTimers() // flush any pending settle so module state doesn't leak between tests
  vi.useRealTimers()
})

test('isTyping is false before any input', () => {
  expect(isTyping()).toBe(false)
})

test('markEditActivity makes isTyping true, then false after the quiet window', () => {
  markEditActivity()
  expect(isTyping()).toBe(true)
  vi.advanceTimersByTime(100)
  expect(isTyping()).toBe(true) // still within the quiet window
  vi.advanceTimersByTime(200)
  expect(isTyping()).toBe(false) // settled
})

test('rapid keystrokes coalesce — the timer resets on each input', () => {
  markEditActivity()
  vi.advanceTimersByTime(100)
  markEditActivity() // resets the quiet window
  vi.advanceTimersByTime(150)
  expect(isTyping()).toBe(true) // 150 < 220 since the last reset
  vi.advanceTimersByTime(100)
  expect(isTyping()).toBe(false)
})

test('deferUntilSettle runs the callback once, after the user pauses', () => {
  let calls = 0
  deferUntilSettle('k', () => calls++)
  expect(calls).toBe(0) // not immediate
  vi.advanceTimersByTime(100)
  expect(calls).toBe(0)
  vi.advanceTimersByTime(200)
  expect(calls).toBe(1) // fired on settle
})

test('deferUntilSettle is keyed — latest callback wins, N keystrokes collapse to one render', () => {
  let a = 0
  let b = 0
  deferUntilSettle('render', () => a++)
  deferUntilSettle('render', () => b++) // supersedes the first under the same key
  vi.advanceTimersByTime(300)
  expect(a).toBe(0)
  expect(b).toBe(1)
})

test('distinct keys both fire on settle', () => {
  let a = 0
  let b = 0
  deferUntilSettle('native', () => a++)
  deferUntilSettle('custom', () => b++)
  vi.advanceTimersByTime(300)
  expect(a).toBe(1)
  expect(b).toBe(1)
})

test('a throwing settle callback does not wedge the gate', () => {
  deferUntilSettle('boom', () => {
    throw new Error('render failed')
  })
  expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  // gate recovered: a fresh defer still fires
  let ok = 0
  deferUntilSettle('again', () => ok++)
  vi.advanceTimersByTime(300)
  expect(ok).toBe(1)
})

test('installEditActivity arms the gate on input and exposes the native defer hook', () => {
  const app = document.createElement('div')
  document.body.appendChild(app)
  const child = document.createElement('div')
  app.appendChild(child)
  const dispose = installEditActivity(app)
  expect(
    typeof (window as unknown as Record<string, unknown>)
      .__vmarkdDeferIrDiagramRender,
  ).toBe('function')

  expect(isTyping()).toBe(false)
  child.dispatchEvent(new Event('input', { bubbles: true }))
  expect(isTyping()).toBe(true) // capture-phase listener armed the gate

  dispose()
  expect(
    (window as unknown as Record<string, unknown>).__vmarkdDeferIrDiagramRender,
  ).toBeUndefined()
  app.remove()
})

test('beginSettleRender / scheduleReveal are no-ops when there is no IR editor', () => {
  expect(() => beginSettleRender()).not.toThrow()
  expect(() => scheduleReveal()).not.toThrow()
})

// Regression: a flowchart shrank after an edit (svg 179→79px wide) because flowchart.js measures its
// text and re-rendered into the STILL-display:none deferred child (getBBox ~0 → collapsed boxes).
// flowchart must therefore render in COVER mode (visible+sized under the opaque overlay) like the
// canvas engines — NOT stay in the display:none "deferred" state. A non-measuring SVG engine
// (graphviz computes layout without the DOM box) must STAY deferred (cheaper, renders fine hidden).
test('beginSettleRender switches a deferred flowchart to cover mode, leaves graphviz deferred', () => {
  const ir = document.createElement('div')
  ir.className = 'vditor-ir'
  const block = (lang: string) =>
    '<div class="vditor-ir__node" data-type="code-block">' +
    `<pre class="vditor-ir__marker--pre"><code class="language-${lang}">src</code></pre>` +
    // both previews start in the display:none "deferred" state (mid-typing overlay shown)
    '<div class="vditor-ir__preview vmarkd-deferred" data-render="2"></div>' +
    '</div>'
  ir.innerHTML = block('flowchart') + block('graphviz')
  document.body.appendChild(ir)

  beginSettleRender()

  const previews = ir.querySelectorAll('.vditor-ir__preview')
  const flowchart = previews[0]
  const graphviz = previews[1]
  // flowchart measures text → must become visible+sized (cover) so the new render isn't shrunken
  expect(flowchart.classList.contains('vmarkd-cover')).toBe(true)
  expect(flowchart.classList.contains('vmarkd-deferred')).toBe(false)
  // graphviz doesn't measure the DOM box → stays in the cheap display:none deferred state
  expect(graphviz.classList.contains('vmarkd-cover')).toBe(false)
  expect(graphviz.classList.contains('vmarkd-deferred')).toBe(true)

  ir.remove()
})

test('hasFreshRender: a rendered svg outside the overlay counts as fresh', () => {
  const p = document.createElement('div')
  p.innerHTML = '<div class="language-mermaid"><svg></svg></div>'
  expect(hasFreshRender(p)).toBe(true)
})

test('hasFreshRender: a parse-error box is a terminal render → fresh (no 3s reveal wait)', () => {
  const mermaid = document.createElement('div')
  mermaid.innerHTML =
    '<div class="language-mermaid"><div class="vmarkd-mermaid-error"><pre>err</pre></div></div>'
  expect(hasFreshRender(mermaid)).toBe(true)
  // forward-compat with task 178's generalised class
  const generalised = document.createElement('div')
  generalised.innerHTML =
    '<div class="vmarkd-diagram-error"><pre>err</pre></div>'
  expect(hasFreshRender(generalised)).toBe(true)
})

test('hasFreshRender: a stale overlay alone is NOT fresh (cached svg / cached error box inside it)', () => {
  const cachedSvg = document.createElement('div')
  cachedSvg.innerHTML =
    '<div class="vmarkd-stale-overlay" data-render="1"><svg></svg></div>'
  expect(hasFreshRender(cachedSvg)).toBe(false)

  const cachedError = document.createElement('div')
  cachedError.innerHTML =
    '<div class="vmarkd-stale-overlay" data-render="1"><div class="vmarkd-mermaid-error"></div></div>'
  expect(hasFreshRender(cachedError)).toBe(false)
})

// Task 178 item 4: the error box must NOT strobe while typing — a half-typed diagram is "invalid" on
// every keystroke. The box is produced by the engine, which runs inside processCodeRender; this proves
// the deferIrDiagramRender gate SKIPS processCodeRender for a cached diagram lang while isTyping() (so
// the engine — and any error box — can't run mid-keystroke) and runs it exactly once on settle.
function buildIrWithGraphviz(): HTMLElement {
  const ir = document.createElement('div')
  ir.className = 'vditor-ir'
  // a graphviz code-block dual-node: editable source + an already-rendered preview (data-render="2")
  ir.innerHTML =
    '<div class="vditor-ir__node" data-type="code-block">' +
    '<pre class="vditor-ir__marker--pre"><code class="language-graphviz">digraph{a-&gt;b}</code></pre>' +
    '<div class="vditor-ir__preview" data-render="2"><div class="language-graphviz"><svg></svg></div></div>' +
    '</div>'
  document.body.appendChild(ir)
  return ir
}

test('deferIrDiagramRender: a cached diagram lang is NOT rendered while typing (no error-box flash), rendered once on settle', () => {
  const ir = buildIrWithGraphviz()
  const dispose = installEditActivity(ir)
  const defer = (window as unknown as Record<string, unknown>)
    .__vmarkdDeferIrDiagramRender as (v: unknown, p: unknown) => void
  const vditor = { ir: { element: ir } }
  const rendered: Element[] = []
  const processCodeRender = (el: Element) => rendered.push(el)

  // mid-typing burst → isTyping() true
  markEditActivity()
  expect(isTyping()).toBe(true)
  defer(vditor, processCodeRender)
  // graphviz is a cached/deferred lang → processCodeRender is skipped → the engine never runs, so an
  // error box cannot be produced this keystroke (the cached overlay holds instead).
  expect(rendered.length).toBe(0)

  // user pauses → the quiet timer fires → the deferred render runs once (now the box could appear)
  vi.advanceTimersByTime(300)
  expect(rendered.length).toBeGreaterThan(0)

  dispose()
  ir.remove()
})

test('deferIrDiagramRender: when NOT typing, a diagram renders immediately (gate only defers mid-burst)', () => {
  const ir = buildIrWithGraphviz()
  const dispose = installEditActivity(ir)
  const defer = (window as unknown as Record<string, unknown>)
    .__vmarkdDeferIrDiagramRender as (v: unknown, p: unknown) => void
  const rendered: Element[] = []
  const processCodeRender = (el: Element) => rendered.push(el)

  // no markEditActivity() → isTyping() false → the render is NOT deferred
  expect(isTyping()).toBe(false)
  defer({ ir: { element: ir } }, processCodeRender)
  expect(rendered.length).toBeGreaterThan(0)

  dispose()
  ir.remove()
})
