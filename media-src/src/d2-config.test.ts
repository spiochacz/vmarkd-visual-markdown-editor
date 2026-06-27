// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getD2Config, setD2Config } from './d2-config'

afterEach(() => {
  for (const k of [
    '__vmarkdD2Layout',
    '__vmarkdD2Theme',
    '__vmarkdContentTheme',
    '__vmarkdMode',
  ]) {
    delete (window as unknown as Record<string, unknown>)[k]
  }
})

describe('d2-config', () => {
  it('round-trips a full config producer→consumer', () => {
    setD2Config({
      layout: 'elk',
      theme: 'auto',
      contentTheme: 'github-dark',
      mode: 'dark',
    })
    expect(getD2Config()).toEqual({
      layout: 'elk',
      theme: 'auto',
      contentTheme: 'github-dark',
      mode: 'dark',
    })
  })

  it('patches only the provided keys, leaving the rest intact', () => {
    setD2Config({ layout: 'dagre', theme: 'mono', mode: 'light' })
    setD2Config({ mode: 'dark' }) // a theme flip touches mode only
    const c = getD2Config()
    expect(c.mode).toBe('dark')
    expect(c.layout).toBe('dagre') // untouched
    expect(c.theme).toBe('mono') // untouched
  })

  it('clears a key when set to undefined', () => {
    setD2Config({ layout: 'elk' })
    setD2Config({ layout: undefined })
    expect(getD2Config().layout).toBeUndefined()
  })
})
