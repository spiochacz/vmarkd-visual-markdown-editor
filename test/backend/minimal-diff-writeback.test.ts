import { describe, it, expect } from 'vitest'
import {
  minimalDiffWriteback,
  splitBlocks,
} from '../../src/minimal-diff-writeback'

// A toy "reserialize" that mimics Vditor's reflow: pads table cells and adds a blank
// line after ATX headings — enough to exercise the unchanged-block detection without
// loading Lute. Returns the canonical (reflowed) form of a block.
function fakeReserialize(block: string): string {
  const lines = block.split('\n')
  // pad table rows: `| a | b |` → normalize to single-spaced canonical cells
  if (lines.every((l) => l.trim().startsWith('|'))) {
    return lines
      .map((l) =>
        l
          .trim()
          .replace(/\s*\|\s*/g, ' | ')
          .replace(/^\s*\|\s*/, '| ')
          .replace(/\s*\|\s*$/, ' |'),
      )
      .join('\n')
  }
  return block
}

describe('splitBlocks', () => {
  it('splits on blank lines', () => {
    expect(splitBlocks('a\n\nb\n\nc')).toEqual(['a', 'b', 'c'])
  })

  it('collapses runs of blank lines', () => {
    expect(splitBlocks('a\n\n\n\nb')).toEqual(['a', 'b'])
  })

  it('keeps a fenced code block with internal blank lines intact', () => {
    const md = 'para\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\nafter'
    expect(splitBlocks(md)).toEqual([
      'para',
      '```js\nconst a = 1\n\nconst b = 2\n```',
      'after',
    ])
  })

  it('returns [] for whitespace-only input', () => {
    expect(splitBlocks('\n\n  \n')).toEqual([])
  })
})

describe('minimalDiffWriteback', () => {
  it('keeps original bytes for blocks that only reflow (unchanged tables)', () => {
    // Original has a hand-written unpadded table; the editor reflows it to padded.
    const original =
      'Intro paragraph.\n\n|a|b|\n|-|-|\n|1|2|\n\nOutro paragraph.\n'
    const reflowed =
      'Intro paragraph.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nOutro paragraph.\n'
    const out = minimalDiffWriteback(original, reflowed, fakeReserialize)
    // The padded table must NOT be written — the original unpadded bytes win.
    expect(out).toContain('|a|b|')
    expect(out).not.toContain('| a | b |')
    expect(out).toBe(original)
  })

  it('writes the editor form for a genuinely changed block, keeps the rest verbatim', () => {
    const original =
      'First paragraph stays.\n\n|a|b|\n|-|-|\n|1|2|\n\nThird paragraph stays.\n'
    // user edited the middle table cell 1→9; editor reflows (pads) it
    const next =
      'First paragraph stays.\n\n| a | b |\n| - | - |\n| 9 | 2 |\n\nThird paragraph stays.\n'
    const out = minimalDiffWriteback(original, next, fakeReserialize)
    expect(out).toContain('First paragraph stays.')
    expect(out).toContain('Third paragraph stays.')
    expect(out).toContain('| 9 | 2 |') // the changed block takes the editor form
    // unchanged prose blocks kept verbatim (no churn)
    const lines = out.split('\n')
    expect(lines[0]).toBe('First paragraph stays.')
  })

  it('keeps an edited prose paragraph (editor form) but not the untouched ones', () => {
    const original =
      'Para A long enough to matter.\n\nPara B unchanged here.\n\nPara C unchanged here.\n'
    const next =
      'Para A long enough to matter EDITED.\n\nPara B unchanged here.\n\nPara C unchanged here.\n'
    const out = minimalDiffWriteback(original, next, fakeReserialize)
    expect(out).toBe(next) // prose doesn't reflow → equals editor output anyway
    expect(out).toContain('EDITED.')
  })

  it('falls back to the editor output when reserialize is unavailable', () => {
    const original = '|a|b|\n|-|-|\n|1|2|\n'
    const next = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const out = minimalDiffWriteback(original, next, () => undefined)
    expect(out).toBe(next)
  })

  it('preserves the original trailing-newline shape', () => {
    const original = 'one\n\ntwo' // no trailing newline
    const next = 'one\n\ntwo\n' // editor added one
    const out = minimalDiffWriteback(original, next, fakeReserialize)
    expect(out.endsWith('two')).toBe(true)
    expect(out.endsWith('two\n')).toBe(false)
  })
})
