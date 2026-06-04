import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPendingEdit } from './pending-edit'

describe('createPendingEdit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('schedule(content) debounces and posts that exact content', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'live', post })
    pe.schedule('a')
    expect(post).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(post).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('a')
  })

  // The perf win: the debounced post reuses the markdown Vditor already serialised
  // (passed to schedule) and must NOT call getValue() — a second full serialise of
  // a large document is multi-second.
  it('schedule() does NOT re-serialise via getValue()', () => {
    const getValue = vi.fn(() => 'LIVE')
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue, post })
    pe.schedule('SERIALIZED')
    vi.advanceTimersByTime(250)
    expect(post).toHaveBeenCalledWith('SERIALIZED')
    expect(getValue).not.toHaveBeenCalled()
  })

  it('coalesces rapid calls into one post of the latest content', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'live', post })
    pe.schedule('a')
    pe.schedule('ab')
    pe.schedule('abc')
    vi.advanceTimersByTime(250)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('abc')
  })

  // Ctrl/Cmd+S: persist the LIVE value even when nothing is pending — Vditor only
  // calls its input hook after its ~800ms throttle, so a save right after typing
  // has no pending edit yet, but the live value is current and must be saved.
  it('flush() posts the live getValue() even when nothing is pending', () => {
    const getValue = vi.fn(() => 'live')
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue, post })
    expect(pe.pending).toBe(false)
    pe.flush()
    expect(getValue).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('live')
  })

  it('flush() posts the live value, not a stale pending content, and cancels the timer', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'LIVE', post })
    pe.schedule('OLD') // a debounced edit is pending
    pe.flush()
    expect(post).toHaveBeenLastCalledWith('LIVE')
    vi.advanceTimersByTime(250) // the original timer must not also fire
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('reports pending state across schedule/flush', () => {
    const pe = createPendingEdit({
      wait: 250,
      getValue: () => 'x',
      post: vi.fn(),
    })
    expect(pe.pending).toBe(false)
    pe.schedule('x')
    expect(pe.pending).toBe(true)
    pe.flush()
    expect(pe.pending).toBe(false)
  })
})
