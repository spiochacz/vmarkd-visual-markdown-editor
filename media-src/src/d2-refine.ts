// D2 ELK layout refinement (task 122). After ELK lays out the graph (elk-layout.ts → layoutElk), this
// pipeline of post-process passes cleans the routes to match D2's own output: adaptive inter-layer gaps,
// row spreading, edge monotonization, bend/overshoot collapse, container detours, channel alignment,
// same-label sibling bundling, a back-edge A* reroute, and final label placement. Every pass mutates the
// shared `Layout` in place and is guarded so it never increases the drawn crossing count. The passes were
// developed and validated in tmp/d2-compare (harness2.ts + run67.mjs) and baked here verbatim.
import { labelAnchor } from './d2-render'
import type { Layout, PlacedEdge, PlacedNode } from './d2-render'
import { alignRows, spreadCrampedRows } from './elk-layout'

type Pt = [number, number] | number[]

const isLeaf = (n: PlacedNode) => n.kind !== 'container' && n.kind !== 'grid'

// --- shared geometry helpers (segment crossing + a layout-wide crossing counter) ---
const dccw = (a: Pt, b: Pt, c: Pt) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
function segsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = dccw(p3, p4, p1)
  const d2 = dccw(p3, p4, p2)
  const d3 = dccw(p1, p2, p3)
  const d4 = dccw(p1, p2, p4)
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
}
// Count crossings between the polyline segments of all edges (skip same-edge pairs). The guard every pass
// uses: a pass keeps a candidate change only if it does not raise this count.
function countCrossings(layout: Layout): number {
  const segs: [Pt, Pt, number][] = []
  layout.edges.forEach((e, ei) => {
    const p = e.points
    for (let i = 0; i + 1 < p.length; i++) segs.push([p[i], p[i + 1], ei])
  })
  let c = 0
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i][2] === segs[j][2]) continue
      if (segsCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) c++
    }
  return c
}

// task 122: adaptive inter-layer vertical spacing. ELK reserves a huge gap between EVERY layer (158–450px
// observed) — mostly EMPTY vertical space around the inline edge-labels + routing channels — which makes
// stacked-layer pipelines absurdly tall (dataplatform 589×2687). This pass reclaims that slack: cluster
// leaves into rows by centre-Y, and for each inter-row gap remove the EMPTY space down to what the gap's
// actual horizontal routing channels need (~CHAN_SP per stacked lane + a base margin).
//
// WHY the previous metric was wrong: it sized gaps by crossCount (every edge whose y-range straddles the
// midline — i.e. pass-through verticals too). A vertical passing straight through needs HORIZONTAL room
// (nodeNode/edgeNode spacing), NOT a taller gap, so counting them ballooned every busy gap to MAX. And the
// tighten guard froze any gap with ≥1 channel at its bloated size, so nothing ever compressed.
//
// WHY this is crossing-safe: we never move two "occupied" y-levels (a row edge or a horizontal channel)
// closer than MARGIN. We split each gap into the EMPTY bands between consecutive occupied levels and remove
// slack only from those bands (largest first), each kept ≥ MARGIN. Shrinking empty vertical space between
// parallel horizontal channels keeps them parallel and ≥ MARGIN apart; verticals crossing the gap merely
// shorten — no segment that didn't cross before can start crossing. Applied as a step function of y (same
// machinery as spreadCrampedRows). A final countCrossings guard reverts the whole pass as cheap insurance.
function adaptiveLayerGaps(layout: Layout): void {
  const BASE = 56 // base margin a gap keeps regardless of channel count
  const CHAN_SP = 44 // vertical room reserved per stacked horizontal routing channel
  const MIN = 56
  const MAX = 320
  const MARGIN = 40 // never bring two occupied y-levels (row edge / channel) closer than this
  const ROWTOL = 36 // centre-Y proximity to be the same row (matches alignRows' 40)
  const HMINLEN = 24 // a horizontal segment this long counts as a routing channel (vs. a short attach jog)
  const leaves = layout.nodes.filter(isLeaf)
  if (leaves.length < 2) return
  const rows: { cy: number; top: number; bot: number; items: PlacedNode[] }[] =
    []
  for (const n of [...leaves].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = n.y + n.h / 2
    const r = rows.find((r) => Math.abs(r.cy - cy) < ROWTOL)
    if (r) {
      r.items.push(n)
      r.cy = (r.cy * (r.items.length - 1) + cy) / r.items.length
      r.top = Math.min(r.top, n.y)
      r.bot = Math.max(r.bot, n.y + n.h)
    } else rows.push({ cy, top: n.y, bot: n.y + n.h, items: [n] })
  }
  rows.sort((a, b) => a.cy - b.cy)
  if (rows.length < 2) return
  // Distinct y-levels of every horizontal segment strictly inside (top,bot). `longOnly` keeps only real
  // routing channels (≥HMINLEN) for SIZING the gap; the full set (longOnly=false) marks every occupied
  // level so band compression never squishes even a short attach jog into a neighbour.
  const horizLevels = (top: number, bot: number, longOnly: boolean) => {
    const ys: number[] = []
    for (const e of layout.edges) {
      const p = e.points
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i]
        const b = p[i + 1]
        if (Math.abs(a[1] - b[1]) > 0.5) continue // horizontal only
        if (longOnly && Math.abs(a[0] - b[0]) < HMINLEN) continue
        if (a[1] <= top + 0.5 || a[1] >= bot - 0.5) continue // must be inside the band
        if (!ys.some((y) => Math.abs(y - a[1]) < 8)) ys.push(a[1])
      }
    }
    return ys.sort((x, y) => x - y)
  }
  const labelInGap = (top: number, bot: number) =>
    layout.edges.some(
      (e) => e.ly != null && e.ly > top + 0.5 && e.ly < bot - 0.5,
    )
  const LABEL_FLOOR = 56 // keep this much room when a label sits in the gap
  // Container walls are occupied levels too: a channel must not be compressed flush against a container's
  // top/bottom wall (the "line along the container side" defect). The strip just INSIDE a top wall holds
  // the container title + padding (~44px baked in elk-layout) and just inside a bottom wall holds padding
  // (~24px) — keep those bands at least that tall so a channel never lands on the wall or over the title.
  const TOPPAD = 46
  const BOTPAD = 28
  const cTop = layout.nodes
    .filter((n) => n.kind === 'container')
    .map((n) => n.y)
  const cBot = layout.nodes
    .filter((n) => n.kind === 'container')
    .map((n) => n.y + n.h)
  const events: { y: number; d: number }[] = []
  for (let i = 0; i + 1 < rows.length; i++) {
    const cur = rows[i].bot
    const nxt = rows[i + 1].top
    const gap = nxt - cur
    if (gap <= 1) continue
    const ch = horizLevels(cur, nxt, true).length
    let want = Math.max(MIN, Math.min(MAX, BASE + CHAN_SP * ch))
    if (labelInGap(cur, nxt)) want = Math.max(want, LABEL_FLOOR)
    if (want >= gap) {
      // Rare: the gap is already tighter than its channels need → widen via a single midline step.
      const d = Math.round(want - gap)
      if (d >= 2) events.push({ y: (cur + nxt) / 2, d })
      continue
    }
    // Compress: remove (gap − want) of EMPTY space, distributed across the empty bands between occupied
    // levels (largest band first). Occupied levels = the row boundaries, every horizontal channel, AND any
    // container wall inside the gap. Each band keeps a floor (MARGIN normally; TOPPAD/BOTPAD for the
    // title/padding strip just inside a container wall) so no two occupied levels collapse together.
    let slack = gap - want
    const levels: { y: number; top: boolean; bot: boolean }[] = [
      { y: cur, top: false, bot: false },
      ...horizLevels(cur, nxt, false).map((y) => ({
        y,
        top: false,
        bot: false,
      })),
      ...cTop
        .filter((y) => y > cur + 0.5 && y < nxt - 0.5)
        .map((y) => ({ y, top: true, bot: false })),
      ...cBot
        .filter((y) => y > cur + 0.5 && y < nxt - 0.5)
        .map((y) => ({ y, top: false, bot: true })),
      { y: nxt, top: false, bot: false },
    ].sort((a, b) => a.y - b.y)
    // Merge levels within 1px (a channel coinciding with a wall) so a band is never degenerate.
    const merged: { y: number; top: boolean; bot: boolean }[] = []
    for (const lv of levels) {
      const last = merged[merged.length - 1]
      if (last && Math.abs(last.y - lv.y) < 1) {
        last.top = last.top || lv.top
        last.bot = last.bot || lv.bot
      } else merged.push({ ...lv })
    }
    const bands: { lo: number; hi: number; floor: number }[] = []
    for (let k = 0; k + 1 < merged.length; k++) {
      let floor = MARGIN
      if (merged[k].top) floor = Math.max(floor, TOPPAD) // band just below a container top wall = title strip
      if (merged[k + 1].bot) floor = Math.max(floor, BOTPAD) // band just above a container bottom wall = padding
      bands.push({ lo: merged[k].y, hi: merged[k + 1].y, floor })
    }
    bands.sort((a, b) => b.hi - b.lo - (a.hi - a.lo))
    for (const band of bands) {
      if (slack < 2) break
      const take = Math.min(slack, Math.max(0, band.hi - band.lo - band.floor))
      if (take < 2) continue
      events.push({ y: (band.lo + band.hi) / 2, d: -Math.round(take) })
      slack -= take
    }
  }
  if (!events.length) return
  // Step function of y: a coordinate at/below an event boundary moves by that event's Δ (cumulative).
  const shift = (y: number) =>
    events.reduce((s, ev) => s + (ev.y <= y + 0.5 ? ev.d : 0), 0)
  // A container straddling a boundary grows/shrinks by the Δ inside it so it keeps wrapping its children.
  const inside = (top: number, bot: number) =>
    events.reduce(
      (s, ev) => s + (ev.y > top + 0.5 && ev.y < bot - 0.5 ? ev.d : 0),
      0,
    )
  // Snapshot for an exact restore — band compression is crossing-safe by construction, but the (imperfect)
  // row/channel detection could in principle draw a new crossing; revert wholesale if so. (A replay with
  // negated Δ would NOT restore exactly: the step function is position-dependent and positions just moved.)
  const before = countCrossings(layout)
  const snapNy = layout.nodes.map((n) => n.y)
  const snapNh = layout.nodes.map((n) => n.h)
  const snapEy = layout.edges.map((e) => e.points.map((pt) => pt[1]))
  const snapLy = layout.edges.map((e) => e.ly)
  const snapH = layout.H
  for (const n of layout.nodes) {
    const top = n.y
    n.y += shift(top)
    if (n.kind === 'container') n.h += inside(top, top + n.h)
  }
  for (const e of layout.edges) {
    for (const pt of e.points) pt[1] += shift(pt[1])
    if (e.ly != null) e.ly += shift(e.ly)
  }
  layout.H += events.reduce((s, ev) => s + ev.d, 0)
  if (countCrossings(layout) > before) {
    layout.nodes.forEach((n, i) => {
      n.y = snapNy[i]
      n.h = snapNh[i]
    })
    layout.edges.forEach((e, i) => {
      e.points.forEach((pt, j) => {
        pt[1] = snapEy[i][j]
      })
      e.ly = snapLy[i]
    })
    layout.H = snapH
  }
}

// task 122: make each edge's Y-profile monotonic toward its destination. The step-function Y-shifts in
// adaptiveLayerGaps/spreadCrampedRows can pull an edge's lower jog point above its upper one (a backward
// "up" vertical → the cqrs command/query zigzag over Client). Clamp every interior point so y never
// reverses, then drop collinear/dup points. Per-edge guard: revert if it adds a crossing or pushes a
// segment onto another box / along a box border / along another edge.
function monotonizeEdges(layout: Layout): void {
  const leaves = layout.nodes.filter(isLeaf)
  const segHitsBox = (a: Pt, b: Pt, skip: (string | undefined)[]) =>
    leaves.some((B) => {
      if (skip.includes(B.s.id)) return false
      const x1 = B.x
      const y1 = B.y
      const x2 = B.x + B.w
      const y2 = B.y + B.h
      const ins = (q: Pt) =>
        q[0] > x1 + 0.5 && q[0] < x2 - 0.5 && q[1] > y1 + 0.5 && q[1] < y2 - 0.5
      if (ins(a) || ins(b)) return true
      const c1: Pt = [x1, y1]
      const c2: Pt = [x2, y1]
      const c3: Pt = [x2, y2]
      const c4: Pt = [x1, y2]
      return (
        segsCross(a, b, c1, c2) ||
        segsCross(a, b, c2, c3) ||
        segsCross(a, b, c3, c4) ||
        segsCross(a, b, c4, c1)
      )
    })
  const simplify = (pts: Pt[]) => {
    const out: Pt[] = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1]
      const cur = pts[i]
      const next = pts[i + 1]
      if (Math.abs(cur[0] - prev[0]) < 0.5 && Math.abs(cur[1] - prev[1]) < 0.5)
        continue // dup
      if (Math.abs(prev[0] - cur[0]) < 0.5 && Math.abs(cur[0] - next[0]) < 0.5)
        continue // vertical collinear
      if (Math.abs(prev[1] - cur[1]) < 0.5 && Math.abs(cur[1] - next[1]) < 0.5)
        continue // horizontal collinear
      out.push(cur)
    }
    out.push(pts[pts.length - 1])
    return out
  }
  const xov = (a1: number, a2: number, b1: number, b2: number) =>
    Math.min(a2, b2) - Math.max(a1, b1) > 4
  // count horizontal segs running ALONG a box border (segHitsBox only catches interior crossings)
  const borderRuns = (pts: Pt[]) => {
    let c = 0
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (Math.abs(a[1] - b[1]) > 1 || Math.abs(a[0] - b[0]) < 6) continue
      const y = a[1]
      const x1 = Math.min(a[0], b[0])
      const x2 = Math.max(a[0], b[0])
      for (const n of layout.nodes) {
        if (
          (Math.abs(y - n.y) < 4 || Math.abs(y - (n.y + n.h)) < 4) &&
          xov(x1, x2, n.x, n.x + n.w)
        ) {
          c++
          break
        }
      }
    }
    return c
  }
  // count horizontal segs running ALONG another edge's horizontal seg (collinear overlap)
  const edgeRuns = (pts: Pt[], self: PlacedEdge) => {
    let c = 0
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (Math.abs(a[1] - b[1]) > 1 || Math.abs(a[0] - b[0]) < 6) continue
      const y = a[1]
      const x1 = Math.min(a[0], b[0])
      const x2 = Math.max(a[0], b[0])
      for (const e2 of layout.edges) {
        if (e2 === self) continue
        const q = e2.points
        for (let j = 0; j + 1 < q.length; j++) {
          if (Math.abs(q[j][1] - q[j + 1][1]) > 1) continue
          if (Math.abs(q[j][1] - y) < 2 && xov(x1, x2, q[j][0], q[j + 1][0])) {
            c++
            break
          }
        }
      }
    }
    return c
  }
  for (const e of layout.edges) {
    const p = e.points
    if (p.length < 4) continue
    const down = p[0][1] <= p[p.length - 1][1]
    let mono = true
    for (let i = 1; i < p.length; i++)
      if (down ? p[i][1] < p[i - 1][1] - 0.5 : p[i][1] > p[i - 1][1] + 0.5) {
        mono = false
        break
      }
    if (mono) continue
    const base = countCrossings(layout)
    const baseBR = borderRuns(p)
    const baseER = edgeRuns(p, e)
    const snap = p.map((q) => q.slice() as Pt)
    const destY = p[p.length - 1][1]
    let run = p[0][1]
    for (let i = 1; i < p.length - 1; i++) {
      let y = p[i][1]
      if (down) y = Math.min(Math.max(y, run), destY)
      else y = Math.max(Math.min(y, run), destY)
      p[i][1] = y
      run = y
    }
    e.points = simplify(p) as PlacedEdge['points']
    let bad = countCrossings(layout) > base
    if (!bad && borderRuns(e.points) > baseBR) bad = true
    if (!bad && edgeRuns(e.points, e) > baseER) bad = true
    for (let i = 0; i + 1 < e.points.length && !bad; i++)
      if (segHitsBox(e.points[i], e.points[i + 1], [e.src, e.dst])) bad = true
    if (bad) e.points = snap as PlacedEdge['points']
  }
}

// Port of D2's deleteBends 2nd pass (d2elklayout/layout.go #1030): collapse the "ladders" (staircases
// ┌─┘┌─) ELK emits into single L-corners. Only ever moves INTERIOR route points — never the first/last —
// so box ports stay where ELK placed them. Committed only if it doesn't add box intersections or edge
// crossings (D2's guards). task 122.
function deleteBendsEndpoints(layout: Layout): void {
  const leaves = layout.nodes.filter(isLeaf)
  const segHitsBox = (a: Pt, b: Pt, B: PlacedNode) => {
    const x1 = B.x
    const y1 = B.y
    const x2 = B.x + B.w
    const y2 = B.y + B.h
    const inside = (p: Pt) => p[0] > x1 && p[0] < x2 && p[1] > y1 && p[1] < y2
    if (inside(a) || inside(b)) return true
    const c1: Pt = [x1, y1]
    const c2: Pt = [x2, y1]
    const c3: Pt = [x2, y2]
    const c4: Pt = [x1, y2]
    return (
      segsCross(a, b, c1, c2) ||
      segsCross(a, b, c2, c3) ||
      segsCross(a, b, c3, c4) ||
      segsCross(a, b, c4, c1)
    )
  }
  const objIntersects = (
    a: Pt,
    b: Pt,
    srcId?: string,
    dstId?: string,
  ): number => {
    let c = 0
    for (const B of leaves) {
      if (B.s.id === srcId || B.s.id === dstId) continue
      if (segHitsBox(a, b, B)) c++
    }
    return c
  }
  const edgeCross = (a: Pt, b: Pt, self: PlacedEdge): number => {
    let c = 0
    for (const e of layout.edges) {
      if (e === self) continue
      const p = e.points
      for (let i = 0; i + 1 < p.length; i++)
        if (segsCross(a, b, p[i], p[i + 1])) c++
    }
    return c
  }
  // shared-corner counts: a bend shared by two edges merges them, so leave those alone
  const pc = new Map<string, number>()
  for (const e of layout.edges)
    for (const p of e.points) {
      const k = `${Math.round(p[0])},${Math.round(p[1])}`
      pc.set(k, (pc.get(k) || 0) + 1)
    }
  for (const e of layout.edges) {
    const R = e.points
    if (R.length < 6) continue // need before+ladder+after, all interior
    if (e.src === e.dst) continue
    for (let i = 1; i < R.length - 3; i++) {
      const before = R[i - 1]
      const start = R[i]
      const corner = R[i + 1]
      const end = R[i + 2]
      const after = R[i + 3]
      if (
        (pc.get(`${Math.round(corner[0])},${Math.round(corner[1])}`) || 0) > 1
      )
        continue
      let newCorner: Pt
      if (Math.round(start[0]) === Math.round(corner[0])) {
        newCorner = [end[0], start[1]]
        if (end[0] > start[0] !== start[0] > before[0]) continue // not a ladder
        if (end[1] > start[1] !== after[1] > end[1]) continue
      } else {
        newCorner = [start[0], end[1]]
        if (end[1] > start[1] !== start[1] > before[1]) continue
        if (end[0] > start[0] !== after[0] > end[0]) continue
      }
      const oldI =
        objIntersects(start, corner, e.src, e.dst) +
        objIntersects(corner, end, e.src, e.dst)
      const newI =
        objIntersects(start, newCorner, e.src, e.dst) +
        objIntersects(newCorner, end, e.src, e.dst)
      if (newI > oldI) continue
      const oldC = edgeCross(start, corner, e) + edgeCross(corner, end, e)
      const newC = edgeCross(start, newCorner, e) + edgeCross(newCorner, end, e)
      if (newC > oldC) continue
      e.points = [
        ...R.slice(0, i),
        newCorner,
        ...R.slice(i + 3),
      ] as PlacedEdge['points']
      break
    }
  }
}

// task 122 (Option 2): remove an x-OVERSHOOT in an interior H-V-H subpath whose two horizontals run in
// OPPOSITE x-directions (ELK sometimes routes a left-bound edge briefly RIGHT then sweeps back). Collapse
// the bump to a single L so the edge approaches monotonically. Interior only (ports untouched). Guard:
// keep a collapse only if it adds no crossing, hits no box, and doesn't land COLLINEAR on another edge.
// Among the valid candidates, pick the one that runs PARALLEL-and-close to a same-label sibling LONGEST.
function deOvershoot(layout: Layout): void {
  const leaves = layout.nodes.filter(isLeaf)
  const hitsBox = (a: Pt, b: Pt) =>
    leaves.some((n) => {
      const M = 4
      const x1 = n.x - M
      const y1 = n.y - M
      const x2 = n.x + n.w + M
      const y2 = n.y + n.h + M
      if (Math.abs(a[0] - b[0]) < 0.5) {
        const x = a[0]
        if (x <= x1 || x >= x2) return false
        const lo = Math.min(a[1], b[1])
        const hi = Math.max(a[1], b[1])
        return hi > y1 && lo < y2
      }
      const y = a[1]
      if (y <= y1 || y >= y2) return false
      const lo = Math.min(a[0], b[0])
      const hi = Math.max(a[0], b[0])
      return hi > x1 && lo < x2
    })
  // total length a candidate route runs PARALLEL and close (≤BUNDLE px) to a SAME-LABEL edge's vertical
  // segment — favour the collapse that bundles longest with its sibling.
  const BUNDLE = 70
  const parLen = (pts: Pt[], sib: PlacedEdge[]) => {
    let total = 0
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s]
      const b = pts[s + 1]
      if (!(Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5))
        continue
      const x = a[0]
      const ylo = Math.min(a[1], b[1])
      const yhi = Math.max(a[1], b[1])
      for (const o of sib)
        for (let t = 0; t + 1 < o.points.length; t++) {
          const c = o.points[t]
          const d = o.points[t + 1]
          if (!(Math.abs(c[0] - d[0]) < 0.5 && Math.abs(c[1] - d[1]) > 0.5))
            continue
          if (Math.abs(c[0] - x) > BUNDLE) continue
          const lo = Math.max(ylo, Math.min(c[1], d[1]))
          const hi = Math.min(yhi, Math.max(c[1], d[1]))
          if (hi > lo) total += hi - lo
        }
    }
    return total
  }
  for (const e of layout.edges) {
    const sib = layout.edges.filter(
      (o) => o !== e && o.label && o.label === e.label,
    )
    let changed = true
    while (changed) {
      changed = false
      const p = e.points
      for (let i = 1; i + 3 <= p.length - 1; i++) {
        const A = p[i]
        const B = p[i + 1]
        const C = p[i + 2]
        const Dd = p[i + 3]
        const h1 = Math.abs(A[1] - B[1]) < 0.5 && Math.abs(A[0] - B[0]) > 0.5
        const v = Math.abs(B[0] - C[0]) < 0.5 && Math.abs(B[1] - C[1]) > 0.5
        const h2 = Math.abs(C[1] - Dd[1]) < 0.5 && Math.abs(C[0] - Dd[0]) > 0.5
        if (!(h1 && v && h2)) continue
        if (Math.sign(B[0] - A[0]) === Math.sign(Dd[0] - C[0])) continue // monotone staircase, not a bump
        const base = countCrossings(layout)
        // would a-b lie COLLINEAR-and-overlapping (within 6px) on ANOTHER edge's parallel segment? That's
        // NOT a crossing so the crossing guard misses it — reject such a candidate.
        const collOv = (a: Pt, b: Pt) => {
          const horiz = Math.abs(a[1] - b[1]) < 0.5
          for (const o of layout.edges) {
            if (o === e) continue
            const q = o.points
            for (let t = 0; t + 1 < q.length; t++) {
              const c = q[t]
              const d = q[t + 1]
              if (horiz) {
                if (Math.abs(c[1] - d[1]) < 0.5 && Math.abs(c[1] - a[1]) < 6) {
                  const lo = Math.max(
                    Math.min(a[0], b[0]),
                    Math.min(c[0], d[0]),
                  )
                  const hi = Math.min(
                    Math.max(a[0], b[0]),
                    Math.max(c[0], d[0]),
                  )
                  if (hi - lo > 2) return true
                }
              } else if (
                Math.abs(c[0] - d[0]) < 0.5 &&
                Math.abs(c[0] - a[0]) < 6
              ) {
                const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))
                const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
                if (hi - lo > 2) return true
              }
            }
          }
          return false
        }
        let best: Pt[] | null = null
        let bestLen = -1
        for (const corner of [[Dd[0], A[1]] as Pt, [A[0], C[1]] as Pt]) {
          if (hitsBox(A, corner) || hitsBox(corner, Dd)) continue
          if (collOv(A, corner) || collOv(corner, Dd)) continue
          const cand = [...p.slice(0, i + 1), corner, ...p.slice(i + 3)]
          const old = e.points
          e.points = cand as PlacedEdge['points']
          const c = countCrossings(layout)
          e.points = old
          if (c > base) continue
          const len = parLen(cand, sib)
          if (len > bestLen) {
            bestLen = len
            best = cand
          }
        }
        if (best) {
          e.points = best as PlacedEdge['points']
          changed = true
          break
        }
      }
    }
  }
}

// Our invention (D2 has no such logic): route an edge AROUND a container it cuts through but doesn't
// belong to (neither endpoint is inside it). For each vertical segment passing inside a foreign container
// box, push it out past the nearest side (+CLEAR). Interior segment → shift x; port-attached (first/last)
// segment → insert a 2-point jog so the PORT stays put. Guarded: revert if it adds crossings or the new
// vertical hits another box. task 122.
function detourContainers(layout: Layout): void {
  const CLEAR = 18
  const JOG = 18
  const containers = layout.nodes.filter((n) => n.kind === 'container')
  const leaves = layout.nodes.filter(isLeaf)
  const parent = new Map(layout.nodes.map((n) => [n.s.id, n.s.container]))
  const inside = (id: string | undefined, cont: string) => {
    let c = id ? parent.get(id) : undefined
    while (c) {
      if (c === cont) return true
      c = parent.get(c)
    }
    return false
  }
  const vHitsBox = (
    x: number,
    y1: number,
    y2: number,
    skip: (string | undefined)[],
  ) =>
    leaves.some(
      (B) =>
        !skip.includes(B.s.id) &&
        x > B.x - 4 &&
        x < B.x + B.w + 4 &&
        Math.min(y2, B.y + B.h) - Math.max(y1, B.y) > 2,
    )
  for (const e of layout.edges) {
    for (const C of containers) {
      if (
        inside(e.src, C.s.id) ||
        inside(e.dst, C.s.id) ||
        e.src === C.s.id ||
        e.dst === C.s.id
      )
        continue // edge belongs to / terminates at this container
      const bx = C.x
      const bw = C.w
      const by = C.y
      const bh = C.h
      const p = e.points
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i]
        const b = p[i + 1]
        if (Math.abs(a[0] - b[0]) > 1) continue // vertical only
        const x = a[0]
        const y1 = Math.min(a[1], b[1])
        const y2 = Math.max(a[1], b[1])
        // fire for a vertical crossing the container INTERIOR, OR one running flush along a wall (±WTOL):
        // a segment sitting exactly on a wall reads as "line drawn on the box border" (it overlaps the
        // container stroke pixel-for-pixel), so detour it outward like an interior crossing. WTOL matches
        // vHitsBox's ±4 fuzz so the interior and wall bands join with no gap. newx below always resolves to
        // the OUTWARD side, clearing the wall by CLEAR.
        const WTOL = 4
        const interior = x > bx + 1 && x < bx + bw - 1
        const onWall =
          Math.abs(x - bx) <= WTOL || Math.abs(x - (bx + bw)) <= WTOL
        if (!interior && !onWall) continue
        if (Math.min(y2, by + bh) - Math.max(y1, by) <= 4) continue // overlaps y
        const newx = x - bx < bx + bw - x ? bx - CLEAR : bx + bw + CLEAR
        if (vHitsBox(newx, y1, y2, [e.src, e.dst])) break // no room on that side
        const base = countCrossings(layout)
        const snapshot = p.map((q) => q.slice() as Pt)
        if (i === 0) {
          // port at p[0]: insert jog, keep port
          const py = a[1]
          const dir = b[1] > a[1] ? 1 : -1
          e.points = [
            a.slice() as Pt,
            [a[0], py + dir * JOG],
            [newx, py + dir * JOG],
            [newx, b[1]],
            ...p.slice(2),
          ] as PlacedEdge['points']
        } else if (i + 1 === p.length - 1) {
          // port at p[last]: insert jog before it, keep port
          const py = b[1]
          const dir = a[1] < b[1] ? 1 : -1
          e.points = [
            ...p.slice(0, i),
            [newx, a[1]],
            [newx, py - dir * JOG],
            [b[0], py - dir * JOG],
            b.slice() as Pt,
          ] as PlacedEdge['points']
        } else {
          // interior vertical: shift this segment to newx. The naive shift assumes BOTH neighbours are
          // horizontal jogs that simply lengthen. But if a neighbour is a COLLINEAR vertical continuation
          // (the run flows straight on at the old x — e.g. into the ELK entry/exit stub at a box port),
          // moving only [a,b] leaves that neighbour behind → the connector turns diagonal. Re-orthogonalise
          // such a joint by inserting an L-corner at (oldx, this-segment's-Y): the run jogs back to the
          // neighbour's x, then the stub keeps its original vertical entry direction (mirrors the port
          // branches above). x still holds the pre-shift wall x.
          a[0] = newx
          b[0] = newx
          const corners: { at: number; pt: [number, number] }[] = []
          const nb = p[i + 2] // neighbour past b
          if (nb && Math.abs(nb[1] - b[1]) > 1 && Math.abs(nb[0] - x) < 1.5)
            corners.push({ at: i + 2, pt: [x, b[1]] })
          const pa = p[i - 1] // neighbour before a
          if (pa && Math.abs(pa[1] - a[1]) > 1 && Math.abs(pa[0] - x) < 1.5)
            corners.push({ at: i, pt: [x, a[1]] })
          // splice the higher index first so the lower-index insertion stays valid
          corners.sort((u, v) => v.at - u.at)
          for (const c of corners) e.points.splice(c.at, 0, c.pt)
        }
        if (countCrossings(layout) > base) {
          e.points = snapshot as PlacedEdge['points'] // revert if it adds a crossing
        }
        break
      }
    }
  }
}

// task 122: align the horizontal "jog" segments of edges within the same inter-layer gap to a common Y,
// so the turns sit on one channel line instead of staircasing at random heights. Only moves INTERIOR
// horizontal segments (both neighbours vertical) → ports untouched, routes stay orthogonal. Guarded:
// never snap onto an X-overlapping segment already on the channel, and revert any snap that adds a
// crossing; monotonicity guard keeps the jog between its adjacent points' Ys.
function alignChannels(layout: Layout): void {
  const leaves = layout.nodes.filter(isLeaf)
  // Container walls the shared channel must avoid: a jog snapped onto a top/bottom wall reads as a line
  // drawn on the container border, and the strip just below a top wall holds the container title + padding.
  const WALLCLR = 14
  const TOPPAD = 46
  const BOTPAD = 28
  const cWalls = layout.nodes
    .filter((n) => n.kind === 'container')
    .flatMap((n) => [
      { y: n.y, top: true },
      { y: n.y + n.h, top: false },
    ])
  const rows: { cy: number; top: number; bot: number }[] = []
  for (const n of [...leaves].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = n.y + n.h / 2
    const r = rows.find((r) => Math.abs(r.cy - cy) < 36)
    if (r) {
      r.cy = (r.cy + cy) / 2
      r.top = Math.min(r.top, n.y)
      r.bot = Math.max(r.bot, n.y + n.h)
    } else rows.push({ cy, top: n.y, bot: n.y + n.h })
  }
  rows.sort((a, b) => a.cy - b.cy)
  const gaps: { lo: number; hi: number }[] = []
  for (let i = 0; i + 1 < rows.length; i++)
    if (rows[i + 1].top - rows[i].bot > 1)
      gaps.push({ lo: rows[i].bot, hi: rows[i + 1].top })
  type Seg = {
    e: PlacedEdge
    i: number
    a: Pt
    b: Pt
    y: number
    x1: number
    x2: number
  }
  const segs: Seg[] = []
  for (const e of layout.edges) {
    const p = e.points
    for (let i = 1; i + 2 <= p.length - 1; i++) {
      const a = p[i]
      const b = p[i + 1]
      if (Math.abs(a[1] - b[1]) > 0.5) continue
      if (Math.abs(a[0] - b[0]) < 6) continue
      if (Math.abs(p[i - 1][0] - a[0]) > 0.5) continue
      if (Math.abs(p[i + 2][0] - b[0]) > 0.5) continue
      segs.push({
        e,
        i,
        a,
        b,
        y: a[1],
        x1: Math.min(a[0], b[0]),
        x2: Math.max(a[0], b[0]),
      })
    }
  }
  for (const g of gaps) {
    const inGap = segs.filter((s) => s.y > g.lo + 0.5 && s.y < g.hi - 0.5)
    if (inGap.length < 2) continue
    const ys = inGap.map((s) => s.y).sort((a, b) => a - b)
    let target = Math.max(
      g.lo + 12,
      Math.min(g.hi - 12, ys[Math.floor(ys.length / 2)]),
    )
    // Nudge the shared channel off any container wall in this gap: a top wall forbids [wall−CLR, wall+TOPPAD]
    // (the title strip), a bottom wall forbids [wall−BOTPAD, wall+CLR]. Move to the nearer clear side that
    // still fits the gap; if neither side fits, leave it (the per-segment crossing guard below still applies).
    for (const w of cWalls) {
      if (w.y <= g.lo + 0.5 || w.y >= g.hi - 0.5) continue
      const zLo = w.top ? w.y - WALLCLR : w.y - BOTPAD
      const zHi = w.top ? w.y + TOPPAD : w.y + WALLCLR
      if (target <= zLo || target >= zHi) continue
      const upOk = zLo >= g.lo + 12
      const downOk = zHi <= g.hi - 12
      if (upOk && (!downOk || target - zLo <= zHi - target)) target = zLo
      else if (downOk) target = zHi
    }
    const placed: Seg[] = []
    // seed the channel with segments already on target so a moved segment is X-overlap-checked against them
    for (const s of inGap) if (Math.abs(s.y - target) < 0.5) placed.push(s)
    for (const s of [...inGap].sort((a, b) => a.x1 - b.x1)) {
      if (Math.abs(s.y - target) < 0.5) continue // already on the channel
      if (
        placed.some(
          (q) => q !== s && Math.min(s.x2, q.x2) - Math.max(s.x1, q.x1) > 2,
        )
      )
        continue // don't snap onto an X-overlapping segment already on the channel
      // monotonicity guard: target must stay between the y of the two adjacent points
      const prevY = s.e.points[s.i - 1][1]
      const nextY = s.e.points[s.i + 2][1]
      if (
        target < Math.min(prevY, nextY) - 0.5 ||
        target > Math.max(prevY, nextY) + 0.5
      )
        continue
      const oldY = s.y
      const base = countCrossings(layout)
      s.a[1] = target
      s.b[1] = target
      if (countCrossings(layout) > base) {
        s.a[1] = oldY
        s.b[1] = oldY
        continue
      }
      s.y = target
      placed.push(s)
    }
  }
}

// BUNDLE same-label siblings (task 122): a MONOTONE L jog that ELK placed late leaves its descent running
// parallel to its same-label sibling for less than it could. RAISE such a jog toward the sibling's descent
// top so the two like-labelled lines run alongside LONGER. Guard: raise only as far as it adds no
// crossing, hits no box, and keeps ≥CHANSPACE (40) from any collinear horizontal.
function bundleSiblings(layout: Layout): void {
  const leaves = layout.nodes.filter(isLeaf)
  const hitsBox = (a: Pt, b: Pt) =>
    leaves.some((n) => {
      const M = 4
      const x1 = n.x - M
      const y1 = n.y - M
      const x2 = n.x + n.w + M
      const y2 = n.y + n.h + M
      if (Math.abs(a[0] - b[0]) < 0.5) {
        const x = a[0]
        if (x <= x1 || x >= x2) return false
        const lo = Math.min(a[1], b[1])
        const hi = Math.max(a[1], b[1])
        return hi > y1 && lo < y2
      }
      const y = a[1]
      if (y <= y1 || y >= y2) return false
      const lo = Math.min(a[0], b[0])
      const hi = Math.max(a[0], b[0])
      return hi > x1 && lo < x2
    })
  // CHANSPACE = min vertical gap to keep between parallel horizontal lines (channels), matching the ~40px
  // spacing between parallel vertical lanes (port_spacing).
  const CHANSPACE = 40
  // A raised jog must keep this much clearance from any leaf box edge AND any container top/bottom wall it
  // runs along. The old check only rejected ≤4px box OVERLAP, so a jog could sit 8px under the source box
  // ("ciasno poziomo"); and it ignored container walls entirely, so raising into a cramped row landed the
  // jog flush on the container's bottom wall. Rejecting the whole clearance band forces the jog DOWN past a
  // cramped row into the open area below the container, where it still bundles but clears everything.
  const JOGCLR = 16
  const containers = layout.nodes.filter((n) => n.kind === 'container')
  // true ⇢ the horizontal jog y over [xL,xR] keeps ≥JOGCLR from every x-overlapping leaf box band and
  // every x-overlapping container wall (so it neither hugs a box nor grazes a wall)
  const jogClear = (a: Pt, b: Pt) => {
    const y = a[1]
    const xL = Math.min(a[0], b[0])
    const xR = Math.max(a[0], b[0])
    for (const n of leaves) {
      if (xR <= n.x || xL >= n.x + n.w) continue
      if (y > n.y - JOGCLR && y < n.y + n.h + JOGCLR) return false
    }
    for (const c of containers) {
      if (xR <= c.x || xL >= c.x + c.w) continue
      if (Math.abs(y - c.y) < JOGCLR || Math.abs(y - (c.y + c.h)) < JOGCLR)
        return false
    }
    return true
  }
  const collinear = (e: PlacedEdge, y: number, x1: number, x2: number) => {
    for (const o of layout.edges) {
      if (o === e) continue
      const q = o.points
      for (let t = 0; t + 1 < q.length; t++) {
        const c = q[t]
        const d = q[t + 1]
        if (Math.abs(c[1] - d[1]) < 0.5 && Math.abs(c[1] - y) < CHANSPACE) {
          const lo = Math.max(x1, Math.min(c[0], d[0]))
          const hi = Math.min(x2, Math.max(c[0], d[0]))
          if (hi - lo > 2) return true
        }
      }
    }
    return false
  }
  const BUNDLE = 70
  for (const e of layout.edges) {
    const sib = layout.edges.filter(
      (o) => o !== e && o.label && o.label === e.label,
    )
    if (!sib.length) continue
    const p = e.points
    for (let i = 1; i + 2 <= p.length - 1; i++) {
      const pre = p[i - 1]
      const A = p[i]
      const B = p[i + 1]
      const post = p[i + 2]
      if (!(Math.abs(pre[0] - A[0]) < 0.5 && Math.abs(pre[1] - A[1]) > 0.5))
        continue // V before
      if (!(Math.abs(A[1] - B[1]) < 0.5 && Math.abs(A[0] - B[0]) > 0.5))
        continue // H jog
      if (!(Math.abs(B[0] - post[0]) < 0.5 && Math.abs(B[1] - post[1]) > 0.5))
        continue // V after (the descent)
      const yJog = A[1]
      const x2 = B[0]
      const ybot = post[1]
      let ytop = Number.POSITIVE_INFINITY
      for (const o of sib) {
        const q = o.points
        for (let t = 0; t + 1 < q.length; t++) {
          const c = q[t]
          const d = q[t + 1]
          if (Math.abs(c[0] - d[0]) < 0.5 && Math.abs(c[1] - d[1]) > 0.5) {
            const top = Math.min(c[1], d[1])
            const bot = Math.max(c[1], d[1])
            if (Math.abs(bot - ybot) < 30 && Math.abs(c[0] - x2) <= BUNDLE)
              ytop = Math.min(ytop, top)
          }
        }
      }
      if (!Number.isFinite(ytop) || ytop >= yJog - 8) continue // sibling not higher → nothing to gain
      const base = countCrossings(layout)
      const sA = A[1]
      const sB = B[1]
      // raise the jog from ytop downward (by 6) to the first valid Y (= highest = longest parallel run).
      // jogClear (below) keeps the chosen Y off boxes and container walls, so in a cramped row the search
      // skips the tight band and settles just below the container instead of grazing it.
      for (
        let target = Math.max(ytop, Math.min(pre[1], sA) + 8);
        target <= yJog - 4;
        target += 6
      ) {
        A[1] = target
        B[1] = target
        // check only the NEW geometry: the moved jog [A,B] (clearance from boxes + container walls) and the
        // descent EXTENSION's new upper part (just box overlap — it runs vertically and may cross a wall)
        const ext: [Pt, Pt] = [
          [B[0], target],
          [B[0], sB],
        ]
        if (
          jogClear(A, B) &&
          !hitsBox(ext[0], ext[1]) &&
          !collinear(e, target, Math.min(A[0], B[0]), Math.max(A[0], B[0])) &&
          countCrossings(layout) <= base
        )
          break
        A[1] = sA
        B[1] = sB
      }
    }
  }
}

// task 122: parallelism rule for same-SOURCE same-label edges (fan-out). bundleSiblings keeps same-TARGET
// edges parallel where they CONVERGE; this keeps same-SOURCE edges from colliding where they DIVERGE. Two
// edges leaving one node with one label exit as parallel trunks then peel off to different targets — but ELK
// can place the deeper edge's peel jog at the SAME Y as the shallower one, with its descent dropping in the
// shallower edge's trunk lane (netmesh's two "route" jogs both at y=443, route-b descending at x≈320 = where
// route-a's trunk sits → their corners kiss / verticals stitch). Fix: bring them toward one channel but never
// closer than CHANSPACE — stagger by target depth so the deeper edge peels CHANSPACE BELOW the shallower
// one, its descent then starting below the shallower trunk's end (no overlap). Guarded by crossing count.
function bundleSourceSiblings(layout: Layout): void {
  const CHANSPACE = 40
  type Peel = {
    e: PlacedEdge
    i: number
    trunkX: number
    descentX: number
    peelY: number
    ybot: number
  }
  const peelOf = (e: PlacedEdge): Peel | null => {
    const p = e.points
    for (let i = 1; i + 2 <= p.length - 1; i++) {
      const pre = p[i - 1]
      const A = p[i]
      const B = p[i + 1]
      const post = p[i + 2]
      if (
        Math.abs(pre[0] - A[0]) < 0.5 &&
        Math.abs(pre[1] - A[1]) > 0.5 && // V trunk
        Math.abs(A[1] - B[1]) < 0.5 &&
        Math.abs(A[0] - B[0]) > 0.5 && // H peel
        Math.abs(B[0] - post[0]) < 0.5 &&
        Math.abs(B[1] - post[1]) > 0.5 // V descent
      )
        return {
          e,
          i,
          trunkX: A[0],
          descentX: B[0],
          peelY: A[1],
          ybot: post[1],
        }
    }
    return null
  }
  // Container walls a staggered peel must avoid: lowering a jog onto a container's top/bottom wall reads as
  // a line drawn on the box border (netmesh: two `route` peels at the same Y, the lower one landing on the
  // Service Mesh top wall). The crossing guard can't see this (it isn't a crossing), so check walls explicitly.
  const WALLCLR = 16
  const cWalls = layout.nodes
    .filter((n) => n.kind === 'container')
    .flatMap((n) => [n.y, n.y + n.h])
  const groups = new Map<string, PlacedEdge[]>()
  for (const e of layout.edges) {
    if (!e.src || !e.label) continue
    const k = `${e.src}|${e.label}`
    const g = groups.get(k)
    if (g) g.push(e)
    else groups.set(k, [e])
  }
  for (const es of groups.values()) {
    if (es.length < 2) continue
    const peels = es.map(peelOf).filter(Boolean) as Peel[]
    if (peels.length < 2) continue
    peels.sort((a, b) => a.ybot - b.ybot) // shallowest target first
    for (let k = 1; k < peels.length; k++) {
      const shallow = peels[k - 1]
      const deep = peels[k]
      // only act when the deeper edge descends in (near) the shallower edge's trunk lane AND they peel at
      // nearly the same height — that's the kiss. Otherwise the lanes are already clear, leave them.
      if (Math.abs(deep.descentX - shallow.trunkX) >= CHANSPACE) continue
      if (deep.peelY >= shallow.peelY + CHANSPACE - 0.5) continue
      // Stagger the deep peel DOWN (below the shallow peel). It MUST stay below the shallow peel: the deep
      // edge's descent shares the shallow edge's trunk x-lane, so a peel ABOVE the shallow peel would drop
      // the descent into that trunk → collinear overlap (the netmesh "route" lines lying on each other). If
      // the natural target lands on a container wall, pull it UP to just above the wall — still below the
      // shallow peel — instead of below the title. Skip if no clear lane fits between the shallow peel and
      // the wall. A collinearOverlap guard (plus the crossing guard) reverts anything that still overlaps.
      const preY = deep.e.points[deep.i - 1][1]
      let target = shallow.peelY + CHANSPACE
      for (const w of cWalls)
        if (target > w - WALLCLR && target < w + WALLCLR) target = w - WALLCLR
      if (target <= shallow.peelY + 12) continue // no clear lane between the shallow peel and the wall
      if (target >= deep.ybot - 8 || target <= preY + 4) continue // no room in that lane
      const A = deep.e.points[deep.i]
      const B = deep.e.points[deep.i + 1]
      const oldY = A[1]
      const base = countCrossings(layout)
      const cbase = collinearOverlapCount(layout)
      A[1] = target
      B[1] = target
      if (
        countCrossings(layout) > base ||
        collinearOverlapCount(layout) > cbase
      ) {
        A[1] = oldY
        B[1] = oldY
        continue
      }
      deep.peelY = target
    }
  }
}

// task 122: compact back-edge RINGS. ELK (and our reroute) returns each back-edge to a top/bottom hub by
// looping AROUND the figure; with many of them they nest as concentric rings that ELK fans out very wide /
// high / low (saga: rings out to x≈1231, horizontals at y≈60 and y≈1013) — far more than needed, since a
// tighter ring would still clear everything. Pull each ring's OUTER segments inward toward the box bbox
// (the far vertical toward centre, the lowest/highest horizontals toward the figure) until it is within
// RINGCLR of a box OR RINGGAP of another edge's parallel segment, guarded so it adds no crossing. Innermost
// ring first, so the outer ones nest snugly against the tightened inner ones. Stubs (first/last segment)
// are never moved. This is the "if the loop sticks out past the others, bring its anchor points closer but
// never closer than N px to a box" rule.
function compactBackRings(layout: Layout): void {
  const RINGCLR = 24 // min clearance a compacted ring keeps from any box
  const RINGGAP = 24 // min spacing between a compacted ring and another edge's parallel segment
  const STEP = 6
  const N = new Map(layout.nodes.map((n) => [n.s.id, n]))
  const cyOf = (n: PlacedNode) => n.y + n.h / 2
  const obs: ABox[] = layout.nodes
    .filter((n) => n.kind !== 'grid')
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  if (!obs.length) return
  let bxMin = Number.POSITIVE_INFINITY
  let bxMax = Number.NEGATIVE_INFINITY
  let byMin = Number.POSITIVE_INFINITY
  let byMax = Number.NEGATIVE_INFINITY
  for (const b of obs) {
    bxMin = Math.min(bxMin, b.x)
    bxMax = Math.max(bxMax, b.x + b.w)
    byMin = Math.min(byMin, b.y)
    byMax = Math.max(byMax, b.y + b.h)
  }
  const cx = (bxMin + bxMax) / 2
  // slide interior segment i (axis 0 = vertical seg moved in x, axis 1 = horizontal seg moved in y) by STEP
  // toward `dir` until a guard stops it. p[i],p[i+1] move together; neighbours stretch, staying orthogonal.
  const slide = (e: PlacedEdge, i: number, axis: 0 | 1, dir: -1 | 1) => {
    const p = e.points
    for (;;) {
      const nv = p[i][axis] + dir * STEP
      const a: Pt = axis === 0 ? [nv, p[i][1]] : [p[i][0], nv]
      const b: Pt = axis === 0 ? [nv, p[i + 1][1]] : [p[i + 1][0], nv]
      let ok = true
      for (const B of obs)
        if (boxDist(a, b, B) < RINGCLR) {
          ok = false
          break
        }
      if (ok)
        for (const o of layout.edges) {
          if (o === e) continue
          const q = o.points
          for (let j = 0; j + 1 < q.length; j++) {
            const par =
              axis === 0
                ? Math.abs(q[j][0] - q[j + 1][0]) < 0.5
                : Math.abs(q[j][1] - q[j + 1][1]) < 0.5
            if (par && parDist(a, b, q[j], q[j + 1]) < RINGGAP) {
              ok = false
              break
            }
          }
          if (!ok) break
        }
      if (!ok) break
      const o0 = p[i][axis]
      const o1 = p[i + 1][axis]
      const base = countCrossings(layout)
      p[i][axis] = nv
      p[i + 1][axis] = nv
      if (countCrossings(layout) > base) {
        p[i][axis] = o0
        p[i + 1][axis] = o1
        break
      }
    }
  }
  const backs = layout.edges.filter((e) => {
    const s = e.src ? N.get(e.src) : undefined
    const d = e.dst ? N.get(e.dst) : undefined
    return !!(s && d && cyOf(d) < cyOf(s) - 40 && e.points.length >= 6)
  })
  // outer vertical = interior vertical seg sticking farthest outside [bxMin,bxMax]
  const outerVertIdx = (e: PlacedEdge) => {
    const p = e.points
    let bi = -1
    let bd = RINGCLR
    for (let i = 1; i <= p.length - 3; i++) {
      if (Math.abs(p[i][0] - p[i + 1][0]) > 0.5) continue
      const x = p[i][0]
      const out = x < cx ? bxMin - x : x - bxMax
      if (out > bd) {
        bd = out
        bi = i
      }
    }
    return bi
  }
  // process innermost ring first so outer rings nest against the already-tightened inner ones
  const items = backs
    .map((e) => ({ e, vi: outerVertIdx(e) }))
    .filter((it) => it.vi >= 0)
    .sort(
      (a, b) =>
        Math.abs(a.e.points[a.vi][0] - cx) - Math.abs(b.e.points[b.vi][0] - cx),
    )
  for (const { e, vi } of items) {
    slide(e, vi, 0, e.points[vi][0] < cx ? 1 : -1) // outer vertical → toward centre
    // lowest horizontal below the figure → up; highest horizontal above → down
    const p = e.points
    let loI = -1
    let hiI = -1
    for (let i = 1; i <= p.length - 3; i++) {
      if (Math.abs(p[i][1] - p[i + 1][1]) > 0.5) continue // horizontal only
      const y = p[i][1]
      if (y > byMax + 1 && (loI < 0 || y > p[loI][1])) loI = i
      if (y < byMin - 1 && (hiI < 0 || y < p[hiI][1])) hiI = i
    }
    if (loI >= 0) slide(e, loI, 1, -1)
    if (hiI >= 0) slide(e, hiI, 1, 1)
  }
}

// Count pairs of vertical segments from DIFFERENT edges that run collinear (x within 2) with a y-overlap
// > 4 — i.e. two lines drawn on top of each other. Guard reference for separateKissingJogs: a jog move must
// never create such an overlap (the trap a naive Y-nudge falls into — it stitches the moved edge's vertical
// onto another edge's trunk).
function collinearOverlapCount(layout: Layout): number {
  const vert: [number, number, number, number][] = [] // x, y0, y1, edgeIndex
  layout.edges.forEach((e, ei) => {
    const p = e.points
    for (let i = 0; i + 1 < p.length; i++) {
      if (Math.abs(p[i][0] - p[i + 1][0]) > 0.5) continue
      vert.push([
        p[i][0],
        Math.min(p[i][1], p[i + 1][1]),
        Math.max(p[i][1], p[i + 1][1]),
        ei,
      ])
    }
  })
  let c = 0
  for (let i = 0; i < vert.length; i++)
    for (let j = i + 1; j < vert.length; j++) {
      if (vert[i][3] === vert[j][3]) continue
      if (Math.abs(vert[i][0] - vert[j][0]) > 2) continue
      const lo = Math.max(vert[i][1], vert[j][1])
      const hi = Math.min(vert[i][2], vert[j][2])
      if (hi - lo > 4) c++
    }
  return c
}

// task 122: general corner separation. Two horizontal jogs from DIFFERENT edges can have their corners land
// at nearly the same point (within CORNER_GAP) without their segments overlapping — they "kiss" and read as
// one kinked line (e.g. events: the mobile→bus "publish" corner sits 2px from the retry back-edge's corner,
// both turning at y=681 above bus). Unlike bundleSourceSiblings (same source, semantic depth-stagger) these
// are unrelated edges, so just nudge one jog's Y until the corners are ≥CORNER_GAP apart, in the direction
// that adds NO crossing AND NO collinear vertical overlap. Runs after the bundling passes so it only cleans
// up residual kisses they didn't resolve.
function separateKissingJogs(layout: Layout): void {
  const CORNER_GAP = 14
  type Jog = { e: PlacedEdge; i: number; y: number; lo: number; hi: number }
  const jogs: Jog[] = []
  for (const e of layout.edges) {
    const p = e.points
    for (let i = 1; i + 2 <= p.length - 1; i++) {
      const a = p[i]
      const b = p[i + 1]
      if (Math.abs(a[1] - b[1]) > 0.5) continue // horizontal jog
      if (Math.abs(a[0] - b[0]) < 6) continue
      if (Math.abs(p[i - 1][0] - a[0]) > 0.5) continue // V before
      if (Math.abs(p[i + 2][0] - b[0]) > 0.5) continue // V after
      jogs.push({
        e,
        i,
        y: a[1],
        lo: Math.min(a[0], b[0]),
        hi: Math.max(a[0], b[0]),
      })
    }
  }
  for (let ii = 0; ii < jogs.length; ii++) {
    for (let jj = ii + 1; jj < jogs.length; jj++) {
      const s = jogs[ii]
      const t = jogs[jj]
      if (s.e === t.e) continue
      if (Math.abs(s.y - t.y) >= CORNER_GAP) continue // already apart
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 2) continue // x-overlap = different problem
      let kiss = false
      for (const sx of [s.lo, s.hi])
        for (const tx of [t.lo, t.hi])
          if (Math.abs(sx - tx) < CORNER_GAP) kiss = true
      if (!kiss) continue
      const base = countCrossings(layout)
      const cbase = collinearOverlapCount(layout)
      // try moving t (then s) to other.y ± CORNER_GAP; accept first with no new crossing / overlap
      for (const [mover, other] of [
        [t, s],
        [s, t],
      ] as [Jog, Jog][]) {
        const A = mover.e.points[mover.i]
        const B = mover.e.points[mover.i + 1]
        const oldY = A[1]
        let done = false
        for (const ny of [other.y + CORNER_GAP, other.y - CORNER_GAP]) {
          A[1] = ny
          B[1] = ny
          if (
            countCrossings(layout) <= base &&
            collinearOverlapCount(layout) <= cbase
          ) {
            mover.y = ny
            done = true
            break
          }
          A[1] = oldY
          B[1] = oldY
        }
        if (done) break
      }
    }
  }
}

// task 122: re-place each edge label on a STRAIGHT segment of its FINAL route, never across a bend (D2's
// INSIDE_MIDDLE_CENTER, corner-aware — see labelAnchor). ELK's lx/ly gets mangled by the Y-shift passes;
// recomputing from the post-processed route puts the label back on the line. Parallel same-direction edges
// stagger along the arc (frac) so wide labels don't collide. Runs LAST so labels follow the rerouted
// back-edges. (lx/ly is used by toSVG for guarded parallel pairs; lone edges are re-placed there on the
// simplified route via the same labelAnchor.)
function placeLabels(layout: Layout): void {
  const groups = new Map<string, PlacedEdge[]>()
  for (const e of layout.edges) {
    if (!e.label || e.points.length < 2) continue
    const k = `${e.src}${e.dst}`
    const g = groups.get(k)
    if (g) g.push(e)
    else groups.set(k, [e])
  }
  for (const es of groups.values()) {
    es.forEach((e, i) => {
      const frac = es.length === 1 ? 0.5 : (i + 1) / (es.length + 1)
      const m = labelAnchor(e.points as number[][], e.lw ?? 0, e.lh ?? 0, frac)
      e.lx = m[0]
      e.ly = m[1]
    })
  }
}

// ============================================================================
// Back-edge A* router (task 122). Ported from tmp/d2-compare/run67.mjs. A "back-edge" climbs UP (its
// destination sits above its source); ELK routes those poorly. We A*-route only the MIDDLE of such an
// edge on a Hanan grid, PRESERVING both ELK port stubs verbatim, then greedily accept the reroute only if
// it doesn't increase the total crossing count.
// ============================================================================
const ASTAR_M = 10 // box inflation for hard-obstacle hit tests + grid lines at box edges ±M
const COMFORT = 40 // below this clearance to an obstacle, pay a penalty
const COMFW = 6 // penalty weight per px short of COMFORT / EDGECLR
const EDGECLR = 20 // below this parallel-proximity to another edge, pay a penalty
const ASTAR_PAD = 64 // pad the clearance-object bbox so lanes exist outside peripheral boxes/walls
const ASTAR_STEP = 24 // densify grid lines to this resolution

interface ABox {
  x: number
  y: number
  w: number
  h: number
  id?: string
  kind?: string
}

function segHitsABox(a: Pt, b: Pt, B: ABox): boolean {
  const x1 = B.x - ASTAR_M
  const y1 = B.y - ASTAR_M
  const x2 = B.x + B.w + ASTAR_M
  const y2 = B.y + B.h + ASTAR_M
  if (Math.abs(a[0] - b[0]) < 0.5) {
    const x = a[0]
    if (x <= x1 || x >= x2) return false
    const lo = Math.min(a[1], b[1])
    const hi = Math.max(a[1], b[1])
    return hi > y1 && lo < y2
  }
  const y = a[1]
  if (y <= y1 || y >= y2) return false
  const lo = Math.min(a[0], b[0])
  const hi = Math.max(a[0], b[0])
  return hi > x1 && lo < x2
}
function ptInABox(p: Pt, B: ABox): boolean {
  return (
    p[0] > B.x - ASTAR_M &&
    p[0] < B.x + B.w + ASTAR_M &&
    p[1] > B.y - ASTAR_M &&
    p[1] < B.y + B.h + ASTAR_M
  )
}
// perpendicular distance from an axis-aligned segment a-b to (un-inflated) box B
function boxDist(a: Pt, b: Pt, B: ABox): number {
  const lo0 = Math.min(a[0], b[0])
  const hi0 = Math.max(a[0], b[0])
  const lo1 = Math.min(a[1], b[1])
  const hi1 = Math.max(a[1], b[1])
  const dx = Math.max(B.x - hi0, lo0 - (B.x + B.w), 0)
  const dy = Math.max(B.y - hi1, lo1 - (B.y + B.h), 0)
  return Math.hypot(dx, dy)
}
// distance from a seg to a container's PERIMETER (0 on the wall, grows BOTH inward & outward) — a route
// deep in a container's interior is cheap, but hugging a wall (inside or out) is penalised.
function wallDist(a: Pt, b: Pt, B: ABox): number {
  const o = boxDist(a, b, B)
  if (o > 0) return o
  const ins = (p: Pt) =>
    Math.min(p[0] - B.x, B.x + B.w - p[0], p[1] - B.y, B.y + B.h - p[1])
  return Math.max(0, Math.min(ins(a), ins(b)))
}
// perpendicular gap between two PARALLEL axis-aligned segments whose extents overlap (else 1e9)
function parDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const av = Math.abs(a[0] - b[0]) < 0.5
  const cv = Math.abs(c[0] - d[0]) < 0.5
  const ah = Math.abs(a[1] - b[1]) < 0.5
  const ch = Math.abs(c[1] - d[1]) < 0.5
  if (av && cv) {
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
    return hi < lo ? 1e9 : Math.abs(a[0] - c[0])
  }
  if (ah && ch) {
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    return hi < lo ? 1e9 : Math.abs(a[1] - c[1])
  }
  return 1e9
}

interface ANode {
  i: number
  j: number
  g: number
  f: number
  di: number | null
  dj: number | null
  prev: ANode | null
}

// A* on a Hanan grid. `boxes` = HARD obstacles; `clearObs` = SOFT clearance set (+ containers). Returns
// the routed middle polyline, or null if no path.
function astar(
  start: Pt,
  goal: Pt,
  boxes: ABox[],
  inDir: [number, number],
  edgeSegs: [Pt, Pt][],
  forbidDir: [number, number] | null,
  clearObs: ABox[],
): Pt[] | null {
  const xs = new Set<number>([start[0], goal[0]])
  const ys = new Set<number>([start[1], goal[1]])
  // grid lines from ALL clearance objects (leaf boxes + containers) so lanes exist just outside walls
  for (const B of clearObs) {
    xs.add(B.x - ASTAR_M)
    xs.add(B.x + B.w + ASTAR_M)
    ys.add(B.y - ASTAR_M)
    ys.add(B.y + B.h + ASTAR_M)
  }
  // pad the bbox of all clearance objects (incl. CONTAINERS) + endpoints so lanes exist outside them
  let minX = Math.min(start[0], goal[0])
  let maxX = Math.max(start[0], goal[0])
  let minY = Math.min(start[1], goal[1])
  let maxY = Math.max(start[1], goal[1])
  for (const B of clearObs) {
    minX = Math.min(minX, B.x)
    maxX = Math.max(maxX, B.x + B.w)
    minY = Math.min(minY, B.y)
    maxY = Math.max(maxY, B.y + B.h)
  }
  xs.add(minX - ASTAR_PAD)
  xs.add(maxX + ASTAR_PAD)
  ys.add(minY - ASTAR_PAD)
  ys.add(maxY + ASTAR_PAD)
  // densify: subdivide each gap at ~STEP so A* can place a lane at any clearance, not just at walls
  const densify = (set: Set<number>) => {
    const a = [...set].sort((p, q) => p - q)
    const r = new Set<number>(a)
    for (let i = 0; i + 1 < a.length; i++) {
      const gap = a[i + 1] - a[i]
      if (gap > ASTAR_STEP * 1.5) {
        const n = Math.round(gap / ASTAR_STEP)
        for (let k = 1; k < n; k++) r.add(a[i] + (gap * k) / n)
      }
    }
    return r
  }
  const X = [...densify(xs)].sort((a, b) => a - b)
  const Y = [...densify(ys)].sort((a, b) => a - b)
  const key = (i: number, j: number) => `${i}_${j}`
  const inAny = (p: Pt) => boxes.some((B) => ptInABox(p, B))
  const ok = new Set<string>()
  for (let i = 0; i < X.length; i++)
    for (let j = 0; j < Y.length; j++) {
      const p: Pt = [X[i], Y[j]]
      if (
        !inAny(p) ||
        (X[i] === start[0] && Y[j] === start[1]) ||
        (X[i] === goal[0] && Y[j] === goal[1])
      )
        ok.add(key(i, j))
    }
  const si = X.indexOf(start[0])
  const sj = Y.indexOf(start[1])
  const gi = X.indexOf(goal[0])
  const gj = Y.indexOf(goal[1])
  const Hh = (i: number, j: number) =>
    Math.abs(X[i] - X[gi]) + Math.abs(Y[j] - Y[gj])
  const open: ANode[] = [
    {
      i: si,
      j: sj,
      g: 0,
      f: Hh(si, sj),
      di: inDir[0],
      dj: inDir[1],
      prev: null,
    },
  ]
  const seen = new Map<string, number>()
  let goalNode: ANode | null = null
  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const cur = open.shift() as ANode
    const sk = `${key(cur.i, cur.j)}|${cur.di},${cur.dj}`
    if (seen.has(sk) && (seen.get(sk) as number) <= cur.g) continue
    seen.set(sk, cur.g)
    if (cur.i === gi && cur.j === gj) {
      // forbid arriving at the goal in a direction that would REVERSE the fixed entry stub (overshoot)
      if (forbidDir && cur.di === forbidDir[0] && cur.dj === forbidDir[1])
        continue
      goalNode = cur
      break
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (cur.di !== null && di === -cur.di && dj === -cur.dj) continue // forbid 180° reversal
      const ni = cur.i + di
      const nj = cur.j + dj
      if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue
      if (!ok.has(key(ni, nj))) continue
      const a: Pt = [X[cur.i], Y[cur.j]]
      const b: Pt = [X[ni], Y[nj]]
      if (boxes.some((B) => segHitsABox(a, b, B))) continue
      const turn = cur.di !== null && (di !== cur.di || dj !== cur.dj) ? 40 : 0
      const ec = edgeSegs.reduce(
        (c, s2) => c + (segsCross(a, b, s2[0], s2[1]) ? 1 : 0),
        0,
      )
      let cl = 1e9
      for (const B of clearObs) {
        const d = B.kind === 'container' ? wallDist(a, b, B) : boxDist(a, b, B)
        if (d < cl) cl = d
      }
      const cp = cl < COMFORT ? (COMFORT - cl) * COMFW : 0
      let ep = 1e9
      for (const s2 of edgeSegs) {
        const d = parDist(a, b, s2[0], s2[1])
        if (d < ep) ep = d
      }
      const epp = ep < EDGECLR ? (EDGECLR - ep) * COMFW : 0
      const g =
        cur.g +
        Math.abs(X[ni] - X[cur.i]) +
        Math.abs(Y[nj] - Y[cur.j]) +
        turn +
        ec * 1500 +
        cp +
        epp
      open.push({ i: ni, j: nj, g, f: g + Hh(ni, nj), di, dj, prev: cur })
    }
  }
  if (!goalNode) return null
  const path: Pt[] = []
  let n: ANode | null = goalNode
  while (n) {
    path.unshift([X[n.i], Y[n.j]])
    n = n.prev
  }
  // drop collinear interior points
  const out: Pt[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1]
    const c = path[i]
    const d = path[i + 1]
    if (
      (Math.abs(a[0] - c[0]) < 0.5 && Math.abs(c[0] - d[0]) < 0.5) ||
      (Math.abs(a[1] - c[1]) < 0.5 && Math.abs(c[1] - d[1]) < 0.5)
    )
      continue
    out.push(c)
  }
  out.push(path[path.length - 1])
  return out
}

const sign = (v: number) => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0)

// Find back-edges, A*-route their middle (preserving both stubs), and greedily accept each reroute only
// if it does NOT increase the total crossing count.
function rerouteBackEdges(layout: Layout): void {
  const N = new Map(layout.nodes.map((n) => [n.s.id, n]))
  const cy = (n: PlacedNode) => n.y + n.h / 2
  const boxes: ABox[] = layout.nodes
    .filter(isLeaf)
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, id: n.s.id, kind: n.kind }))
  const conts: ABox[] = layout.nodes
    .filter((n) => n.kind === 'container')
    .map((n) => ({
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      id: n.s.id,
      kind: 'container',
    }))
  const clear: ABox[] = [...boxes, ...conts]
  // back-edge = dst center.y < src center.y − 40, AND ≥4 points
  const candidates: { ei: number; pts: Pt[] }[] = []
  layout.edges.forEach((e, ei) => {
    const s = e.src ? N.get(e.src) : undefined
    const d = e.dst ? N.get(e.dst) : undefined
    if (!s || !d || !(cy(d) < cy(s) - 40) || e.points.length < 4) return
    const p = e.points
    // PRESERVE both ELK stubs verbatim: exit p[0]→p[1] and entry p[n-2]→p[n-1]. A* routes only the
    // middle p[1]..p[n-2].
    const entA = p[p.length - 2]
    const entB = p[p.length - 1]
    const inDir: [number, number] = [
      sign(p[1][0] - p[0][0]),
      sign(p[1][1] - p[0][1]),
    ]
    const entryDir: [number, number] = [
      sign(entB[0] - entA[0]),
      sign(entB[1] - entA[1]),
    ]
    const forbid: [number, number] = [-entryDir[0], -entryDir[1]]
    // all OTHER edges' segments — the edge-cross penalty reference for A*
    const edgeSegs: [Pt, Pt][] = []
    for (const o of layout.edges) {
      if (o === e) continue
      for (let i = 0; i + 1 < o.points.length; i++)
        edgeSegs.push([o.points[i], o.points[i + 1]])
    }
    let mid = astar(p[1], entA, boxes, inDir, edgeSegs, forbid, clear)
    if (!mid) mid = astar(p[1], entA, boxes, inDir, edgeSegs, null, clear) // fallback: allow any arrival
    if (!mid) return
    candidates.push({ ei, pts: [p[0], ...mid, entB] })
  })
  if (!candidates.length) return
  // greedily accept a candidate only if it does not increase total crossings
  let best = countCrossings(layout)
  for (const c of candidates) {
    const e = layout.edges[c.ei]
    const old = e.points
    e.points = c.pts as PlacedEdge['points']
    const x = countCrossings(layout)
    if (x <= best) best = x
    else e.points = old // revert
  }
}

// Full post-process pipeline (task 122). Mutates `layout` in place. Order matters — see the harness
// (tmp/d2-compare/harness2.ts fullLayout + run67.mjs) where it was validated. placeLabels runs AFTER the
// reroute so labels follow the rerouted back-edges.
export function refineLayout(layout: Layout): void {
  // Diagnostic seam (no-op in production): when a harness sets globalThis.__refineTrace, each pass reports
  // its post-state so the elkdiff tooling can attribute which pass reshaped which edge. Gated + zero-cost
  // (one optional-chain per pass) when unset; never wired in the shipped webview.
  const tr =
    (globalThis as { __refineTrace?: (name: string, l: Layout) => void })
      .__refineTrace ?? null
  alignRows(layout)
  tr?.('alignRows', layout)
  adaptiveLayerGaps(layout)
  tr?.('adaptiveLayerGaps', layout)
  spreadCrampedRows(layout)
  tr?.('spreadCrampedRows', layout)
  monotonizeEdges(layout)
  tr?.('monotonizeEdges', layout)
  deleteBendsEndpoints(layout)
  tr?.('deleteBendsEndpoints', layout)
  deOvershoot(layout)
  tr?.('deOvershoot', layout)
  detourContainers(layout)
  tr?.('detourContainers', layout)
  alignChannels(layout)
  tr?.('alignChannels', layout)
  bundleSiblings(layout)
  tr?.('bundleSiblings', layout)
  bundleSourceSiblings(layout)
  tr?.('bundleSourceSiblings', layout)
  rerouteBackEdges(layout)
  tr?.('rerouteBackEdges', layout)
  compactBackRings(layout)
  tr?.('compactBackRings', layout)
  separateKissingJogs(layout)
  tr?.('separateKissingJogs', layout)
  placeLabels(layout)
}

// Individual passes exposed for unit testing only — production goes through refineLayout (which runs the
// full ordered pipeline). Importing these directly lets a test exercise one pass in isolation.
export const __test = {
  deOvershoot,
  bundleSiblings,
  rerouteBackEdges,
  countCrossings,
}
