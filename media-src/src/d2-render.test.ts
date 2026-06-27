import { describe, it, expect } from 'vitest'
import { simplifyRoute, straightenEnds } from './d2-geometry'
import {
  renderD2Graph,
  textShapeBox,
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

  it('renders a person as a silhouette path (not a plain rect)', () => {
    // d2 v0.7.1 lib/shape person = one head+shoulders outline path with the label below; NOT a rect,
    // and no longer the old crude head-circle + dome.
    const svg = renderD2Graph(
      g([
        { id: 'u', idVal: 'u', label: 'u', shape: 'person', special: empty() },
      ]),
      sizer,
    )
    expect(svg).toContain('<path')
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

  it('supports viewport-constant near, flags only relative near (task 126A)', () => {
    // A viewport constant (top-center, …) is now placed by toSVG → no longer unsupported.
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
    ).toBeNull()
    // The relative form (near: <shape-id>) is still Phase B → falls back to raw source.
    expect(
      unsupportedReason(
        g([
          {
            id: 'n',
            idVal: 'n',
            label: 'n',
            shape: 'rectangle',
            special: { isSequence: false, isGrid: false, nearKey: 'someShape' },
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

describe('arrowhead shapes (task 128)', () => {
  const edge = (head: any, dstArrow = true) =>
    ({
      W: 200,
      H: 200,
      nodes: [],
      edges: [
        {
          points: [
            [0, 0],
            [100, 0],
          ],
          srcArrow: false,
          dstArrow,
          dstArrowhead: head,
        },
      ],
      edgeStyle: 'orthogonal',
    }) as any

  it('default (no arrowhead object) draws a filled triangle polygon', () => {
    const svg = toSVG(edge(undefined))
    expect(svg).toContain('<polygon')
    expect(svg).toContain('fill="currentColor"')
  })

  it('circle arrowhead draws a <circle> glyph', () => {
    const svg = toSVG(edge({ shape: 'circle' }))
    expect(svg).toContain('<circle')
  })

  it("crow's-foot (cf-many) draws fan <line> strokes, not a triangle", () => {
    const svg = toSVG(edge({ shape: 'cf-many' }))
    expect((svg.match(/<line /g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('shape: none draws no arrowhead glyph', () => {
    // dstArrow true but arrowhead explicitly none → nothing drawn at the end
    const svg = toSVG(edge({ shape: 'none' }))
    expect(svg).not.toContain('<polygon')
    expect(svg).not.toContain('<circle')
  })

  it('renders the arrowhead cardinality label beside the endpoint', () => {
    const svg = toSVG(edge({ shape: 'cf-many', label: '*' }))
    expect(svg).toContain('>*<')
  })
})

describe('sql_table column FK routing (task 133)', () => {
  // Two side-by-side sql tables; an edge from users.col0 → orders.col1. toSVG must attach the route
  // to the COLUMN ROWS (header + index·rowH + rowH/2), not the table-box centre.
  const sqlNode = (id: string, x: number, cols: string[]) =>
    ({
      s: {
        id,
        idVal: id,
        label: id,
        shape: 'sql_table',
        columns: cols.map((name) => ({ name, type: 'int' })),
        special: { isSequence: false, isGrid: false },
      },
      x,
      y: 0,
      w: 150,
      h: 32 + cols.length * 26,
      kind: 'sql',
      sqlCols: [40, 40, 20],
    }) as any

  const layout = {
    W: 500,
    H: 200,
    nodes: [
      sqlNode('users', 0, ['id', 'name']),
      sqlNode('orders', 300, ['id', 'user_id']),
    ],
    edges: [
      {
        points: [
          [75, 50],
          [375, 50],
        ],
        srcArrow: false,
        dstArrow: true,
        src: 'users',
        dst: 'orders',
        srcColumnIndex: 0,
        dstColumnIndex: 1,
      },
    ],
    edgeStyle: 'orthogonal',
  } as any

  it('routes the FK edge to the destination column row Y (not the box centre)', () => {
    const svg = toSVG(layout)
    const pathD = svg.match(/<path d="([^"]+)" fill="none"/)?.[1] ?? ''
    // orders col1 row centre = y(0)+OFF(10) + HEADER_H(32) + 1*ROW_H(26) + ROW_H/2(13) = 81
    expect(pathD).toContain(',81.0')
    // users col0 row centre = 10 + 32 + 0 + 13 = 55
    expect(pathD).toContain(',55.0')
    // NOT the table-box centre (y = 10 + h/2 = 52 for users / 53 for orders)
    expect(pathD).not.toContain(',52.0')
  })
})

describe('near viewport-constant placement (task 126A)', () => {
  const base = (nearKey: string) =>
    ({
      shapes: [
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
        {
          id: 'title',
          idVal: 'title',
          label: 'Title',
          shape: 'rectangle',
          special: { isSequence: false, isGrid: false, nearKey },
        },
      ],
      edges: [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true }],
      sequence: false,
    }) as D2Graph

  it('renders the diagram WITH the pinned shape (no unsupported fallback)', () => {
    const svg = renderD2Graph(base('top-center'), sizer)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Title') // the pinned shape is drawn
    expect(svg).toContain('<path') // the a→b edge still drawn
  })

  it('pins a top-center shape ABOVE the laid-out graph', () => {
    // The title must sit at a smaller y than both laid-out nodes (it is excluded from layout and
    // placed above the content bbox).
    const svg = renderD2Graph(base('top-center'), sizer)
    const titleY = Number(
      svg.match(/<text x="-?[\d.]+" y="(-?[\d.]+)"[^>]*>Title</)?.[1] ?? 'NaN',
    )
    const otherYs = [
      ...svg.matchAll(/<text x="-?[\d.]+" y="(-?[\d.]+)"[^>]*>[ab]</g),
    ].map((m) => Number(m[1]))
    expect(Number.isFinite(titleY)).toBe(true)
    expect(otherYs.length).toBeGreaterThan(0)
    expect(titleY).toBeLessThan(Math.min(...otherYs))
  })
})

describe('layout direction (task 127)', () => {
  const chain = (direction?: string) =>
    ({
      shapes: [
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
      edges: [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true }],
      sequence: false,
      direction,
    }) as D2Graph

  // dagre path is synchronous + deterministic → assert the relative node geometry flips with direction.
  const centre = (svg: string, id: string) => {
    const m = svg.match(
      new RegExp(`<text x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*>${id}<`),
    )
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  }

  it('down (default) stacks a above b vertically', () => {
    const svg = renderD2Graph(chain('down'), sizer)
    const a = centre(svg, 'a')!
    const b = centre(svg, 'b')!
    expect(a.y).toBeLessThan(b.y)
  })

  it('right lays a left of b horizontally (rankdir LR)', () => {
    const svg = renderD2Graph(chain('right'), sizer)
    const a = centre(svg, 'a')!
    const b = centre(svg, 'b')!
    expect(a.x).toBeLessThan(b.x)
    expect(Math.abs(a.y - b.y)).toBeLessThan(10) // same row
  })

  it('up flips the vertical order (a below b, rankdir BT)', () => {
    const svg = renderD2Graph(chain('up'), sizer)
    const a = centre(svg, 'a')!
    const b = centre(svg, 'b')!
    expect(a.y).toBeGreaterThan(b.y)
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

describe('shape: text / code (task 124 #2)', () => {
  const node = (shape: string, label: string) =>
    g([{ id: 'n', idVal: 'n', label, shape, special: empty() }])

  it('renders shape:text as borderless prose (no box rect)', () => {
    const svg = renderD2Graph(node('text', 'hello world'), sizer)
    expect(svg).toContain('<text')
    expect(svg).toContain('<tspan')
    expect(svg).toContain('hello world')
    // borderless: a lone text shape draws no <rect>
    expect(svg.match(/<rect/g)).toBeNull()
  })

  it('renders a STYLED text shape with a box (real-d2 parity, not borderless)', () => {
    // d2 assigns shape:text to |md|/text labels with no explicit shape; a bare one is borderless,
    // but an explicit fill/stroke means the user wants a box (real d2 paints one). Regression: md-label
    // nodes with a class fill rendered as text only → invisible on a dark theme.
    const styled = g([
      {
        id: 'n',
        idVal: 'n',
        label: 'x',
        shape: 'text',
        fill: '#abcdef',
        stroke: '#123456',
        special: empty(),
      },
    ])
    const svg = renderD2Graph(styled, sizer)
    expect((svg.match(/<rect/g) || []).length).toBe(1) // a box behind the text
    expect(svg).toContain('fill="#abcdef"')
    expect(svg).toContain('stroke="#123456"')
    expect(svg).toContain('<tspan') // …text still drawn on top
  })

  it('renders shape:code as a monospace panel (one rect + mono font)', () => {
    const svg = renderD2Graph(node('code', 'const x = 1'), sizer)
    expect((svg.match(/<rect/g) || []).length).toBe(1) // the panel
    expect(svg).toContain('font-family="ui-monospace')
    expect(svg).toContain('const x = 1')
  })

  it('splits a multi-line label into one <tspan> per line', () => {
    const svg = renderD2Graph(node('code', 'line1\nline2\nline3'), sizer)
    expect((svg.match(/<tspan/g) || []).length).toBe(3)
    expect(svg).toContain('line1')
    expect(svg).toContain('line3')
  })

  it('text/code are not flagged unsupported', () => {
    expect(unsupportedReason(node('text', 'a'))).toBeNull()
    expect(unsupportedReason(node('code', 'a'))).toBeNull()
  })

  it('textShapeBox grows the box with line count', () => {
    const one = textShapeBox('code', 'x', sizer)
    const three = textShapeBox('code', 'x\nx\nx', sizer)
    expect(three.h).toBeGreaterThan(one.h)
  })

  it('textShapeBox code width scales with the longest line (monospace estimate)', () => {
    const short = textShapeBox('code', 'x', sizer)
    const long = textShapeBox('code', 'x'.repeat(40), sizer)
    expect(long.w).toBeGreaterThan(short.w)
  })
})

describe('connection styles (task 124 #1)', () => {
  const styledEdge = (style: any, dstArrow = true) =>
    ({
      W: 200,
      H: 200,
      nodes: [],
      edges: [
        {
          points: [
            [0, 0],
            [100, 0],
          ],
          srcArrow: false,
          dstArrow,
          style,
        },
      ],
      edgeStyle: 'orthogonal',
    }) as any

  it('applies stroke / width / dash from the edge style', () => {
    const svg = toSVG(
      styledEdge({ stroke: 'red', strokeWidth: '4', strokeDash: '3' }),
    )
    expect(svg).toContain('stroke="red"')
    expect(svg).toContain('stroke-width="4"')
    expect(svg).toContain('stroke-dasharray="3,3"')
  })

  it('keeps the theme default when the edge sets no style', () => {
    const svg = toSVG(styledEdge(undefined))
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('stroke-width="2"')
    expect(svg).not.toContain('d2-anim')
    expect(svg).not.toContain('@keyframes')
  })

  it('applies opacity', () => {
    expect(toSVG(styledEdge({ opacity: '0.5' }))).toContain('opacity="0.5"')
  })

  it('animated edge marches dashes via a reduced-motion-safe CSS class', () => {
    const svg = toSVG(styledEdge({ animated: true }))
    expect(svg).toContain('class="d2-anim"')
    expect(svg).toContain('@keyframes d2dash')
    expect(svg).toContain('prefers-reduced-motion')
    // a march needs a dash pattern even when the source set none
    expect(svg).toContain('stroke-dasharray="8,4"')
  })

  it('the arrowhead follows the edge stroke colour', () => {
    const svg = toSVG(styledEdge({ stroke: 'red' }))
    expect(svg).toContain('<polygon') // default dst arrowhead = filled triangle
    expect(svg).toContain('fill="red"')
  })
})

describe('shape tooltip / link / icon / image (task 124 #3 + #5)', () => {
  const node = (extra: any) =>
    g([
      {
        id: 'n',
        idVal: 'n',
        label: 'n',
        shape: 'rectangle',
        special: empty(),
        ...extra,
      },
    ])

  it('renders a <title> tooltip', () => {
    expect(renderD2Graph(node({ tooltip: 'hello tip' }), sizer)).toContain(
      '<title>hello tip</title>',
    )
  })

  it('wraps a node in <a href> for a safe link', () => {
    expect(
      renderD2Graph(node({ link: 'https://example.com' }), sizer),
    ).toContain('<a href="https://example.com">')
  })

  it('does NOT make a node clickable for a javascript: link (sanitized)', () => {
    const svg = renderD2Graph(node({ link: 'javascript:alert(1)' }), sizer)
    expect(svg).not.toContain('<a ')
    expect(svg).not.toContain('javascript:')
  })

  it('renders shape:image as a full <image> (no box rect)', () => {
    const svg = renderD2Graph(
      node({ shape: 'image', icon: 'data:image/png;base64,AAAA' }),
      sizer,
    )
    expect(svg).toContain('<image')
    expect(svg).toContain('data:image/png;base64,AAAA')
    expect(svg.match(/<rect/g)).toBeNull()
  })

  it('renders a decorative icon on top of a non-image shape', () => {
    const svg = renderD2Graph(
      node({ icon: 'data:image/png;base64,BBBB' }),
      sizer,
    )
    expect(svg).toContain('data:image/png;base64,BBBB')
    expect(svg).toContain('<rect') // the shape itself still drew; icon is decorative
  })
})
