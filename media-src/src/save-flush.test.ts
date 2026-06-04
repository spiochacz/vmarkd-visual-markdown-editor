import { describe, it, expect, vi } from 'vitest'
import { isSaveShortcut, setupSaveFlushKeybind } from './save-flush'

const ev = (o: Partial<KeyboardEvent>) =>
  ({
    key: 's',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...o,
  }) as KeyboardEvent

describe('isSaveShortcut (non-mac: Ctrl is the save modifier)', () => {
  it('Ctrl+S → true', () => {
    expect(isSaveShortcut(ev({ key: 's', ctrlKey: true }), false)).toBe(true)
  })
  it('Ctrl+Shift+S (Save As) → true (it also persists; flushing is correct)', () => {
    expect(
      isSaveShortcut(ev({ key: 's', ctrlKey: true, shiftKey: true }), false),
    ).toBe(true)
  })
  it('uppercase S (caps/shift) matches', () => {
    expect(isSaveShortcut(ev({ key: 'S', ctrlKey: true }), false)).toBe(true)
  })
  it('Cmd+S on a non-mac platform → false (wrong modifier)', () => {
    expect(isSaveShortcut(ev({ key: 's', metaKey: true }), false)).toBe(false)
  })
  it('Ctrl+Alt+S → false (Alt-combos are not a plain save)', () => {
    expect(
      isSaveShortcut(ev({ key: 's', ctrlKey: true, altKey: true }), false),
    ).toBe(false)
  })
  it('bare s (no modifier) → false', () => {
    expect(isSaveShortcut(ev({ key: 's' }), false)).toBe(false)
  })
  it('Ctrl+A → false (different key)', () => {
    expect(isSaveShortcut(ev({ key: 'a', ctrlKey: true }), false)).toBe(false)
  })
})

describe('isSaveShortcut (mac: Cmd is the save modifier)', () => {
  it('Cmd+S → true', () => {
    expect(isSaveShortcut(ev({ key: 's', metaKey: true }), true)).toBe(true)
  })
  it('Ctrl+S on mac → false (Ctrl is not the mac save modifier)', () => {
    expect(isSaveShortcut(ev({ key: 's', ctrlKey: true }), true)).toBe(false)
  })
})

describe('setupSaveFlushKeybind', () => {
  function makeWin(platform: string) {
    let handler: (e: any) => void = () => {}
    let capture: boolean | undefined
    return {
      navigator: { platform },
      addEventListener: (type: string, h: any, useCapture?: boolean) => {
        if (type === 'keydown') {
          handler = h
          capture = useCapture
        }
      },
      get captureFlag() {
        return capture
      },
      fire: (e: any) => handler(e),
    } as any
  }

  it('registers in the capture phase (flush must run before VS Code save forwarding)', () => {
    const win = makeWin('Linux x86_64')
    setupSaveFlushKeybind(win, vi.fn())
    expect(win.captureFlag).toBe(true)
  })

  // Unlike the undo keybind, save must NOT be swallowed: we flush our pending edit
  // first, then let the event continue so VS Code's native save still runs.
  it('flushes on Ctrl+S but lets the event continue (VS Code still saves)', () => {
    const flush = vi.fn()
    const win = makeWin('Linux x86_64')
    setupSaveFlushKeybind(win, flush)
    const e = {
      ...ev({ key: 's', ctrlKey: true }),
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      stopPropagation: vi.fn(),
    }
    win.fire(e)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
  })

  it('does not flush on non-save keys', () => {
    const flush = vi.fn()
    const win = makeWin('Linux x86_64')
    setupSaveFlushKeybind(win, flush)
    win.fire({ ...ev({ key: 'a', ctrlKey: true }), preventDefault: vi.fn() })
    expect(flush).not.toHaveBeenCalled()
  })
})
