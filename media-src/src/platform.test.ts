import { describe, expect, it } from 'vitest'
import { isMac } from './platform'

// isMac detects macOS from navigator.platform (injectable for tests).
describe('isMac', () => {
  it('is true for mac platform strings (case-insensitive)', () => {
    expect(isMac({ platform: 'MacIntel' })).toBe(true)
    expect(isMac({ platform: 'macarm' })).toBe(true)
  })

  it('is false for non-mac platforms', () => {
    expect(isMac({ platform: 'Win32' })).toBe(false)
    expect(isMac({ platform: 'Linux x86_64' })).toBe(false)
  })
})
