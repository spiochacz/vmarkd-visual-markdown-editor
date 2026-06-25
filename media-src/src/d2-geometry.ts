// Shared axis-aligned geometry primitives for the D2 layout pipeline (task 123). These were duplicated
// between d2-render.ts (route simplification for the SVG serializer) and d2-refine.ts (crossing counter +
// the A* router's clearance maths). Consolidated here so both the serializer (d2-render → simplifyRoute/
// straightenEnds), the refinement passes (d2-refine → countCrossings et al.), and the back-edge router
// (astar.ts) import ONE copy. Pure functions, no layout/model imports — this is a leaf module.

// A point is [x, y]; the looser `number[]` form is accepted because route polylines are stored as number[][].
export type Pt = [number, number] | number[]
// An axis-aligned rectangle in drawn coords (route-simplification obstacle).
export type Rect = { x: number; y: number; w: number; h: number }

// box inflation for hard-obstacle hit tests + grid lines at box edges ±M (shared by segHitsABox + astar)
export const ASTAR_M = 10

// --- segment crossing (the proper-intersection test, identical in both former copies) ---
const dccw = (a: Pt, b: Pt, c: Pt) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
// Proper segment-segment intersection (the edge-crossing guard used by countCrossings, simplifyRoute, astar).
export function segsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = dccw(p3, p4, p1)
  const d2 = dccw(p3, p4, p2)
  const d3 = dccw(p1, p2, p3)
  const d4 = dccw(p1, p2, p4)
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
}

// --- route simplification (mirrors D2's deleteBends): drop collinear points, then straighten
// interior staircases into a single L — but ONLY when the straightened L clears every node box
// (obstacle guard). First/last segments are left alone (they own the node ports). ---
function dedupeCollinear(pts: number[][]): number[][] {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const colX = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5
    const colY = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5
    if (!colX && !colY) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}
function segHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
  m: number,
): boolean {
  const x0 = r.x - m
  const x1 = r.x + r.w + m
  const y0 = r.y - m
  const y1 = r.y + r.h + m
  if (Math.abs(ay - by) < 0.5) {
    const lo = Math.min(ax, bx)
    const hi = Math.max(ax, bx)
    return ay > y0 && ay < y1 && lo < x1 && hi > x0
  }
  if (Math.abs(ax - bx) < 0.5) {
    const lo = Math.min(ay, by)
    const hi = Math.max(ay, by)
    return ax > x0 && ax < x1 && lo < y1 && hi > y0
  }
  return true // non-orthogonal: refuse (never introduce a diagonal through open space)
}
// Perpendicular distance from point q to segment a–b (for the label-anchor guard in simplifyRoute).
function pointSegDist(q: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(q[0] - a[0], q[1] - a[1])
  let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy))
}
// `anchor`: an inline-label point the drawn line must stay under. ELK routes a labelled edge through a
// side channel so its inline label clears the parallel edge (e.g. d1_pipeline run sits on its x=80
// channel, not the x=94 attach column). Straightening that channel back to the column would strand the
// label beside the line (then the label mask cuts empty space) — so refuse it. task 122
// `otherSegs`: segments of all OTHER edges. simplifyRoute straightens a jog only if the new segment hits
// no box AND crosses none of these — without it, straightening a back-edge's detour can pull a long
// segment across another edge (e.g. sso `assertion` straightened over `lookup`). task 122
export function simplifyRoute(
  pts: number[][],
  obstacles: Rect[],
  anchor?: number[],
  otherSegs: number[][][] = [],
): number[][] {
  let p = dedupeCollinear(pts)
  // Box clearance for a straightened segment. D2's deleteBends treats a box as hit at edge_node_spacing-1
  // (=39px) so it won't pull a route up against a box (d2elklayout/layout.go countObjectIntersects). Match
  // that — a tiny 3px buffer let our straightening cancel the wider bend clearance ELK now reserves. task 122
  const M = 39
  let changed = true
  let guard = 0
  while (changed && guard++ < 40) {
    changed = false
    // keep the first & last segments (node ports) → only straighten interior jogs (i in [2, len-4])
    for (let i = 2; i <= p.length - 4; i++) {
      const A = p[i - 1]
      const D = p[i + 2]
      // Would replacing A→p[i]→p[i+1]→D with A→corner→D strand the label anchor off the line?
      const keepsAnchor = (corner: number[]): boolean => {
        if (!anchor) return true
        const distOld = Math.min(
          pointSegDist(anchor, A, p[i]),
          pointSegDist(anchor, p[i], p[i + 1]),
          pointSegDist(anchor, p[i + 1], D),
        )
        const distNew = Math.min(
          pointSegDist(anchor, A, corner),
          pointSegDist(anchor, corner, D),
        )
        return !(distNew > distOld + 0.5 && distNew > 8)
      }
      for (const corner of [
        [D[0], A[1]],
        [A[0], D[1]],
      ]) {
        const blocked =
          obstacles.some((r) =>
            segHitsRect(A[0], A[1], corner[0], corner[1], r, M),
          ) ||
          obstacles.some((r) =>
            segHitsRect(corner[0], corner[1], D[0], D[1], r, M),
          ) ||
          // don't straighten a jog across another edge (would create a crossing the bent route avoided)
          otherSegs.some(
            (s) =>
              segsCross(A, corner, s[0], s[1]) ||
              segsCross(corner, D, s[0], s[1]),
          )
        if (!blocked && keepsAnchor(corner)) {
          p = dedupeCollinear([...p.slice(0, i), corner, ...p.slice(i + 2)])
          changed = true
          break
        }
      }
      if (changed) break
    }
  }
  return p
}
// The leaf box whose border the point sits on (the box an edge endpoint attaches to). Used by
// straightenEnds to verify a straightened attach point stays on the same border.
function endpointBox(a: number[], obstacles: Rect[]): Rect | null {
  for (const r of obstacles) {
    const onV =
      (Math.abs(a[0] - r.x) < 1.5 || Math.abs(a[0] - (r.x + r.w)) < 1.5) &&
      a[1] >= r.y - 1.5 &&
      a[1] <= r.y + r.h + 1.5
    const onH =
      (Math.abs(a[1] - r.y) < 1.5 || Math.abs(a[1] - (r.y + r.h)) < 1.5) &&
      a[0] >= r.x - 1.5 &&
      a[0] <= r.x + r.w + 1.5
    if (onV || onH) return r
  }
  return null
}
// Straighten a 3-point S-jog at each END of the route into one straight segment, IF the line still
// attaches within the endpoint box border (±10px) and the straightened segment adds no new box
// collision. Mirrors D2's deleteBends "S-shapes at the source and the target" pass
// (d2elklayout/layout.go) — removes the tiny port-attach steps ELK leaves when a node has several edges
// (each gets a distinct attach point that then steps to its routing channel). task 122
export function straightenEnds(pts: number[][], obstacles: Rect[]): number[][] {
  let p = pts
  for (const isSource of [true, false]) {
    if (p.length < 4) break
    const n = p.length
    const a = isSource ? p[0] : p[n - 1] // attach point on the box border
    const b = isSource ? p[1] : p[n - 2] // corner
    const c = isSource ? p[2] : p[n - 3] // next point (kept)
    const box = endpointBox(a, obstacles)
    if (!box) continue
    const vertFirst = Math.abs(a[0] - b[0]) < 0.5 // a→b runs vertically
    const newA = vertFirst ? [c[0], a[1]] : [a[0], c[1]]
    // Only absorb a SMALL port-attach kink — not a genuine routing step. The attach moves by |a−c| along
    // the border; collapsing a big step would drag the line to attach near a corner instead of where ELK
    // entered (e.g. d2_hub `route` enters orders' centre x=174 via a 66px step; straightening it would
    // re-attach at x=240, the box's right edge). Cap at ~½ a small node so only pixel-level steps go.
    const MAX_KINK = 24
    if (Math.abs(vertFirst ? c[0] - a[0] : c[1] - a[1]) > MAX_KINK) continue
    // still attached? the moved coordinate must stay inside the border edge (D2's ±10 margin)
    if (vertFirst) {
      if (c[0] <= box.x + 10 || c[0] >= box.x + box.w - 10) continue
    } else {
      if (c[1] <= box.y + 10 || c[1] >= box.y + box.h - 10) continue
    }
    // refuse if the straightened segment cuts through a DIFFERENT box than the S already did
    const others = obstacles.filter((r) => r !== box)
    const oldHit = others.filter(
      (r) =>
        segHitsRect(a[0], a[1], b[0], b[1], r, 3) ||
        segHitsRect(b[0], b[1], c[0], c[1], r, 3),
    ).length
    const newHit = others.filter((r) =>
      segHitsRect(newA[0], newA[1], c[0], c[1], r, 3),
    ).length
    if (newHit > oldHit) continue
    // commit: drop a,b,c → newA reconnects to the rest (newA→p[3] / p[n-4]→newA stays orthogonal)
    p = dedupeCollinear(
      isSource ? [newA, ...p.slice(3)] : [...p.slice(0, n - 3), newA],
    )
  }
  return p
}

// --- A* clearance primitives (the back-edge router's obstacle maths; used by astar.ts) ---
export interface ABox {
  x: number
  y: number
  w: number
  h: number
  id?: string
  kind?: string
}

export function segHitsABox(a: Pt, b: Pt, B: ABox): boolean {
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
// perpendicular distance from an axis-aligned segment a-b to (un-inflated) box B
export function boxDist(a: Pt, b: Pt, B: ABox): number {
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
export function wallDist(a: Pt, b: Pt, B: ABox): number {
  const o = boxDist(a, b, B)
  if (o > 0) return o
  const ins = (p: Pt) =>
    Math.min(p[0] - B.x, B.x + B.w - p[0], p[1] - B.y, B.y + B.h - p[1])
  return Math.max(0, Math.min(ins(a), ins(b)))
}
// perpendicular gap between two PARALLEL axis-aligned segments whose extents overlap (else 1e9)
export function parDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
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
