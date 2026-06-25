// Back-edge A* router (task 122/123). A "back-edge" climbs UP (its destination sits above its source);
// ELK routes those poorly. d2-refine's rerouteBackEdges A*-routes only the MIDDLE of such an edge on a
// Hanan grid (PRESERVING both ELK port stubs verbatim), then greedily accepts the reroute only if it
// doesn't increase the total crossing count. This module is the router itself (grid build + binary-heap
// A*); the clearance maths it needs (segHitsABox/boxDist/wallDist/parDist/segsCross + ASTAR_M) live in the
// shared leaf module. Extracted from d2-refine.ts so the router is independently testable and the
// rerouteBackEdges → astar → (geometry, not refine) dependency stays acyclic. Ported from
// tmp/d2-compare/run67.mjs.
import {
  ASTAR_M,
  type ABox,
  boxDist,
  parDist,
  type Pt,
  segHitsABox,
  segsCross,
  wallDist,
} from './d2-geometry'

const COMFORT = 40 // below this clearance to an obstacle, pay a penalty
const COMFW = 6 // penalty weight per px short of COMFORT / EDGECLR
const EDGECLR = 20 // below this parallel-proximity to another edge, pay a penalty
const ASTAR_PAD = 64 // pad the clearance-object bbox so lanes exist outside peripheral boxes/walls
const ASTAR_STEP = 24 // densify grid lines to this resolution

interface ANode {
  i: number
  j: number
  g: number
  f: number
  di: number | null
  dj: number | null
  prev: ANode | null
  seq: number // push order — the open-set tie-break (see astar's heap)
}

// A* on a Hanan grid. `boxes` = HARD obstacles; `clearObs` = SOFT clearance set (+ containers). Returns
// the routed middle polyline, or null if no path.
export function astar(
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
  // Numeric cell index i*Yl+j (was a `${i}_${j}` string key) — hot map/set lookups, identical semantics.
  const Yl = Y.length
  const si = X.indexOf(start[0])
  const sj = Y.indexOf(start[1])
  const gi = X.indexOf(goal[0])
  const gj = Y.indexOf(goal[1])
  // Walkable grid. Build by MARKING the cells each inflated box covers as blocked (O(boxes × box-cells)),
  // instead of testing every cell against every box (O(cells × boxes)). Identical result: a cell is blocked
  // iff it falls inside some inflated box — X[i] ∈ (B.x−M, B.x+B.w+M) and Y[j] ∈ (B.y−M, B.y+B.h+M), the same
  // strict interval the old per-cell test used. start/goal are always re-opened (was `|| isStart || isGoal`).
  const ok = new Uint8Array(X.length * Yl).fill(1)
  for (const B of boxes) {
    const x1 = B.x - ASTAR_M
    const x2 = B.x + B.w + ASTAR_M
    const y1 = B.y - ASTAR_M
    const y2 = B.y + B.h + ASTAR_M
    let i0 = 0
    while (i0 < X.length && X[i0] <= x1) i0++
    let i1 = i0
    while (i1 < X.length && X[i1] < x2) i1++
    let j0 = 0
    while (j0 < Yl && Y[j0] <= y1) j0++
    let j1 = j0
    while (j1 < Yl && Y[j1] < y2) j1++
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++) ok[i * Yl + j] = 0
  }
  ok[si * Yl + sj] = 1
  ok[gi * Yl + gj] = 1
  // Spatial index over edgeSegs for the per-neighbor cost (the dominant inner loop: segsCross + parDist over
  // EVERY other-edge segment, per candidate step). A one-grid-step candidate can only interact with edge
  // segments whose bbox is within EDGECLR: a crossing needs bbox overlap (⊂ the inflated query), and
  // parDist < EDGECLR needs the segment within EDGECLR perpendicular AND overlapping in extent (also ⊂ it).
  // So querying the candidate's bbox inflated by EDGECLR yields the SAME ec (we still run segsCross exactly)
  // and the SAME epp (any segment that could push ep below EDGECLR is captured; farther ones can't). Bucket
  // each segment into the uniform-grid cells its bbox spans.
  const ESCELL = 48
  let eMinX = Number.POSITIVE_INFINITY
  let eMinY = Number.POSITIVE_INFINITY
  let eMaxX = Number.NEGATIVE_INFINITY
  let eMaxY = Number.NEGATIVE_INFINITY
  for (const s of edgeSegs) {
    const lx = s[0][0] < s[1][0] ? s[0][0] : s[1][0]
    const hx = s[0][0] > s[1][0] ? s[0][0] : s[1][0]
    const ly = s[0][1] < s[1][1] ? s[0][1] : s[1][1]
    const hy = s[0][1] > s[1][1] ? s[0][1] : s[1][1]
    if (lx < eMinX) eMinX = lx
    if (hx > eMaxX) eMaxX = hx
    if (ly < eMinY) eMinY = ly
    if (hy > eMaxY) eMaxY = hy
  }
  const eCols = edgeSegs.length
    ? Math.max(1, Math.ceil((eMaxX - eMinX) / ESCELL) + 1)
    : 1
  const eRows = edgeSegs.length
    ? Math.max(1, Math.ceil((eMaxY - eMinY) / ESCELL) + 1)
    : 1
  const eCol = (x: number) =>
    Math.max(0, Math.min(eCols - 1, Math.floor((x - eMinX) / ESCELL)))
  const eRow = (y: number) =>
    Math.max(0, Math.min(eRows - 1, Math.floor((y - eMinY) / ESCELL)))
  const eBuckets: number[][] = Array.from({ length: eCols * eRows }, () => [])
  edgeSegs.forEach((s, idx) => {
    const c0 = eCol(Math.min(s[0][0], s[1][0]))
    const c1 = eCol(Math.max(s[0][0], s[1][0]))
    const r0 = eRow(Math.min(s[0][1], s[1][1]))
    const r1 = eRow(Math.max(s[0][1], s[1][1]))
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) eBuckets[c * eRows + r].push(idx)
  })
  const eStamp = new Int32Array(edgeSegs.length) // dedup marks; query ids start at 1 (default 0 ≠ any id)
  let eQid = 0
  const Hh = (i: number, j: number) =>
    Math.abs(X[i] - X[gi]) + Math.abs(Y[j] - Y[gj])
  // Open set = binary min-heap keyed (f, seq). seq is the push counter; ordering by (f, then earliest seq)
  // reproduces EXACTLY the old per-iteration `open.sort((a,b)=>a.f-b.f)` + shift(): a stable sort breaks
  // equal-f ties by array position, and with shift-front/push-back that position is FIFO push order. Same
  // pop sequence ⇒ byte-identical routed path, but O(N log N) instead of O(N² log N) (was the whole cost).
  const heap: ANode[] = []
  let pushSeq = 0
  const hless = (a: ANode, b: ANode) =>
    a.f < b.f || (a.f === b.f && a.seq < b.seq)
  const hpush = (n: ANode) => {
    n.seq = pushSeq++
    heap.push(n)
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (!hless(heap[c], heap[p])) break
      const t = heap[c]
      heap[c] = heap[p]
      heap[p] = t
      c = p
    }
  }
  const hpop = (): ANode => {
    const top = heap[0]
    const last = heap.pop() as ANode
    if (heap.length) {
      heap[0] = last
      let c = 0
      for (;;) {
        const l = 2 * c + 1
        const r = 2 * c + 2
        let m = c
        if (l < heap.length && hless(heap[l], heap[m])) m = l
        if (r < heap.length && hless(heap[r], heap[m])) m = r
        if (m === c) break
        const t = heap[c]
        heap[c] = heap[m]
        heap[m] = t
        c = m
      }
    }
    return top
  }
  hpush({
    i: si,
    j: sj,
    g: 0,
    f: Hh(si, sj),
    di: inDir[0],
    dj: inDir[1],
    prev: null,
    seq: 0,
  })
  // seen key = cell index folded with the entry direction (di,dj ∈ {-1,0,1} → 0..8). Numeric (was a
  // `${i}_${j}|${di},${dj}` string), identical dedup semantics.
  const seen = new Map<number, number>()
  let goalNode: ANode | null = null
  while (heap.length) {
    const cur = hpop()
    const sk =
      (cur.i * Yl + cur.j) * 9 + ((cur.di ?? 0) + 1) * 3 + ((cur.dj ?? 0) + 1)
    const prevG = seen.get(sk)
    if (prevG !== undefined && prevG <= cur.g) continue
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
      if (!ok[ni * Yl + nj]) continue
      const a: Pt = [X[cur.i], Y[cur.j]]
      const b: Pt = [X[ni], Y[nj]]
      if (boxes.some((B) => segHitsABox(a, b, B))) continue
      const turn = cur.di !== null && (di !== cur.di || dj !== cur.dj) ? 40 : 0
      // Only edge segments near this candidate step can cross it or sit within EDGECLR of it — query the
      // spatial index (margin EDGECLR) instead of scanning all of edgeSegs. ec/ep come out identical.
      eQid++
      let ec = 0
      let ep = 1e9
      const qc0 = eCol(Math.min(a[0], b[0]) - EDGECLR)
      const qc1 = eCol(Math.max(a[0], b[0]) + EDGECLR)
      const qr0 = eRow(Math.min(a[1], b[1]) - EDGECLR)
      const qr1 = eRow(Math.max(a[1], b[1]) + EDGECLR)
      for (let c = qc0; c <= qc1; c++)
        for (let r = qr0; r <= qr1; r++)
          for (const idx of eBuckets[c * eRows + r]) {
            if (eStamp[idx] === eQid) continue
            eStamp[idx] = eQid
            const s2 = edgeSegs[idx]
            if (segsCross(a, b, s2[0], s2[1])) ec++
            const d = parDist(a, b, s2[0], s2[1])
            if (d < ep) ep = d
          }
      let cl = 1e9
      for (const B of clearObs) {
        const d = B.kind === 'container' ? wallDist(a, b, B) : boxDist(a, b, B)
        if (d < cl) cl = d
      }
      const cp = cl < COMFORT ? (COMFORT - cl) * COMFW : 0
      const epp = ep < EDGECLR ? (EDGECLR - ep) * COMFW : 0
      const g =
        cur.g +
        Math.abs(X[ni] - X[cur.i]) +
        Math.abs(Y[nj] - Y[cur.j]) +
        turn +
        ec * 1500 +
        cp +
        epp
      hpush({ i: ni, j: nj, g, f: g + Hh(ni, nj), di, dj, prev: cur, seq: 0 })
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
