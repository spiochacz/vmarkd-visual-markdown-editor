import { describe, expect, it, vi } from 'vitest'
import { Disposables } from './disposables'

describe('Disposables', () => {
  it('disposes the previous observer when a key is re-set (the runFinishInit re-wire)', () => {
    const d = new Disposables()
    const first = vi.fn()
    const second = vi.fn()
    d.set('callouts', first)
    expect(first).not.toHaveBeenCalled()
    d.set('callouts', second)
    expect(first).toHaveBeenCalledTimes(1) // old observer torn down
    expect(second).not.toHaveBeenCalled() // new one stays live
  })

  it('disposeAll() tears down every registered observer and clears the registry', () => {
    const d = new Disposables()
    const a = vi.fn()
    const b = vi.fn()
    d.set('a', a)
    d.set('b', b)
    d.disposeAll()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    // a second disposeAll() is a no-op (the map was cleared) — no double-dispose
    d.disposeAll()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('set(key, null) disposes the current observer and frees the slot', () => {
    const d = new Disposables()
    const a = vi.fn()
    d.set('a', a)
    d.set('a', null)
    expect(a).toHaveBeenCalledTimes(1)
    // slot is gone → disposeAll() won't call it again
    d.disposeAll()
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('tolerates a null/undefined disposer for a never-registered key', () => {
    const d = new Disposables()
    expect(() => d.set('never', null)).not.toThrow()
    expect(() => d.disposeAll()).not.toThrow()
  })
})
