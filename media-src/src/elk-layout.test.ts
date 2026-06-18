import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { layoutElk } from './elk-layout'
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
})
