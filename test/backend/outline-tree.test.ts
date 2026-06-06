import { describe, it, expect, beforeEach } from 'vitest'
import {
  MarkdownOutlineProvider,
  parseHeadings,
  type HeadingItem,
} from '../../src/outline-tree'
import { mock } from './vscode-mock'

function doc(text: string) {
  mock.setWorkspaceFolder('/workspace')
  return mock.createTextDocument('/workspace/test.md', text)
}

function tree(items: HeadingItem[]): any[] {
  return items.map((i) => ({
    name: i.heading,
    level: i.level,
    index: i.index,
    children: tree(i.children),
  }))
}

describe('parseHeadings', () => {
  beforeEach(() => mock.reset())

  it('finds ATX headings with their level, line, and ordinal index', () => {
    const h = parseHeadings(doc('# One\n\n## Two\n\n# Three\n') as any)
    expect(h).toEqual([
      { level: 1, name: 'One', line: 0, index: 0 },
      { level: 2, name: 'Two', line: 2, index: 1 },
      { level: 1, name: 'Three', line: 4, index: 2 },
    ])
  })

  it('skips ATX-looking lines inside fenced code blocks', () => {
    const h = parseHeadings(
      doc('# Real\n\n```\n# fake\n## also fake\n```\n\n## After\n') as any,
    )
    expect(h.map((x) => x.name)).toEqual(['Real', 'After'])
    // index stays contiguous over the real headings only
    expect(h.map((x) => x.index)).toEqual([0, 1])
  })

  it('handles ~~~ fences too', () => {
    const h = parseHeadings(doc('# A\n~~~\n# nope\n~~~\n# B\n') as any)
    expect(h.map((x) => x.name)).toEqual(['A', 'B'])
  })

  it('strips a closing ATX sequence', () => {
    const h = parseHeadings(doc('## Title ##\n') as any)
    expect(h[0].name).toBe('Title')
  })

  it('returns nothing for a heading-free document', () => {
    expect(parseHeadings(doc('plain text\nmore text\n') as any)).toEqual([])
  })
})

describe('MarkdownOutlineProvider tree', () => {
  beforeEach(() => mock.reset())

  it('nests deeper headings under shallower ones with correct indices', () => {
    const p = new MarkdownOutlineProvider()
    p.refresh(doc('# A\n## B\n### C\n## D\n# E\n') as any)
    expect(tree(p.getChildren())).toEqual([
      {
        name: 'A',
        level: 1,
        index: 0,
        children: [
          {
            name: 'B',
            level: 2,
            index: 1,
            children: [{ name: 'C', level: 3, index: 2, children: [] }],
          },
          { name: 'D', level: 2, index: 3, children: [] },
        ],
      },
      { name: 'E', level: 1, index: 4, children: [] },
    ])
  })

  it('exposes the current document uri and clears on undefined', () => {
    const p = new MarkdownOutlineProvider()
    p.refresh(doc('# X\n') as any)
    expect(p.uri?.toString()).toContain('test.md')
    expect(p.getChildren()).toHaveLength(1)
    p.refresh(undefined)
    expect(p.uri).toBeUndefined()
    expect(p.getChildren()).toHaveLength(0)
  })

  it('each heading item carries the reveal command with its index', () => {
    const p = new MarkdownOutlineProvider()
    p.refresh(doc('# A\n## B\n') as any)
    const [a] = p.getChildren()
    expect(a.command?.command).toBe('vmarkd.outlineReveal')
    expect(a.command?.arguments?.[0]).toBe(a)
    expect(a.children[0].index).toBe(1)
  })
})
