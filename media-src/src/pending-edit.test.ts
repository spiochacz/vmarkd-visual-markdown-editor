import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPendingEdit } from './pending-edit'

describe('createPendingEdit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('schedule() debounces onIdle by the configured wait', () => {
    const onIdle = vi.fn()
    const pe = createPendingEdit({ wait: 250, onIdle, onFlush: vi.fn() })
    pe.schedule()
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid schedule() calls into one onIdle', () => {
    const onIdle = vi.fn()
    const pe = createPendingEdit({ wait: 250, onIdle, onFlush: vi.fn() })
    pe.schedule()
    pe.schedule()
    pe.schedule()
    vi.advanceTimersByTime(250)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  // Ctrl/Cmd+S (task 58): flush runs onFlush immediately and cancels the pending
  // idle, so the timer can't also fire and the save persists current content.
  it('flush() runs onFlush immediately and cancels the pending onIdle', () => {
    const onIdle = vi.fn()
    const onFlush = vi.fn()
    const pe = createPendingEdit({ wait: 250, onIdle, onFlush })
    pe.schedule()
    pe.flush()
    expect(onFlush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('flush() runs onFlush even when nothing is pending', () => {
    const onFlush = vi.fn()
    const pe = createPendingEdit({ wait: 250, onIdle: vi.fn(), onFlush })
    expect(pe.pending).toBe(false)
    pe.flush()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('reports pending state across schedule/flush', () => {
    const pe = createPendingEdit({
      wait: 250,
      onIdle: vi.fn(),
      onFlush: vi.fn(),
    })
    expect(pe.pending).toBe(false)
    pe.schedule()
    expect(pe.pending).toBe(true)
    pe.flush()
    expect(pe.pending).toBe(false)
  })
})
