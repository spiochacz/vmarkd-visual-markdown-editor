import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPendingEdit } from './pending-edit'

describe('createPendingEdit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('schedule() debounces the post by the configured wait', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'a', post })
    pe.schedule()
    expect(post).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(post).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('a')
  })

  it('schedule() coalesces rapid calls into one post of the latest value', () => {
    const post = vi.fn()
    let value = 'a'
    const pe = createPendingEdit({ wait: 250, getValue: () => value, post })
    pe.schedule()
    value = 'ab'
    pe.schedule()
    value = 'abc'
    pe.schedule()
    vi.advanceTimersByTime(250)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('abc')
  })

  // THE BUG (task 58): a Ctrl/Cmd+S issued inside the 250ms debounce window must
  // persist the CURRENT editor content, not wait for (or miss) the pending timer.
  // Before the flush() path existed, the save raced the debounce → stale save.
  it('flush() posts the current value immediately while an edit is pending', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'typed', post })
    pe.schedule() // user typed; debounce armed but not yet fired
    expect(post).not.toHaveBeenCalled()
    pe.flush() // Ctrl+S within the window
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('typed')
  })

  it('flush() cancels the armed timer so the edit is not posted twice', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'x', post })
    pe.schedule()
    pe.flush()
    vi.advanceTimersByTime(250) // the original timer must not also fire
    expect(post).toHaveBeenCalledTimes(1)
  })

  // Critical: a save can land BEFORE schedule() ever runs — Vditor only calls its
  // input hook after its own ~800ms throttle, so nothing is "pending" yet, but the
  // editor's live value is already current and must be saved. flush() must post it.
  it('flush() posts the live value even when nothing is pending', () => {
    const post = vi.fn()
    const pe = createPendingEdit({ wait: 250, getValue: () => 'live', post })
    expect(pe.pending).toBe(false)
    pe.flush()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('live')
  })

  it('reports pending state across schedule/flush', () => {
    const pe = createPendingEdit({
      wait: 250,
      getValue: () => 'x',
      post: vi.fn(),
    })
    expect(pe.pending).toBe(false)
    pe.schedule()
    expect(pe.pending).toBe(true)
    pe.flush()
    expect(pe.pending).toBe(false)
  })
})
