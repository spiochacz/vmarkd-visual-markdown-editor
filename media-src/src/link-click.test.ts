import { describe, it, expect, vi } from 'vitest'
import { openLinkFromMarker } from './link-click'

describe('openLinkFromMarker', () => {
  it('posts the marker URL to the host as an open-link message', () => {
    const post = vi.fn()
    const opened = openLinkFromMarker(
      { textContent: 'https://example.com' },
      post,
    )
    expect(opened).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({
      command: 'open-link',
      href: 'https://example.com',
    })
  })

  it('trims surrounding whitespace from the marker text', () => {
    const post = vi.fn()
    openLinkFromMarker({ textContent: '  https://example.com  ' }, post)
    expect(post).toHaveBeenCalledWith({
      command: 'open-link',
      href: 'https://example.com',
    })
  })

  it('does nothing for an empty/whitespace/missing href', () => {
    const post = vi.fn()
    expect(openLinkFromMarker({ textContent: '   ' }, post)).toBe(false)
    expect(openLinkFromMarker({ textContent: null }, post)).toBe(false)
    expect(openLinkFromMarker(null, post)).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})
