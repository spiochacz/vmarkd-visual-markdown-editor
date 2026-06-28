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
