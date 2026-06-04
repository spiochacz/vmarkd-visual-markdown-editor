import { describe, it, expect } from 'vitest'
import {
  undoDelayForContentLength,
  DEFAULT_UNDO_DELAY,
  LARGE_DOC_UNDO_DELAY,
  LARGE_DOC_CHARS,
} from './edit-sync-tuning'

describe('undoDelayForContentLength', () => {
  it('keeps the snappy default for small/empty documents', () => {
    expect(undoDelayForContentLength(0)).toBe(DEFAULT_UNDO_DELAY)
    expect(undoDelayForContentLength(LARGE_DOC_CHARS - 1)).toBe(
      DEFAULT_UNDO_DELAY,
    )
  })

  it('widens the idle window at/above the large-doc threshold', () => {
    expect(undoDelayForContentLength(LARGE_DOC_CHARS)).toBe(
      LARGE_DOC_UNDO_DELAY,
    )
    expect(undoDelayForContentLength(500_000)).toBe(LARGE_DOC_UNDO_DELAY)
  })

  it('the large-doc window is longer than the default (defers the freeze)', () => {
    expect(LARGE_DOC_UNDO_DELAY).toBeGreaterThan(DEFAULT_UNDO_DELAY)
  })
})
