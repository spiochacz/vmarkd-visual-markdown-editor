import { describe, it, expect } from 'vitest'
import { selectionForOffset } from '../../src/reveal-range'

describe('selectionForOffset', () => {
  it('maps an offset on the first line to line 0, full-line range', () => {
    const text = 'hello world\nsecond line\n'
    expect(selectionForOffset(text, 3)).toEqual({
      line: 0,
      startChar: 0,
      endChar: 'hello world'.length,
    })
  })

  it('counts newlines before the offset to find the line', () => {
    const text = 'a\nbb\nccc\n'
    // offset 5 sits in "ccc" (a=0, \n=1, b=2,3, \n=4, c=5..)
    expect(selectionForOffset(text, 5)).toEqual({
      line: 2,
      startChar: 0,
      endChar: 3,
    })
  })

  it('selects the whole target line (endChar = that line length)', () => {
    const text = 'short\na longer line here\nx'
    const sel = selectionForOffset(text, 8) // inside the long line
    expect(sel.line).toBe(1)
    expect(sel.endChar).toBe('a longer line here'.length)
  })

  it('clamps a negative offset to line 0', () => {
    expect(selectionForOffset('abc\ndef', -5)).toEqual({
      line: 0,
      startChar: 0,
      endChar: 3,
    })
  })

  it('clamps an out-of-range offset to the last line', () => {
    const text = 'one\ntwo\nthree'
    expect(selectionForOffset(text, 999)).toEqual({
      line: 2,
      startChar: 0,
      endChar: 5, // "three"
    })
  })

  it('handles a trailing-newline document (caret on the empty last line)', () => {
    const text = 'line one\n'
    expect(selectionForOffset(text, 9)).toEqual({
      line: 1,
      startChar: 0,
      endChar: 0,
    })
  })
})
