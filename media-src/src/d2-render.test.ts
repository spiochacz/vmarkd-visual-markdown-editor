import { describe, it, expect } from 'vitest'
import { renderD2Graph, unsupportedReason, type Sizer } from './d2-render'
import type { D2Graph } from './d2-wasm'

// deterministic label sizer for tests (no Canvas): ~8px/char, 20px tall line
const sizer: Sizer = (t, fs = 16) => {
  const lines = String(t).split('\n')
  return {
    w: Math.max(1, ...lines.map((l) => l.length * (fs / 2))),
    h: lines.length * fs * 1.25,
  }
}

const empty = () => ({ isSequence: false, isGrid: false })
const g = (shapes: any[], edges: any[] = [], sequence = false): D2Graph =>
  ({ shapes, edges, sequence }) as D2Graph

describe('d2-render', () => {
  it('renders a->b to an <svg> with 2 boxes + 1 path', () => {
    const graph = g(
      [
        {
          id: 'a',
          idVal: 'a',
          label: 'a',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'b',
          idVal: 'b',
          label: 'b',
          shape: 'rectangle',
          special: empty(),
        },
      ],
      [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true }],
    )
    const svg = renderD2Graph(graph, sizer)
    expect(svg).toContain('<svg')
    expect((svg.match(/<rect/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(svg).toContain('<path')
    // currentColor theming (not baked black/white)
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).not.toContain('fill="#ffffff"')
  })

  it('nests a container as a compound node (child carries container)', () => {
    const graph = g([
      {
        id: 'box',
        idVal: 'box',
        label: 'box',
        shape: 'rectangle',
        special: empty(),
      },
      {
        id: 'box.a',
        idVal: 'a',
        label: 'a',
        shape: 'rectangle',
        container: 'box',
        special: empty(),
      },
    ])
    const svg = renderD2Graph(graph, sizer)
    expect(svg).toContain('<svg')
    expect((svg.match(/<rect/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('renders a circle as an <ellipse>', () => {
    const svg = renderD2Graph(
      g([
        { id: 'c', idVal: 'c', label: 'c', shape: 'circle', special: empty() },
      ]),
      sizer,
    )
    expect(svg).toContain('<ellipse')
  })

  it('renders a person as a head circle + body (not a plain rect)', () => {
    const svg = renderD2Graph(
      g([
        { id: 'u', idVal: 'u', label: 'u', shape: 'person', special: empty() },
      ]),
      sizer,
    )
    expect(svg).toContain('<circle')
    expect(svg).not.toContain('<rect')
  })

  it('renders a cloud as a path (not a plain rect)', () => {
    const svg = renderD2Graph(
      g([
        { id: 'c', idVal: 'c', label: 'c', shape: 'cloud', special: empty() },
      ]),
      sizer,
    )
    expect(svg).toContain('<path')
    expect(svg).not.toContain('<rect')
  })

  it('renders a queue as a horizontal-cylinder path (not a plain rect)', () => {
    const svg = renderD2Graph(
      g([
        { id: 'q', idVal: 'q', label: 'q', shape: 'queue', special: empty() },
      ]),
      sizer,
    )
    expect(svg).toContain('<path')
    expect(svg).not.toContain('<rect')
  })

  it('applies explicit fill + stroke + stroke-width + opacity (B styles)', () => {
    const svg = renderD2Graph(
      g([
        {
          id: 'x',
          idVal: 'x',
          label: 'x',
          shape: 'rectangle',
          fill: '#ff0000',
          stroke: '#0000ff',
          strokeWidth: '4',
          opacity: '0.5',
          special: empty(),
        },
      ]),
      sizer,
    )
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('stroke="#0000ff"')
    expect(svg).toContain('stroke-width="4"')
    expect(svg).toContain('opacity="0.5"')
  })

  it('renders a sql_table with header + column rows + constraint abbr (C)', () => {
    const svg = renderD2Graph(
      g([
        {
          id: 't',
          idVal: 't',
          label: 'users',
          shape: 'sql_table',
          columns: [
            { name: 'id', type: 'int', constraint: 'primary_key' },
            { name: 'email', type: 'varchar' },
          ],
          special: empty(),
        },
      ]),
      sizer,
    )
    expect(svg).toContain('users')
    expect(svg).toContain('id')
    expect(svg).toContain('email')
    expect(svg).toContain('PK')
  })

  it('renders a class with fields + methods + visibility tokens (C)', () => {
    const svg = renderD2Graph(
      g([
        {
          id: 'c',
          idVal: 'c',
          label: 'Animal',
          shape: 'class',
          fields: [{ name: 'name', type: 'string', visibility: 'public' }],
          methods: [{ name: 'speak()', type: 'void', visibility: 'private' }],
          special: empty(),
        },
      ]),
      sizer,
    )
    expect(svg).toContain('Animal')
    expect(svg).toContain('name')
    expect(svg).toContain('speak()')
    expect(svg).toContain('-') // private visibility token
  })

  it('lays grid-container children out in a grid (C)', () => {
    const svg = renderD2Graph(
      g([
        {
          id: 'grid',
          idVal: 'grid',
          label: 'grid',
          shape: 'rectangle',
          special: { isSequence: false, isGrid: true, gridColumns: '2' },
        },
        {
          id: 'grid.a',
          idVal: 'a',
          label: 'a',
          shape: 'rectangle',
          container: 'grid',
          special: empty(),
        },
        {
          id: 'grid.b',
          idVal: 'b',
          label: 'b',
          shape: 'rectangle',
          container: 'grid',
          special: empty(),
        },
        {
          id: 'grid.c',
          idVal: 'c',
          label: 'c',
          shape: 'rectangle',
          container: 'grid',
          special: empty(),
        },
      ]),
      sizer,
    )
    expect(svg).toContain('<svg')
    // container + 3 children rects
    expect((svg.match(/<rect/g) || []).length).toBeGreaterThanOrEqual(4)
  })
})

describe('unsupportedReason (faithful-by-construction guard)', () => {
  it('returns null for a plain graph', () => {
    expect(
      unsupportedReason(
        g([
          {
            id: 'a',
            idVal: 'a',
            label: 'a',
            shape: 'rectangle',
            special: empty(),
          },
        ]),
      ),
    ).toBeNull()
  })

  it('detects a top-level sequence_diagram (graph.sequence flag — root is not in shapes)', () => {
    const graph = g(
      [
        {
          id: 'alice',
          idVal: 'alice',
          label: 'alice',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'bob',
          idVal: 'bob',
          label: 'bob',
          shape: 'rectangle',
          special: empty(),
        },
      ],
      [{ src: 'alice', dst: 'bob', srcArrow: false, dstArrow: true }],
      true, // sequence
    )
    expect(unsupportedReason(graph)).toMatch(/sequence_diagram/)
  })

  it('detects a per-shape sequence diagram', () => {
    expect(
      unsupportedReason(
        g([
          {
            id: 's',
            idVal: 's',
            label: 's',
            shape: 'rectangle',
            special: { isSequence: true, isGrid: false },
          },
        ]),
      ),
    ).toMatch(/sequence_diagram/)
  })

  it('now SUPPORTS grid / sql_table / class (rendered, not fallback)', () => {
    expect(
      unsupportedReason(
        g([
          {
            id: 'gr',
            idVal: 'gr',
            label: 'gr',
            shape: 'rectangle',
            special: { isSequence: false, isGrid: true, gridRows: '2' },
          },
        ]),
      ),
    ).toBeNull()
    expect(
      unsupportedReason(
        g([
          {
            id: 't',
            idVal: 't',
            label: 't',
            shape: 'sql_table',
            special: empty(),
          },
        ]),
      ),
    ).toBeNull()
    expect(
      unsupportedReason(
        g([
          { id: 'k', idVal: 'k', label: 'k', shape: 'class', special: empty() },
        ]),
      ),
    ).toBeNull()
  })

  it('detects near positioning', () => {
    expect(
      unsupportedReason(
        g([
          {
            id: 'n',
            idVal: 'n',
            label: 'n',
            shape: 'rectangle',
            special: {
              isSequence: false,
              isGrid: false,
              nearKey: 'top-center',
            },
          },
        ]),
      ),
    ).toMatch(/near/)
  })
})
