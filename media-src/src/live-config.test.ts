import { describe, it, expect } from 'vitest'
import { initOnlyChanged, INIT_ONLY_OPTIONS } from './live-config'

describe('initOnlyChanged', () => {
  it('is false when no constructor-only option changed', () => {
    const opts = { showToolbar: true, wordCount: false, highlightHeadings: true }
    // highlightHeadings flips, but it is a live body-attr option, not init-only
    expect(initOnlyChanged(opts, { ...opts, highlightHeadings: false })).toBe(
      false
    )
  })

  it('is true when a constructor-only option changed', () => {
    const opts = { showToolbar: true, wordCount: false }
    expect(initOnlyChanged(opts, { ...opts, showToolbar: false })).toBe(true)
    expect(initOnlyChanged(opts, { ...opts, wordCount: true })).toBe(true)
  })

  it('covers the documented init-only keys', () => {
    expect(INIT_ONLY_OPTIONS).toContain('showToolbar')
    expect(INIT_ONLY_OPTIONS).toContain('wordCount')
    expect(INIT_ONLY_OPTIONS).toContain('outlinePosition')
  })
})
