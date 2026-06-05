import { describe, it, expect } from 'vitest'
import {
  undoDelayForContentLength,
  DEFAULT_UNDO_DELAY,
  LARGE_DOC_UNDO_DELAY,
  LARGE_DOC_CHARS,
  INCREMENTAL_MIN_BLOCKS,
  useIncrementalSerialize,
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

describe('useIncrementalSerialize (task 69 gate)', () => {
  it('is on only in IR mode at/above the block threshold', () => {
    expect(useIncrementalSerialize('ir', INCREMENTAL_MIN_BLOCKS)).toBe(true)
    expect(useIncrementalSerialize('ir', INCREMENTAL_MIN_BLOCKS + 500)).toBe(
      true,
    )
  })

  it('is off below the block threshold', () => {
    expect(useIncrementalSerialize('ir', INCREMENTAL_MIN_BLOCKS - 1)).toBe(
      false,
    )
    expect(useIncrementalSerialize('ir', 0)).toBe(false)
  })

  it('is off in non-IR modes regardless of size', () => {
    expect(
      useIncrementalSerialize('wysiwyg', INCREMENTAL_MIN_BLOCKS + 1000),
    ).toBe(false)
    expect(useIncrementalSerialize('sv', 100_000)).toBe(false)
    expect(useIncrementalSerialize(undefined, 100_000)).toBe(false)
  })
})
