import { describe, it, expect } from 'vitest'
import { offsetToLine, getTableSourceOffset } from './source-map'

describe('offsetToLine', () => {
  it('returns 0 for an offset on the first line', () => {
    expect(offsetToLine('hello world', 5)).toBe(0)
  })
  it('counts newlines before the offset', () => {
    //            0          1            2
    const md = 'first\nsecond\nthird\n'
    expect(offsetToLine(md, 0)).toBe(0) // start of "first"
    expect(offsetToLine(md, 6)).toBe(1) // start of "second"
    expect(offsetToLine(md, 13)).toBe(2) // start of "third"
  })
  it('an offset at a newline char belongs to the line it ends', () => {
    // offset 5 is the '\n' after "first" → still line 0
    expect(offsetToLine('first\nsecond', 5)).toBe(0)
  })
  it('clamps a negative offset to line 0', () => {
    expect(offsetToLine('a\nb', -1)).toBe(0)
  })
  it('handles an offset past the end (last line)', () => {
    const md = 'a\nb\nc'
    expect(offsetToLine(md, 999)).toBe(2)
  })
})

describe('getTableSourceOffset', () => {
  // exact mapping: count pipes per row in the markdown source.
  const md = [
    'Intro paragraph.',
    '',
    '| H1 | H2 |',
    '| - | - |',
    '| a | b |',
    '',
  ].join('\n')

  it('maps the header cell (row 0, col 0) to just after its leading pipe', () => {
    // line 2 "| H1 | H2 |", first pipe at col 0 → cell content starts at col 1
    const off = getTableSourceOffset(md, { tableIndex: 0, row: 0, col: 0 })
    // absolute offset of line 2 start = len("Intro paragraph.\n\n") = 18
    expect(off).toBe(18 + 1)
  })
  it('maps the second column of the body row (skips the separator row)', () => {
    // DOM body row 1 → source row index 2 (header row 0, separator row skipped):
    // line "| a | b |". Contract: land just after the column's opening pipe
    // (col 1 = after the 2nd pipe), which sits inside the cell — exactly what
    // reveal-in-source needs.
    const off = getTableSourceOffset(md, { tableIndex: 0, row: 1, col: 1 })
    const line4Start = md.indexOf('| a | b |')
    const afterSecondPipe = '| a | b |'.indexOf('|', '| a '.length) + 1
    expect(off).toBe(line4Start + afterSecondPipe)
  })
  it('returns null when the table index is out of range', () => {
    expect(
      getTableSourceOffset(md, { tableIndex: 5, row: 0, col: 0 }),
    ).toBeNull()
  })
})
