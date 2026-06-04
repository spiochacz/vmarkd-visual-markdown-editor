// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { setBusyCursor, nextPaint } from './busy-cursor'

describe('setBusyCursor', () => {
  it('toggles the body.vmarkd-busy class', () => {
    expect(document.body.classList.contains('vmarkd-busy')).toBe(false)
    setBusyCursor(true)
    expect(document.body.classList.contains('vmarkd-busy')).toBe(true)
    setBusyCursor(false)
    expect(document.body.classList.contains('vmarkd-busy')).toBe(false)
  })
})

describe('nextPaint', () => {
  it('resolves after a frame + macrotask', async () => {
    const win = {
      requestAnimationFrame: (cb: any) => {
        cb()
        return 0
      },
      setTimeout: (cb: any) => {
        cb()
        return 0 as any
      },
    } as any
    const order: string[] = []
    const p = nextPaint(win).then(() => order.push('painted'))
    await p
    expect(order).toEqual(['painted'])
  })

  it('uses requestAnimationFrame then setTimeout', async () => {
    const raf = vi.fn((cb: any) => {
      cb()
      return 0
    })
    const st = vi.fn((cb: any) => {
      cb()
      return 0 as any
    })
    await nextPaint({ requestAnimationFrame: raf, setTimeout: st } as any)
    expect(raf).toHaveBeenCalledTimes(1)
    expect(st).toHaveBeenCalledTimes(1)
  })
})
