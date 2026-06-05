import { describe, expect, it } from 'vitest'
import { createIncrementalMd } from './incremental-md'

// Fake serialize that models the key Lute properties the engine relies on:
//  - a single block serializes to its content + a trailing "\n"
//  - concatenated block HTML serializes with blocks joined by a blank line ("\n\n")
//    and a trailing "\n" — i.e. authoritative inter-block separators.
// Block HTML vocabulary: <p>text</p>, <h1>text</h1>, <hr/>. Text must not contain '<'.
function fakeSerialize(html: string): string {
  const re = /<(p|h1)>(.*?)<\/\1>|<(hr)\/>/g
  const out: string[] = []
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(html)) !== null) {
    if (m[3]) out.push('---')
    else if (m[1] === 'h1') out.push(`# ${m[2]}`)
    else out.push(m[2])
  }
  return out.length ? `${out.join('\n\n')}\n` : ''
}

const P = (t: string): string => `<p>${t}</p>`
const H = (t: string): string => `<h1>${t}</h1>`
const HR = '<hr/>'

// The invariant: after any update, the cache equals a full serialize of the current blocks.
function expectConsistent(
  engine: { markdown: string },
  blocks: readonly string[],
): void {
  expect(engine.markdown).toBe(fakeSerialize(blocks.join('')))
}

describe('createIncrementalMd', () => {
  it('baselines on first update (full serialize)', () => {
    const eng = createIncrementalMd(fakeSerialize)
    const blocks = [H('Title'), P('one'), P('two')]
    const md = eng.update(blocks)
    expect(md).toBe('# Title\n\none\n\ntwo\n')
    expectConsistent(eng, blocks)
  })

  it('handles an empty document', () => {
    const eng = createIncrementalMd(fakeSerialize)
    expect(eng.update([])).toBe('')
  })

  it('splices a single in-block edit', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('alpha'), P('beta'), P('gamma')])
    const next = [P('alpha'), P('beta CHANGED'), P('gamma')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('splices multiple (non-adjacent) in-block edits at once', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('a'), P('b'), P('c'), P('d')])
    const next = [P('a EDIT'), P('b'), P('c EDIT'), P('d')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('splices adjacent in-block edits', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('a'), P('b'), P('c'), P('d')])
    const next = [P('a'), P('b EDIT'), P('c EDIT'), P('d')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('handles a block growing and shrinking (range shift)', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('x'), P('y'), P('z')])
    let next = [P('x'), P('y much longer now'), P('z')]
    eng.update(next)
    expectConsistent(eng, next)
    next = [P('x'), P('y'), P('z')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('handles an Enter-split (1 block → 2)', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('one two three'), P('tail')])
    const next = [P('one two'), P('three'), P('tail')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('handles a Backspace-merge (2 blocks → 1)', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('one'), P('two'), P('tail')])
    const next = [P('one two'), P('tail')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it.each([
    ['start', (b: string[]) => [P('NEW'), ...b]],
    ['middle', (b: string[]) => [b[0], P('NEW'), b[1]]],
    ['end', (b: string[]) => [...b, P('NEW')]],
  ])('handles an insert at %s', (_label, build) => {
    const eng = createIncrementalMd(fakeSerialize)
    const base = [P('x'), P('y')]
    eng.update(base)
    const next = build(base)
    eng.update(next)
    expectConsistent(eng, next)
  })

  it.each([
    ['first', 0],
    ['middle', 1],
    ['last', 2],
  ])('handles a delete of the %s block', (_label, idx) => {
    const eng = createIncrementalMd(fakeSerialize)
    const base = [P('a'), P('b'), P('c')]
    eng.update(base)
    const next = base.filter((_, i) => i !== idx)
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('handles a multi-block paste', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('head'), P('tail')])
    const next = [P('head'), P('p1'), H('p2'), HR, P('p3'), P('tail')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('handles mixed block types and a structural edit among them', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([H('T'), P('intro'), HR, P('outro')])
    const next = [H('T'), P('intro EDIT'), P('inserted'), HR, P('outro')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('reset() rebaselines to the given blocks', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('a'), P('b')])
    const fresh = [H('New'), P('doc')]
    expect(eng.reset(fresh)).toBe('# New\n\ndoc\n')
    expectConsistent(eng, fresh)
  })

  it('invalidate() forces a full rebaseline on next update', () => {
    const eng = createIncrementalMd(fakeSerialize)
    eng.update([P('a'), P('b')])
    eng.invalidate()
    expect(eng.markdown).toBe('')
    const next = [P('c'), P('d'), P('e')]
    eng.update(next)
    expectConsistent(eng, next)
  })

  it('stays byte-exact under a deterministic fuzz of random edits', () => {
    const eng = createIncrementalMd(fakeSerialize)
    let seed = 987654321
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]
    let blocks: string[] = [H('Doc'), P('one'), P('two'), HR, P('three')]
    eng.update(blocks)
    let n = 0
    for (let i = 0; i < 3000; i++) {
      const op = pick(['edit', 'edit', 'split', 'merge', 'insert', 'delete'])
      const k = Math.floor(rnd() * blocks.length)
      if (op === 'edit') {
        if (blocks[k].startsWith('<p>'))
          blocks[k] = P(`w${n++} ${blocks[k].slice(3, -4)}`)
      } else if (op === 'split') {
        const inner = blocks[k].startsWith('<p>') ? blocks[k].slice(3, -4) : ''
        const parts = inner.split(' ')
        if (parts.length > 1) {
          const at = 1 + Math.floor(rnd() * (parts.length - 1))
          blocks.splice(
            k,
            1,
            P(parts.slice(0, at).join(' ')),
            P(parts.slice(at).join(' ')),
          )
        }
      } else if (op === 'merge') {
        if (
          k < blocks.length - 1 &&
          blocks[k].startsWith('<p>') &&
          blocks[k + 1].startsWith('<p>')
        ) {
          blocks.splice(
            k,
            2,
            P(`${blocks[k].slice(3, -4)} ${blocks[k + 1].slice(3, -4)}`),
          )
        }
      } else if (op === 'insert') {
        blocks.splice(k, 0, pick([P(`ins${n++}`), H(`Head ${n++}`), HR]))
      } else if (op === 'delete') {
        if (blocks.length > 2) blocks.splice(k, 1)
      }
      blocks = blocks.slice()
      eng.update(blocks)
      expect(eng.markdown).toBe(fakeSerialize(blocks.join('')))
    }
  })
})
