import { describe, expect, it } from 'vitest'
import {
  STREAM_CHUNK_CHARS,
  buildDefMap,
  chunkize,
  definedIn,
  externalDefsFor,
  usedIn,
} from './stream-chunk'

// chunkize is the one safety-critical pure function: wrong boundaries would either
// lose/duplicate content (corruption) or split a code fence (the tail of the doc
// rendered as one giant code block). The full DOM-assembly correctness (assembled IR
// === monolithic) is validated separately by bench-refs-chunking.mjs.

const prose = (kb: number) =>
  'lorem ipsum dolor sit amet consectetur adipiscing elit\n\n'.repeat(
    Math.ceil((kb * 1024) / 55),
  )

const fenceCount = (s: string) => (s.match(/^```/gm) || []).length

describe('chunkize', () => {
  it('returns the doc unchanged as a single chunk when within the cap', () => {
    const md = prose(2) // < 4 KB
    expect(md.length).toBeLessThanOrEqual(STREAM_CHUNK_CHARS)
    expect(chunkize(md)).toEqual([md])
  })

  it('is lossless — concatenating the chunks reproduces the input exactly', () => {
    for (const md of [prose(50), prose(200), prose(13)]) {
      expect(chunkize(md).join('')).toBe(md)
    }
  })

  it('splits large docs into multiple chunks', () => {
    expect(chunkize(prose(50)).length).toBeGreaterThan(1)
  })

  it('never emits an empty chunk', () => {
    for (const chunk of chunkize(prose(60))) {
      expect(chunk.length).toBeGreaterThan(0)
    }
  })

  it('never leaves a chunk with a dangling (odd) code fence', () => {
    const block = `\`\`\`js\n${'const x = 1\n'.repeat(20)}\`\`\`\n\n`
    const md = block.repeat(40) // well over the cap, fences everywhere
    const chunks = chunkize(md)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(md) // still lossless
    for (const chunk of chunks) {
      expect(fenceCount(chunk) % 2).toBe(0) // balanced fences in every chunk
    }
  })

  it('handles a single line longer than the cap without looping or losing data', () => {
    const md = 'x'.repeat(STREAM_CHUNK_CHARS * 2 + 123) // no newline to cut on
    const chunks = chunkize(md)
    expect(chunks.join('')).toBe(md)
    expect(chunks.length).toBeGreaterThan(1)
  })
})

describe('reference-definition extraction', () => {
  const doc = [
    'Uses [a link][ref1] and a footnote[^fn1].',
    '',
    '[ref1]: https://example.com/1',
    '[^fn1]: footnote body',
    '    with a continuation line.',
    '',
    'A [Collapsed][] ref and a SHORTCUT-style.',
    '',
    '[collapsed]: https://example.com/c',
  ].join('\n')

  it('maps link and footnote defs (footnotes keyed with ^, continuation captured)', () => {
    const map = buildDefMap(doc)
    expect(map.get('ref1')).toBe('[ref1]: https://example.com/1')
    expect(map.get('collapsed')).toBe('[collapsed]: https://example.com/c')
    expect(map.get('^fn1')).toBe(
      '[^fn1]: footnote body\n    with a continuation line.',
    )
  })

  it('normalizes labels case-insensitively for use vs definition', () => {
    expect(usedIn('see [x][Ref1] here')).toContain('ref1')
    expect(definedIn('[REF1]: https://example.com/1')).toContain('ref1')
  })

  it('externalDefsFor injects only cited defs not defined in the chunk', () => {
    const map = buildDefMap(doc)
    // chunk cites ref1 + fn1 but defines neither → both are external
    const ext = externalDefsFor('Uses [a link][ref1] and a note[^fn1].', map)
    expect(ext.linkLabels).toEqual(new Set(['ref1']))
    expect(ext.fnLabels).toEqual(new Set(['^fn1']))
    expect(ext.text).toContain('[ref1]: https://example.com/1')
    expect(ext.text).toContain('[^fn1]: footnote body')
  })

  it('does not inject a def the chunk already defines itself', () => {
    const map = buildDefMap(doc)
    const ext = externalDefsFor(
      'Uses [a link][ref1].\n\n[ref1]: https://example.com/1',
      map,
    )
    expect(ext.text).toBe('')
    expect(ext.linkLabels.size).toBe(0)
  })
})
