import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { elkDirectionConfig, layoutElk } from './elk-layout'
import { alignRows, spreadCrampedRows } from './d2-refine'
import type { D2Graph } from './d2-wasm'
import type { Sizer } from './d2-render'

const require = createRequire(import.meta.url)

// Build the SAME main-thread ELK (elk-api + the in-process fake worker) the webview bundle assembles
// in elk-entry.ts — no Web Worker, runs in node. Proves the fake-worker path works off the webview.
function makeElk(): any {
  const ELK = require('../vendor/elk/elk-api.js').default
  const worker = require('../vendor/elk/elk-worker.min.js')
  const FakeWorker = worker.Worker || worker.default
  return new ELK({ workerFactory: (url: string) => new FakeWorker(url) })
}

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

describe('elk-layout (main-thread fake worker)', () => {
  let elk: any
  beforeAll(() => {
    elk = makeElk()
  })

  it('boots the fake worker and lays out a flat graph with orthogonal edge sections', async () => {
    const graph = g(
      [
        {
          id: 'a',
          idVal: 'a',
          label: 'A',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'b',
          idVal: 'b',
          label: 'B',
          shape: 'rectangle',
          special: empty(),
        },
      ],
      [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true }],
    )
    const layout = await layoutElk(graph, sizer, elk)
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edgeStyle).toBe('orthogonal')
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.edges[0].points.length).toBeGreaterThanOrEqual(2)
  })

  // Regression: an intra-container edge must be declared on its LCA container and offset by that
  // container's absolute origin. The earlier bug dumped every edge on root → INCLUDE_CHILDREN
  // mis-routed intra-container edges to the origin (top-left), stranding the edge + its label.
  it('places an intra-container edge INSIDE its container (not stranded at the origin)', async () => {
    const graph = g(
      [
        {
          id: 'top',
          idVal: 'top',
          label: 'Top',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'box',
          idVal: 'box',
          label: 'Box',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'box.a',
          idVal: 'a',
          label: 'A',
          shape: 'rectangle',
          container: 'box',
          special: empty(),
        },
        {
          id: 'box.b',
          idVal: 'b',
          label: 'B',
          shape: 'rectangle',
          container: 'box',
          special: empty(),
        },
      ],
      [
        // cross edge (LCA = root) forces 'box' down, so its top is well below y=0
        { src: 'top', dst: 'box.a', srcArrow: false, dstArrow: true },
        // intra-container edge (LCA = box) — the one the regression stranded at the origin
        {
          src: 'box.a',
          dst: 'box.b',
          srcArrow: false,
          dstArrow: true,
          label: 'IN',
        },
      ],
    )
    const layout = await layoutElk(graph, sizer, elk)

    const box = layout.nodes.find((n) => n.s.id === 'box')!
    const a = layout.nodes.find((n) => n.s.id === 'box.a')!
    expect(box.kind).toBe('container')
    expect(box.y).toBeGreaterThan(0) // pushed below 'top'
    // child sits inside the container
    expect(a.x).toBeGreaterThanOrEqual(box.x - 1)
    expect(a.y).toBeGreaterThanOrEqual(box.y - 1)

    const intra = layout.edges.find((e) => e.label === 'IN')!
    expect(intra).toBeTruthy()
    const M = 8 // small slack for orthogonal routing along the container edge
    for (const [px, py] of intra.points) {
      expect(px).toBeGreaterThanOrEqual(box.x - M)
      expect(px).toBeLessThanOrEqual(box.x + box.w + M)
      expect(py).toBeGreaterThanOrEqual(box.y - M)
      expect(py).toBeLessThanOrEqual(box.y + box.h + M)
    }
  })

  // task 122: a labelled edge is handed to ELK with a SIZED label so the layered pass reserves a gap
  // for it. Proof = the inter-layer gap is wider WITH a (tall) label than without — i.e. ELK made room
  // instead of us dropping the text on the route. The label position then comes from ELK.
  it('reserves layer space for an edge label (variant A)', async () => {
    const a = {
      id: 'a',
      idVal: 'a',
      label: 'A',
      shape: 'rectangle',
      special: empty(),
    }
    const b = {
      id: 'b',
      idVal: 'b',
      label: 'B',
      shape: 'rectangle',
      special: empty(),
    }
    const withLabel = (label?: string) =>
      g(
        [a, b],
        [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true, label }],
      )
    const gap = (layout: any) => {
      const na = layout.nodes.find((n: any) => n.s.id === 'a')!
      const nb = layout.nodes.find((n: any) => n.s.id === 'b')!
      return nb.y - (na.y + na.h)
    }
    const plain = await layoutElk(withLabel(undefined), sizer, elk)
    const labelled = await layoutElk(
      withLabel('a fairly long edge label'),
      sizer,
      elk,
    )
    // ELK widened the gap to fit the label dummy node
    expect(gap(labelled)).toBeGreaterThan(gap(plain))
    // and the label is emitted with a position
    const e = labelled.edges.find(
      (x: any) => x.label === 'a fairly long edge label',
    )!
    expect(e).toBeTruthy()
    expect(typeof e.lx).toBe('number')
    expect(typeof e.ly).toBe('number')
  })

  // task 127: a `direction: right` graph lays a→b→c out LEFT-TO-RIGHT (x increases along the chain,
  // shared row), vs the default DOWN where y increases. Exercised through the real ELK engine.
  it('lays a right-direction chain out horizontally (task 127)', async () => {
    const chain = (direction?: string) =>
      ({
        ...g(
          [
            {
              id: 'a',
              idVal: 'a',
              label: 'A',
              shape: 'rectangle',
              special: empty(),
            },
            {
              id: 'b',
              idVal: 'b',
              label: 'B',
              shape: 'rectangle',
              special: empty(),
            },
            {
              id: 'c',
              idVal: 'c',
              label: 'C',
              shape: 'rectangle',
              special: empty(),
            },
          ],
          [
            { src: 'a', dst: 'b', srcArrow: false, dstArrow: true },
            { src: 'b', dst: 'c', srcArrow: false, dstArrow: true },
          ],
          false,
        ),
        direction,
      }) as D2Graph
    const down = await layoutElk(chain('down'), sizer, elk)
    const right = await layoutElk(chain('right'), sizer, elk)
    const at = (l: any, id: string) => l.nodes.find((n: any) => n.s.id === id)!
    // DOWN: a above c (y grows). RIGHT: a left of c (x grows), roughly same row.
    expect(at(down, 'a').y).toBeLessThan(at(down, 'c').y)
    expect(at(right, 'a').x).toBeLessThan(at(right, 'c').x)
    expect(Math.abs(at(right, 'a').y - at(right, 'c').y)).toBeLessThan(20)
  })

  // task 128 / 133: the per-end arrowhead shape/label + sql column indices ride the ELK path through
  // to the PlacedEdge so toSVG can draw the right glyph / attach to a row.
  it('threads arrowhead shapes + column indices through the ELK edge (tasks 128/133)', async () => {
    const graph = g(
      [
        {
          id: 'a',
          idVal: 'a',
          label: 'A',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'b',
          idVal: 'b',
          label: 'B',
          shape: 'rectangle',
          special: empty(),
        },
      ],
      [
        {
          src: 'a',
          dst: 'b',
          srcArrow: false,
          dstArrow: true,
          dstArrowhead: { shape: 'cf-many', label: '*' },
          srcColumnIndex: 2,
          dstColumnIndex: 1,
        },
      ],
    )
    const layout = await layoutElk(graph, sizer, elk)
    const e = layout.edges.find((x: any) => x.src === 'a')!
    expect(e.dstArrowhead).toEqual({ shape: 'cf-many', label: '*' })
    expect(e.srcColumnIndex).toBe(2)
    expect(e.dstColumnIndex).toBe(1)
  })

  // task 126A: a viewport-pinned near shape is excluded from the ELK layout but still returned as a
  // PlacedNode (flagged `near`) for toSVG to position.
  it('excludes near-constant shapes from layout but returns them flagged (task 126A)', async () => {
    const graph = g(
      [
        {
          id: 'a',
          idVal: 'a',
          label: 'A',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'b',
          idVal: 'b',
          label: 'B',
          shape: 'rectangle',
          special: empty(),
        },
        {
          id: 'title',
          idVal: 'title',
          label: 'Title',
          shape: 'rectangle',
          special: { isSequence: false, isGrid: false, nearKey: 'top-center' },
        },
      ],
      [{ src: 'a', dst: 'b', srcArrow: false, dstArrow: true }],
    )
    const layout = await layoutElk(graph, sizer, elk)
    const title = layout.nodes.find((n: any) => n.s.id === 'title')!
    expect(title.near).toBe('top-center')
    expect(title.x).toBe(0) // not positioned by ELK (toSVG places it)
    expect(title.y).toBe(0)
  })
})

describe('alignRows (task 122 — snap mixed-height rows to a common centre-Y)', () => {
  const node = (id: string, y: number, h: number) => ({
    s: { id },
    x: 0,
    y,
    w: 40,
    h,
    kind: 'leaf',
  })

  it('snaps two grouped leaves to a shared centre-Y', () => {
    const layout: any = {
      W: 200,
      H: 200,
      edgeStyle: 'orthogonal',
      // a (cy=120) and b (cy=140) are within 40 → one row; c (cy=200) is separate
      nodes: [node('a', 100, 40), node('b', 120, 40), node('c', 180, 40)],
      edges: [
        {
          points: [
            [20, 140],
            [20, 200],
          ],
          srcArrow: false,
          dstArrow: true,
        },
      ],
    }
    alignRows(layout)
    const cy = (n: any) => n.y + n.h / 2
    expect(cy(layout.nodes[0])).toBe(cy(layout.nodes[1])) // a and b now share a row
  })

  it('leaves container children alone', () => {
    const layout: any = {
      W: 200,
      H: 200,
      edgeStyle: 'orthogonal',
      nodes: [
        { ...node('x', 100, 40) },
        {
          s: { id: 'y', container: 'box' },
          x: 0,
          y: 130,
          w: 40,
          h: 40,
          kind: 'leaf',
        },
      ],
      edges: [],
    }
    alignRows(layout)
    expect(layout.nodes[1].y).toBe(130) // container child untouched
  })
})

describe('spreadCrampedRows (task 122 — push rows apart for a jammed horizontal edge)', () => {
  // a leaf box "low" (top=100) with an edge whose interior horizontal segment runs at y=90 — only 10px
  // above the box top (< CLEAR 16), x-overlapping it → cramped. Expect the box pushed down so the gap
  // reaches TARGET (24); the segment itself must NOT move (only rows below the boundary shift).
  const crampedLayout = (): any => ({
    W: 300,
    H: 300,
    edgeStyle: 'orthogonal',
    nodes: [{ s: { id: 'low' }, x: 80, y: 100, w: 60, h: 40, kind: 'leaf' }],
    edges: [
      {
        srcArrow: false,
        dstArrow: true,
        points: [
          [50, 50],
          [50, 90],
          [150, 90], // horizontal segment at y=90 (10px above the box top at 100)
          [150, 130],
          [150, 200],
        ],
      },
    ],
  })

  it('pushes the jammed lower row down to TARGET clearance, leaving the segment in place', () => {
    const layout = crampedLayout()
    const h0 = layout.H
    spreadCrampedRows(layout)
    // box pushed down by need = 24 - (100 - 90) = 14
    expect(layout.nodes[0].y).toBe(114)
    // segment untouched (it sits above the boundary)
    expect(layout.edges[0].points[1][1]).toBe(90)
    expect(layout.edges[0].points[2][1]).toBe(90)
    // the box-side points (below the boundary) follow down by 14
    expect(layout.edges[0].points[3][1]).toBe(144)
    expect(layout.edges[0].points[4][1]).toBe(214)
    expect(layout.H).toBe(h0 + 14)
  })

  it('is a no-op when no horizontal segment is cramped against a box', () => {
    const layout: any = {
      W: 300,
      H: 300,
      edgeStyle: 'orthogonal',
      // box top at 200 is far below the y=90 segment → not cramped
      nodes: [{ s: { id: 'low' }, x: 80, y: 200, w: 60, h: 40, kind: 'leaf' }],
      edges: [
        {
          srcArrow: false,
          dstArrow: true,
          points: [
            [50, 50],
            [50, 90],
            [150, 90],
            [150, 130],
            [150, 160],
          ],
        },
      ],
    }
    spreadCrampedRows(layout)
    expect(layout.nodes[0].y).toBe(200)
    expect(layout.H).toBe(300)
  })

  it('grows a container that straddles the push boundary', () => {
    const layout = crampedLayout()
    // a container wrapping the jammed box (spans 80..180, boundary at 100 is inside it)
    layout.nodes.push({
      s: { id: 'box' },
      x: 70,
      y: 80,
      w: 100,
      h: 100,
      kind: 'container',
    })
    spreadCrampedRows(layout)
    const box = layout.nodes.find((n: any) => n.s.id === 'box')
    expect(box.y).toBe(80) // top above the boundary → not shifted
    expect(box.h).toBe(114) // grown by 14 to keep wrapping the moved child
  })
})

describe('elkDirectionConfig (task 127 — direction → ELK ports)', () => {
  it('defaults to DOWN for missing/unknown direction (out SOUTH / in NORTH)', () => {
    for (const d of [undefined, 'down', 'bogus']) {
      expect(elkDirectionConfig(d)).toEqual({
        DIR: 'DOWN',
        isHoriz: false,
        outSide: 'SOUTH',
        inSide: 'NORTH',
      })
    }
  })

  it('maps up/right/left to flipped axes', () => {
    expect(elkDirectionConfig('up')).toMatchObject({
      DIR: 'UP',
      isHoriz: false,
      outSide: 'NORTH',
      inSide: 'SOUTH',
    })
    expect(elkDirectionConfig('right')).toMatchObject({
      DIR: 'RIGHT',
      isHoriz: true,
      outSide: 'EAST',
      inSide: 'WEST',
    })
    expect(elkDirectionConfig('left')).toMatchObject({
      DIR: 'LEFT',
      isHoriz: true,
      outSide: 'WEST',
      inSide: 'EAST',
    })
  })

  it('out and in are always opposite sides (an edge spans the node)', () => {
    const opp: Record<string, string> = {
      NORTH: 'SOUTH',
      SOUTH: 'NORTH',
      EAST: 'WEST',
      WEST: 'EAST',
    }
    for (const d of ['down', 'up', 'left', 'right']) {
      const c = elkDirectionConfig(d)
      expect(opp[c.outSide]).toBe(c.inSide)
    }
  })
})
