import { describe, expect, it } from 'vitest'
import { escapeTableSpanPipes } from '../../src/table-pipe-escape'

// Lute splits GFM table cells on `|` BEFORE inline parsing, so a `|` inside an inline
// math (`$…$`) or code (`` `…` ``) span is mistaken for a column separator and the
// row is destroyed (Vditor #1904). The GFM-correct form escapes it as `\|`. This util
// repairs such rows on the way into Lute — but ONLY rows that are actually over-split
// (so currently-valid tables, incl. price tables, are never touched), and only when the
// escape restores the exact expected column count (so it can never make a row worse).

describe('escapeTableSpanPipes', () => {
  it('escapes a | inside inline math in a table cell (the #1904 bug)', () => {
    const md = '| m | n |\n| - | - |\n| $|x|$ | b |\n'
    expect(escapeTableSpanPipes(md)).toBe(
      '| m | n |\n| - | - |\n| $\\|x\\|$ | b |\n',
    )
  })

  it('escapes a | inside an inline code span in a table cell', () => {
    const md = '| m | n |\n| - | - |\n| `a|b` | c |\n'
    expect(escapeTableSpanPipes(md)).toBe(
      '| m | n |\n| - | - |\n| `a\\|b` | c |\n',
    )
  })

  it('leaves a correctly-celled price table untouched ($ is not always math)', () => {
    const md = '| a | b |\n| - | - |\n| $5 | $6 |\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('is idempotent — already-escaped pipes are not double-escaped', () => {
    const md = '| m | n |\n| - | - |\n| $\\|x\\|$ | b |\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('does NOT touch math/code OUTSIDE a table', () => {
    const md = 'A paragraph with $|x|$ and `a|b` inline.\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('does NOT touch a table-looking line inside a fenced code block', () => {
    const md = '```\n| $|x|$ | b |\n```\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('leaves an unrelated table completely unchanged', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n| x **y** | z |\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('repairs the header row too, and multiple math cells in a row', () => {
    const md = '| $|a|$ | $|b|$ |\n| - | - |\n| 1 | 2 |\n'
    expect(escapeTableSpanPipes(md)).toBe(
      '| $\\|a\\|$ | $\\|b\\|$ |\n| - | - |\n| 1 | 2 |\n',
    )
  })

  it('handles two separate tables in one document', () => {
    const md =
      '| m | n |\n| - | - |\n| $|x|$ | b |\n\nmid\n\n| p | q |\n| - | - |\n| `a|b` | c |\n'
    expect(escapeTableSpanPipes(md)).toBe(
      '| m | n |\n| - | - |\n| $\\|x\\|$ | b |\n\nmid\n\n| p | q |\n| - | - |\n| `a\\|b` | c |\n',
    )
  })

  it('does not change a $ that has no valid closing $ (lone dollar / price math)', () => {
    // over-split would-be repair: but there is no closeable math span, so leave as-is
    const md = '| a | b |\n| - | - |\n| $5 | $6 |\n'
    expect(escapeTableSpanPipes(md)).toBe(md)
  })

  it('returns input unchanged when there is no table at all', () => {
    expect(escapeTableSpanPipes('just text\nmore text\n')).toBe(
      'just text\nmore text\n',
    )
  })
})
