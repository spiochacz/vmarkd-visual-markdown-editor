// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isHostFindOpen, setHostFindClosed, setHostFindOpen } from './host-find'

// jsdom's `isTrusted` is an unforgeable own property, so a trusted gesture cannot be dispatched for
// real; drive the listeners through a fake Document that records them (setHostFindOpen takes one).
function fakeDoc() {
  const listeners = new Map<string, (e: Event) => void>()
  const doc = {
    addEventListener: (t: string, fn: (e: Event) => void) =>
      listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
  } as unknown as Document
  const fire = (t: string, isTrusted: boolean) =>
    listeners.get(t)?.({ isTrusted } as Event)
  return { doc, fire, count: () => listeners.size }
}

describe('host-find flag (task 522)', () => {
  afterEach(() => setHostFindClosed())

  it('is closed by default, open after setHostFindOpen, closed after setHostFindClosed', () => {
    expect(isHostFindOpen()).toBe(false)
    setHostFindOpen()
    expect(isHostFindOpen()).toBe(true)
    setHostFindClosed()
    expect(isHostFindOpen()).toBe(false)
  })

  it('a trusted pointerdown clears it and detaches the listener', () => {
    const d = fakeDoc()
    setHostFindOpen(d.doc)
    d.fire('pointerdown', true)
    expect(isHostFindOpen()).toBe(false)
    expect(d.count()).toBe(0)
  })

  it('a keydown never clears it (the handshake leaks the find keystroke into the webview)', () => {
    const d = fakeDoc()
    setHostFindOpen(d.doc)
    expect(d.fire('keydown', true)).toBeUndefined()
    expect(isHostFindOpen()).toBe(true)
  })

  it('synthetic gestures do not clear it', () => {
    const d = fakeDoc()
    setHostFindOpen(d.doc)
    d.fire('pointerdown', false)
    expect(isHostFindOpen()).toBe(true)
  })

  it('re-opening twice does not stack listeners; it can re-open after a clear', () => {
    const d = fakeDoc()
    setHostFindOpen(d.doc)
    setHostFindOpen(d.doc)
    expect(d.count()).toBe(1)
    d.fire('pointerdown', true)
    expect(isHostFindOpen()).toBe(false)
    setHostFindOpen(d.doc)
    expect(isHostFindOpen()).toBe(true)
    expect(d.count()).toBe(1)
  })
})
