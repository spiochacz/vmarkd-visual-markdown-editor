import { describe, it, expect } from 'vitest'
import {
  mergeTableBlock,
  minimalDiffWriteback,
  splitBlocks,
} from '../../src/minimal-diff-writeback'

// A toy "reserialize" that mimics Vditor/Lute reflow: normalizes table-cell padding
// AND reproduces the task-60 bug — a space immediately before an inline marker
// (`**`, `*`, `` ` ``, `[`, `~~`) inside a cell is trimmed. Enough to exercise the
// unchanged-block + cell-level detection without loading Lute.
function fakeReserialize(block: string): string {
  const lines = block.split('\n')
  if (lines.length && lines.every((l) => l.trim().startsWith('|'))) {
    return lines
      .map((l) => {
        const cells = l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          // single-space padding + the task-60 marker-space trim
          .map((c) => c.trim().replace(/ (?=\*\*|\*|`|\[|~~)/g, ''))
        return `| ${cells.join(' | ')} |`
      })
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

// Cell-level table merge (task 60). The space-before-marker trim lives in Lute's
// parser, so an EDIT to one cell reflows the WHOLE table block and silently drops
// `x **y**` → `x**y**` in cells the user never touched. Block-level matching can't
// help (the block legitimately changed), so we recurse one level: keep the ORIGINAL
// bytes of rows/cells that are semantically unchanged, take the editor form only for
// the cells that actually changed.
describe('mergeTableBlock (task 60 — cell-level preservation)', () => {
  it('preserves the space before a marker in an UNCHANGED row when another row is edited', () => {
    const original = '| a | b |\n| - | - |\n| x **y** | keep |\n| p | q |'
    // user edits the last row p→P; the editor trims ` **` everywhere on save
    const next = '| a | b |\n| - | - |\n| x**y** | keep |\n| P | q |'
    const out = mergeTableBlock(original, next, fakeReserialize)
    expect(out).toContain('x **y**') // untouched row keeps its space verbatim
    expect(out).toContain('| P | q |') // edited row takes the editor form
  })

  it('preserves an unchanged CELL even when a SIBLING cell in the same row is edited', () => {
    const original = '| a | b |\n| - | - |\n| x **y** | keep |'
    // user edits cell-1 keep→KEEP (same row as the marker-space cell-0)
    const next = '| a | b |\n| - | - |\n| x**y** | KEEP |'
    const out = mergeTableBlock(original, next, fakeReserialize)
    expect(out).toContain('x **y**') // cell-0 space preserved (cell-level, not row)
    expect(out).toContain('KEEP') // cell-1 takes the edit
  })

  it('takes the editor form for a cell whose CONTENT genuinely changed', () => {
    const original = '| a |\n| - |\n| x **y** |'
    const next = '| a |\n| - |\n| x **z** |' // y→z is a real change (post-trim it differs)
    const reflowed = fakeReserialize(next) // what the editor actually emits
    const out = mergeTableBlock(original, reflowed, fakeReserialize)
    expect(out).toContain('x**z**') // genuinely-changed cell keeps the editor form
    expect(out).not.toContain('**y**')
  })

  it('falls back to the editor output when the table shape changes (row added)', () => {
    const original = '| a |\n| - |\n| x **y** |'
    const next = '| a |\n| - |\n| x**y** |\n| new |'
    const out = mergeTableBlock(original, next, fakeReserialize)
    expect(out).toBe(next) // differing row counts → no safe cell mapping
  })

  it('falls back when the column count differs', () => {
    const original = '| a | b |\n| - | - |\n| x **y** | z |'
    const next = '| a |\n| - |\n| x**y** |'
    const out = mergeTableBlock(original, next, fakeReserialize)
    expect(out).toBe(next)
  })

  it('is wired into minimalDiffWriteback: editing one cell keeps sibling rows intact', () => {
    const original =
      'Intro.\n\n| a | b |\n| - | - |\n| x **y** | keep |\n| p | q |\n\nOutro.\n'
    const next =
      'Intro.\n\n| a | b |\n| - | - |\n| x**y** | keep |\n| P | q |\n\nOutro.\n'
    const out = minimalDiffWriteback(original, next, fakeReserialize)
    expect(out).toContain('Intro.')
    expect(out).toContain('Outro.')
    expect(out).toContain('x **y**') // table block recursed: untouched row kept
    expect(out).toContain('| P | q |') // edited row reflowed
  })
})
