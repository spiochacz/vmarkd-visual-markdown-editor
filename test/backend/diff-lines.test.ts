import { describe, it, expect } from 'vitest'
import { computeDiffChanges } from '../../src/diff-lines'

// computeDiffChanges maps a git-HEAD vs current line diff into block-ish change
// ranges the webview renders as gutter bars. Contract (ported from notemd, but
// on our own pure LCS line-diff — no `diff` dependency, which wouldn't ship since
// node_modules is .vscodeignore'd):
//   - inserted lines  → { startLine, endLine, type: 'added' }   (current-doc lines)
//   - deleted lines   → a { type: 'modified' } marker at the preceding current line
//   - unchanged lines advance the current-line cursor
// Line numbers are 0-based and index into the CURRENT document.
describe('computeDiffChanges', () => {
  it('reports no changes for identical content', () => {
    const text = 'a\nb\nc\n'
    expect(computeDiffChanges(text, text)).toEqual([])
  })

  it('flags a pure insertion as added on the new lines', () => {
    const head = 'a\nc\n'
    const current = 'a\nb\nc\n' // inserted "b" at line 1
    expect(computeDiffChanges(head, current)).toEqual([
      { startLine: 1, endLine: 2, type: 'added' },
    ])
  })

  it('flags appended lines as added at the end', () => {
    const head = 'a\n'
    const current = 'a\nb\nc\n'
    expect(computeDiffChanges(head, current)).toEqual([
      { startLine: 1, endLine: 3, type: 'added' },
    ])
  })

  it('flags a deletion as modified at the preceding current line', () => {
    const head = 'a\nb\nc\n'
    const current = 'a\nc\n' // deleted "b"
    expect(computeDiffChanges(head, current)).toEqual([
      { startLine: 0, endLine: 1, type: 'modified' },
    ])
  })

  it('flags a deletion at the very start as modified on line 0', () => {
    const head = 'x\na\nb\n'
    const current = 'a\nb\n' // deleted leading "x"
    expect(computeDiffChanges(head, current)).toEqual([
      { startLine: 0, endLine: 1, type: 'modified' },
    ])
  })

  it('treats a changed line as a delete+add (modified + added)', () => {
    const head = 'a\nB\nc\n'
    const current = 'a\nb\nc\n' // "B" → "b"
    const changes = computeDiffChanges(head, current)
    // an edited line shows as the removed-old (modified marker) and added-new
    expect(changes).toContainEqual({ startLine: 1, endLine: 2, type: 'added' })
    expect(changes.some((c) => c.type === 'modified')).toBe(true)
  })
})
