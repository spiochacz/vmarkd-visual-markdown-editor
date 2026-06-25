// Layout-quality regression net for the D2 ELK refinement pipeline (task 122). It replays refineLayout +
// toSVG over FROZEN raw-ELK layouts (media-src/src/__fixtures__/d2-raw-layouts.json — captured once from
// layoutElk so the test is deterministic and needs no WASM/ELK/browser) and asserts the quality invariants
// we tune by eye: a fixed drawn-crossing count, and ZERO of every overlap class (label-on-label,
// label-on-box, edge-through/along-box, edge-on-edge). This is the safety net for ANY future refactor of
// the refine passes — it catches a quality regression in CI instead of by inspecting renders.
//
// Regenerating the fixture (only when layoutElk/elk config itself changes): run tmp/d2-compare/dump-layouts.mjs.
import { describe, expect, it } from 'vitest'
import { __test, refineLayout } from './d2-refine'
import type { Layout, PlacedNode } from './d2-render'
import { toSVG } from './d2-render'
import raw from './__fixtures__/d2-raw-layouts.json'

const fixtures = raw as unknown as Record<string, Layout>
const { countCrossings } = __test

// Expected drawn crossings per diagram (the canonical values these layouts settle to). Overlaps must be 0.
const EXPECT: Record<string, number> = {
  microservices: 3,
  dataplatform: 1,
  oauth: 2,
  netmesh: 1,
}

const isLeaf = (n: PlacedNode) => n.kind !== 'container' && n.kind !== 'grid'

// An axis-aligned edge segment that pierces a leaf interior it isn't connected to, or runs collinear along
// any node's side — the "line on a box" defect.
function lineOnBox(layout: Layout): number {
  const leaves = layout.nodes.filter(isLeaf)
  let hits = 0
  for (const e of layout.edges) {
    const p = e.points
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i]
      const b = p[i + 1]
      const vert = Math.abs(a[0] - b[0]) < 0.6
      const horiz = Math.abs(a[1] - b[1]) < 0.6
      if (!vert && !horiz) continue
      for (const B of leaves) {
        if (B.s.id === e.src || B.s.id === e.dst) continue
        const L = B.x + 4
        const R = B.x + B.w - 4
        const T = B.y + 4
        const Bot = B.y + B.h - 4
        if (R <= L || Bot <= T) continue
        if (vert && a[0] > L && a[0] < R) {
          const ov =
            Math.min(Math.max(a[1], b[1]), Bot) -
            Math.max(Math.min(a[1], b[1]), T)
          if (ov > 2) hits++
        } else if (horiz && a[1] > T && a[1] < Bot) {
          const ov =
            Math.min(Math.max(a[0], b[0]), R) -
            Math.max(Math.min(a[0], b[0]), L)
          if (ov > 2) hits++
        }
      }
      for (const B of layout.nodes) {
        if (B.kind === 'grid' || B.s.id === e.src || B.s.id === e.dst) continue
        const L = B.x
        const R = B.x + B.w
        const T = B.y
        const Bot = B.y + B.h
        if (vert) {
          const ov =
            Math.min(Math.max(a[1], b[1]), Bot) -
            Math.max(Math.min(a[1], b[1]), T)
          if (ov > 10 && (Math.abs(a[0] - L) < 2.5 || Math.abs(a[0] - R) < 2.5))
            hits++
        } else {
          const ov =
            Math.min(Math.max(a[0], b[0]), R) -
            Math.max(Math.min(a[0], b[0]), L)
          if (
            ov > 10 &&
            (Math.abs(a[1] - T) < 2.5 || Math.abs(a[1] - Bot) < 2.5)
          )
            hits++
        }
      }
    }
  }
  return hits
}

// Two axis-aligned segments from DIFFERENT edges drawn collinear and overlapping — two lines on each other.
function lineOnLine(layout: Layout): number {
  type S = { ei: number; vert: boolean; c: number; lo: number; hi: number }
  const segs: S[] = []
  layout.edges.forEach((e, ei) => {
    const p = e.points
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i]
      const b = p[i + 1]
      if (Math.abs(a[0] - b[0]) < 0.6)
        segs.push({
          ei,
          vert: true,
          c: a[0],
          lo: Math.min(a[1], b[1]),
          hi: Math.max(a[1], b[1]),
        })
      else if (Math.abs(a[1] - b[1]) < 0.6)
        segs.push({
          ei,
          vert: false,
          c: a[1],
          lo: Math.min(a[0], b[0]),
          hi: Math.max(a[0], b[0]),
        })
    }
  })
  let hits = 0
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]
      const t = segs[j]
      if (s.ei === t.ei || s.vert !== t.vert || Math.abs(s.c - t.c) > 2)
        continue
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 4) hits++
    }
  return hits
}

// Label boxes (the SVG mask's black rects = final, post-deconfliction positions).
function labelRects(svg: string) {
  return [
    ...svg.matchAll(
      /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="black"\/>/g,
    ),
  ].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }))
}
function rectOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: typeof a,
  tol: number,
) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > tol && oy > tol
}
function labelOnLabel(svg: string): number {
  const r = labelRects(svg)
  let hits = 0
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++)
      if (rectOverlap(r[i], r[j], 1)) hits++
  return hits
}
function labelOnBox(svg: string, layout: Layout): number {
  const r = labelRects(svg)
  const leaves = layout.nodes.filter(isLeaf)
  let hits = 0
  for (const lr of r)
    for (const B of leaves)
      if (rectOverlap(lr, { x: B.x, y: B.y, w: B.w, h: B.h }, 2)) {
        hits++
        break
      }
  return hits
}

describe('d2 refine layout quality (frozen raw-ELK fixtures)', () => {
  for (const id of Object.keys(EXPECT)) {
    it(`${id}: crossings stable, zero overlaps`, () => {
      const layout = JSON.parse(JSON.stringify(fixtures[id])) as Layout
      refineLayout(layout)
      const svg = toSVG(layout)
      expect(countCrossings(layout), 'drawn crossings').toBe(EXPECT[id])
      expect(lineOnBox(layout), 'edge on/through a box').toBe(0)
      expect(lineOnLine(layout), 'edge collinear with another edge').toBe(0)
      expect(labelOnLabel(svg), 'label overlapping a label').toBe(0)
      expect(labelOnBox(svg, layout), 'label overlapping a box').toBe(0)
    })
  }
})

// task 123 #4 — the unified per-pass guard contract. Every refine pass now guards crossings AND
// collinear-overlap AND container-wall, so NO single pass may raise any of those metrics (before, some
// passes guarded only crossings and a later pass cleaned up the mess by luck — deleteBendsEndpoints left a
// collinear that rerouteBackEdges happened to fix, deOvershoot hugged a container wall that detourContainers
// happened to undo). This replays the pipeline through refineLayout's `__refineTrace` seam and asserts the
// invariant pass-by-pass. (Guards the per-pass *property*; the per-diagram final values are above.)
describe('d2 refine per-pass guard invariant (task 123 #4)', () => {
  for (const id of Object.keys(EXPECT)) {
    it(`${id}: no pass raises crossings / edge-on-box / edge-on-edge`, () => {
      const layout = JSON.parse(JSON.stringify(fixtures[id])) as Layout
      const rows: { name: string; cross: number; box: number; line: number }[] =
        [
          {
            name: '(raw)',
            cross: countCrossings(layout),
            box: lineOnBox(layout),
            line: lineOnLine(layout),
          },
        ]
      const g = globalThis as { __refineTrace?: (n: string, l: Layout) => void }
      g.__refineTrace = (name, l) =>
        rows.push({
          name,
          cross: countCrossings(l),
          box: lineOnBox(l),
          line: lineOnLine(l),
        })
      try {
        refineLayout(layout)
      } finally {
        g.__refineTrace = undefined
      }
      for (let i = 1; i < rows.length; i++) {
        const cur = rows[i]
        const prev = rows[i - 1]
        expect(
          cur.cross,
          `${cur.name} must not raise crossings`,
        ).toBeLessThanOrEqual(prev.cross)
        expect(
          cur.box,
          `${cur.name} must not raise edge-on-box`,
        ).toBeLessThanOrEqual(prev.box)
        expect(
          cur.line,
          `${cur.name} must not raise edge-on-edge`,
        ).toBeLessThanOrEqual(prev.line)
      }
    })
  }
})
