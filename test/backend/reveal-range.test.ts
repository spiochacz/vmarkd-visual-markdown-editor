import { describe, it, expect } from 'vitest'
import { selectionForOffset, selectionForLine } from '../../src/reveal-range'

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

describe('selectionForLine', () => {
  // Robust mapping for reveal-in-source: the webview reports the caret's line +
  // that line's text (measured against vditor.getValue()). The on-disk doc may
  // differ by Vditor's on-load reflow (blank lines after headings, quote
  // normalization), so prefer matching the line CONTENT in the real doc and fall
  // back to the reported line number.
  const doc =
    '# Title\n\nNo blank after heading.\nTight paragraph two.\n> a quote\n'

  it('finds the line by its content even when the reported index is off', () => {
    // webview said line 2 (its space had a blank line), but on disk the text is
    // on line 2 as well here; use a case where indices differ:
    const sel = selectionForLine(doc, 99, 'Tight paragraph two.')
    expect(sel.line).toBe(3) // actual line of that text in `doc`
    expect(sel.startChar).toBe(0)
    expect(sel.endChar).toBe('Tight paragraph two.'.length)
  })

  it('matches a heading line including its marker', () => {
    const sel = selectionForLine(doc, 0, '# Title')
    expect(sel.line).toBe(0)
    expect(sel.endChar).toBe('# Title'.length)
  })

  it('falls back to the reported line number when the content is not found', () => {
    const sel = selectionForLine(doc, 4, 'not present in the doc')
    expect(sel.line).toBe(4) // reported line, clamped
    expect(sel.endChar).toBe('> a quote'.length)
  })

  it('prefers an exact unique line match over a substring', () => {
    const t = 'alpha\nalphabet\nalpha\n'
    // reported line 2 → bias the search to the nearest matching line
    const sel = selectionForLine(t, 2, 'alpha')
    expect(sel.line).toBe(2) // the line-2 "alpha", not line 0
    expect(sel.endChar).toBe('alpha'.length)
  })

  it('clamps the fallback line to the last line', () => {
    const sel = selectionForLine('one\ntwo\n', 99, 'missing')
    expect(sel.line).toBe(2)
  })

  it('treats an empty lineText as a pure line-number selection', () => {
    const sel = selectionForLine('a\nb\nc\n', 1, '')
    expect(sel.line).toBe(1)
    expect(sel.endChar).toBe(1) // "b"
  })
})
