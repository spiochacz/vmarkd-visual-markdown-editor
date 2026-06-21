import { describe, it, expect } from 'vitest'
import {
  renderD2Graph,
  simplifyRoute,
  straightenEnds,
  toSVG,
  unsupportedReason,
  type Sizer,
} from './d2-render'
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

describe('toSVG connection rendering (task 122 — rounded corners + endpoint trim)', () => {
  const mk = (points: number[][], dstArrow = true) =>
    ({
      W: 200,
      H: 200,
      nodes: [],
      edges: [{ points, srcArrow: false, dstArrow }],
      edgeStyle: 'orthogonal',
    }) as any

  it('rounds an orthogonal bend with a quadratic corner', () => {
    const svg = toSVG(
      mk([
        [0, 0],
        [0, 60],
        [60, 60],
      ]),
    )
    expect(svg).toContain('Q') // bend → rounded corner, not a hard L join
  })

  it('keeps a straight 2-point edge as a plain line (no corner)', () => {
    const svg = toSVG(
      mk([
        [0, 0],
        [80, 0],
      ]),
    )
    expect(svg).not.toContain('Q')
  })

  it('trims the line end back from the arrowhead endpoint', () => {
    // endpoint (60,60)+OFF(10) = 70,70; the stroke must stop SHORT of it (arrow stays at 70,70).
    const svg = toSVG(
      mk([
        [0, 0],
        [0, 60],
        [60, 60],
      ]),
    )
    const pathD = svg.match(/<path d="([^"]+)" fill="none"/)?.[1] ?? ''
    expect(pathD).not.toContain('70.0,70.0') // line was retracted; not drawn to the raw endpoint
    expect(svg).toContain('<polygon') // arrowhead still drawn (at the endpoint)
  })

  it('masks the connection line out from under an on-line label', () => {
    const svg = toSVG({
      W: 200,
      H: 200,
      nodes: [],
      edges: [
        {
          points: [
            [0, 0],
            [0, 100],
          ],
          srcArrow: false,
          dstArrow: true,
          label: 'lbl',
          lx: 0,
          ly: 50,
          lw: 30,
          lh: 16,
        },
      ],
      edgeStyle: 'orthogonal',
    } as any)
    expect(svg).toContain('<mask') // a label mask was emitted
    // the connection path references it (so the line is cut under the centred label)
    expect(svg).toMatch(
      /<path d="[^"]+" fill="none"[^>]*mask="url\(#vmarkd-d2lbl-/,
    )
  })
})

describe('simplifyRoute (task 122 — D2 deleteBends-style straightening)', () => {
  // a staircase: H, V, H, V, H — many interior bends
  const staircase = () => [
    [0, 0],
    [0, 10],
    [20, 10],
    [20, 20],
    [40, 20],
    [40, 30],
  ]

  it('straightens an interior staircase into fewer bends when the space is clear', () => {
    const out = simplifyRoute(staircase(), [])
    expect(out.length).toBeLessThan(staircase().length)
    expect(out[0]).toEqual([0, 0]) // endpoints preserved
    expect(out[out.length - 1]).toEqual([40, 30])
  })

  it('keeps the staircase when an obstacle blocks every straightened L', () => {
    const blocked = simplifyRoute(staircase(), [{ x: 5, y: 5, w: 40, h: 30 }])
    expect(blocked.length).toBe(staircase().length) // nothing removed — guard refused
  })

  it('drops collinear points', () => {
    const out = simplifyRoute(
      [
        [0, 0],
        [0, 10],
        [0, 20],
      ],
      [],
    )
    expect(out).toEqual([
      [0, 0],
      [0, 20],
    ])
  })

  // task 122: ELK routes a labelled edge through a side channel so its inline label clears a parallel
  // edge; an anchor on that channel must stop the straightener from pulling the line back off the label.
  it('keeps a label-bearing channel when an anchor sits on it', () => {
    // mostly-vertical (x=0) with a sideways excursion to x=40 in the middle (the label channel)
    const jog = (): number[][] => [
      [0, 0],
      [0, 40],
      [40, 40],
      [40, 60],
      [0, 60],
      [0, 100],
    ]
    // no anchor → the excursion straightens away to the bare vertical
    expect(simplifyRoute(jog(), []).length).toBeLessThan(6)
    // anchor on the channel → it (and the label's spot) is preserved
    const kept = simplifyRoute(jog(), [], [40, 50])
    expect(kept.length).toBe(6)
    expect(kept).toContainEqual([40, 40])
  })
})

describe('straightenEnds (task 122 — D2 deleteBends source/target S-shape removal)', () => {
  const box = { x: 0, y: 0, w: 40, h: 20 }

  it('straightens an endpoint port-attach S-jog when it stays on the border', () => {
    // attach at (10,20) on the box bottom, steps to channel x=25, then down — a tiny S near the box
    const sJog = [
      [10, 20],
      [10, 40],
      [25, 40],
      [25, 100],
    ]
    const out = straightenEnds(sJog, [box])
    // collapses to a straight vertical at x=25; attach point rides along the border to x=25
    expect(out).toEqual([
      [25, 20],
      [25, 100],
    ])
  })

  it('keeps the S-jog if straightening would slide the attach off the border', () => {
    // c.x=38 is past the box.x+w-10 margin → moving the attach there would detach → left alone
    const sJog = [
      [10, 20],
      [10, 40],
      [38, 40],
      [38, 100],
    ]
    expect(straightenEnds(sJog, [box]).length).toBe(4)
  })

  it('refuses to straighten through another box', () => {
    // blocker lies on the NEW segment (x=25, y≈25-35) that replaces the S, but not on the old S path
    const blocker = { x: 22, y: 25, w: 8, h: 10 }
    const sJog = [
      [10, 20],
      [10, 40],
      [25, 40],
      [25, 100],
    ]
    expect(straightenEnds(sJog, [box, blocker]).length).toBe(4)
  })

  it('keeps a large step (a real routing jog, not a pixel kink) even within the border', () => {
    // wide box: c.x=70 is well inside the border, but the 60px step is a genuine routing move — D2's
    // route-into-orders case. Collapsing it would re-attach near the corner instead of where ELK entered.
    const wide = { x: 0, y: 0, w: 100, h: 20 }
    const sJog = [
      [10, 20],
      [10, 40],
      [70, 40],
      [70, 100],
    ]
    expect(straightenEnds(sJog, [wide]).length).toBe(4)
  })
})
