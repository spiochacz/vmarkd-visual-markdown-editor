import { describe, it, expect } from 'vitest'
import { computeBlockMarkers, type BlockBox } from './diff-markers'
import type { DiffChange } from './diff-markers'

// computeBlockMarkers is the pure core of the git gutter: given each top-level
// block's text + geometry, the markdown source, and the diff changes, decide
// which blocks get a bar and of what type. Block→source mapping uses the same
// sample+indexOf trick as the cursor mapping; overlap picks the highest-priority
// change (removed > modified > added).
const md = [
  '# Title',
  '',
  'First paragraph.',
  '',
  'Second paragraph.',
  '',
].join('\n')

function box(text: string, top: number, height = 20): BlockBox {
  return { text, top, height }
}

describe('computeBlockMarkers', () => {
  it('returns no markers when there are no changes', () => {
    const blocks = [box('Title', 0), box('First paragraph.', 40)]
    expect(computeBlockMarkers(blocks, md, [])).toEqual([])
  })

  it('marks the block whose source lines overlap an added change', () => {
    // "Second paragraph." is on source line 4
    const blocks = [
      box('Title', 0),
      box('First paragraph.', 40),
      box('Second paragraph.', 80),
    ]
    const changes: DiffChange[] = [{ startLine: 4, endLine: 5, type: 'added' }]
    const markers = computeBlockMarkers(blocks, md, changes)
    expect(markers).toEqual([{ top: 80, height: 20, type: 'added' }])
  })

  it('marks the first paragraph for a change on its line', () => {
    const blocks = [box('First paragraph.', 40)]
    const changes: DiffChange[] = [{ startLine: 2, endLine: 3, type: 'added' }]
    expect(computeBlockMarkers(blocks, md, changes)).toEqual([
      { top: 40, height: 20, type: 'added' },
    ])
  })

  it('picks the highest-priority type when changes overlap a block', () => {
    const blocks = [box('First paragraph.', 40)]
    const changes: DiffChange[] = [
      { startLine: 2, endLine: 3, type: 'added' },
      { startLine: 2, endLine: 3, type: 'modified' },
    ]
    // modified (2) outranks added (1)
    expect(computeBlockMarkers(blocks, md, changes)[0].type).toBe('modified')
  })

  it('skips empty-text blocks and blocks that map nowhere', () => {
    const blocks = [box('   ', 0), box('not in the source at all', 40)]
    const changes: DiffChange[] = [{ startLine: 0, endLine: 9, type: 'added' }]
    expect(computeBlockMarkers(blocks, md, changes)).toEqual([])
  })
})
