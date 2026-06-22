import dagre from '@dagrejs/dagre'
import { mix } from '../../src/mermaid-palettes'
import type { D2Graph, D2Shape } from './d2-wasm'

const FONT_SIZE = 16
export const EDGE_FONT_SIZE = 14
const INNER_PAD = 5
const P = 40 // d2 defaultPadding
export type Sizer = (
  text: string,
  fontSize?: number,
) => { w: number; h: number } // import to type a custom measure fn

const ceil = Math.ceil
const SQRT2 = Math.SQRT2
const esc = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Faithful D2 lib/shape GetDimensionsToFit. (w,h) = labelDims + INNER_PAD already applied.
function dimsToFit(
  shape: string,
  w: number,
  h: number,
): { w: number; h: number } {
  switch (shape) {
    case 'square': {
      const s = ceil(Math.max(w + P, h + P))
      return { w: s, h: s }
    }
    case 'circle': {
      const d = ceil(SQRT2 * Math.max(w + P / SQRT2, h + P / SQRT2))
      return { w: d, h: d }
    }
    case 'oval': {
      const t = Math.atan2(h, w)
      return {
        w: ceil(SQRT2 * (w + P * Math.cos(t))),
        h: ceil(SQRT2 * (h + P * Math.sin(t))),
      }
    }
    case 'diamond':
      return { w: ceil(2 * (w + 10)), h: ceil(2 * (h + 20)) }
    case 'hexagon':
      return { w: ceil(1.5 * (w + 20)), h: ceil(1.5 * (h + 20)) }
    case 'cylinder':
      return { w: ceil(w + P), h: ceil(h + 20 + 72) }
    case 'parallelogram':
      return { w: ceil(w + P + 52), h: ceil(h + P) }
    case 'document':
      return { w: ceil(w + P), h: ceil(((h + 29.59) * 18.925) / 14) }
    case 'page':
      return { w: ceil(w + P), h: ceil(h + 60.348) }
    default:
      return { w: ceil(w + P), h: ceil(h + P) } // rectangle/"": (40,40)
  }
}

export function shapeBox(shape: string, m: { w: number; h: number }) {
  return dimsToFit(shape, m.w + INNER_PAD, m.h + INNER_PAD)
}

// Contrast label colour: with an explicit fill the colour is theme-independent, so pick black/white
// by luminance. Without a fill (transparent), follow the theme via currentColor.
function labelColor(fill?: string): string {
  if (!fill || fill === 'transparent' || fill[0] !== '#') return 'currentColor'
  const hex = fill.replace('#', '')
  if (hex.length < 6) return 'currentColor'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? '#ffffff' : '#0a0f25'
}

// Common shape paint attributes from D2 style (B: strokeWidth/strokeDash/opacity + per-node stroke/fill).
// `defaultStroke`/`defaultFill` are the palette defaults (task 119) used only when the shape sets none —
// an explicit source `style:{fill/stroke}` always wins (fallback-only, like task 94's DOT defaults).
function paintAttrs(
  s: Partial<D2Shape>,
  defaultFill: string,
  defaultStroke = 'currentColor',
): string {
  const stroke = s.stroke || defaultStroke
  const fill = s.fill || defaultFill
  const sw = s.strokeWidth ? Number(s.strokeWidth) : 2
  let a = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`
  if (s.strokeDash && Number(s.strokeDash) > 0)
    a += ` stroke-dasharray="${s.strokeDash},${s.strokeDash}"`
  if (s.opacity && Number(s.opacity) !== 1) a += ` opacity="${s.opacity}"`
  return a
}

// Task 119 — D2-style auto-colour. A content-paired palette ({bg,fg,line,accent,muted}) → the default
// fill/stroke a shape uses when it has no explicit style. Theme-aware: tints derive from the palette so
// they read on light AND dark (no baked background — the canvas stays transparent over the themed
// surface). No palette → today's monochrome (transparent fill, currentColor stroke).
export interface D2Palette {
  bg: string
  fg: string
  line?: string
  accent?: string
  muted?: string
}
interface D2Style {
  leafFill: string
  leafStroke: string
  contFill: string
  contStroke: string
  contOpacity: string
  mono: boolean
}
export function paletteStyle(p?: D2Palette): D2Style {
  if (!p)
    return {
      leafFill: 'transparent',
      leafStroke: 'currentColor',
      contFill: 'transparent',
      contStroke: 'currentColor',
      contOpacity: '0.04',
      mono: true,
    }
  const accent = p.accent || p.line || p.fg
  return {
    leafFill: mix(p.bg, accent, 0.1), // subtle accent-tinted surface
    leafStroke: accent, // coloured border, D2-like
    contFill: mix(p.bg, p.fg, 0.05), // muted container surface
    contStroke: mix(p.fg, accent, 0.4),
    contOpacity: '1',
    mono: false,
  }
}

// Label paint: explicit fontColor > contrast-vs-fill > currentColor; + bold/italic. `effFill` is the
// palette default fill the shape actually got (task 119) — contrast the label against THAT (not the
// undefined source fill) so text stays legible on a coloured tint on light AND dark themes.
function textAttrs(
  s: Partial<D2Shape>,
  fontSize = FONT_SIZE,
  effFill?: string,
): string {
  const color = s.fontColor || labelColor(s.fill || effFill)
  let a = `font-size="${fontSize}" fill="${color}"`
  if (s.bold) a += ' font-weight="700"'
  if (s.italic) a += ' font-style="italic"'
  return a
}

// --- content sizing for the bespoke box shapes (sql_table / class) ---
const ROW_H = 26
const HEADER_H = 32
const CELL_PAD = 10

export function sqlTableSize(
  s: D2Shape,
  measure: Sizer,
): { w: number; h: number; cols: number[] } {
  const cols = [0, 0, 0] // name | type | constraint
  for (const c of s.columns || []) {
    cols[0] = Math.max(cols[0], measure(c.name).w)
    cols[1] = Math.max(cols[1], measure(c.type || '').w)
    cols[2] = Math.max(cols[2], measure(c.constraint || '').w)
  }
  const headerW = measure(s.label).w
  const bodyW = cols[0] + cols[1] + cols[2] + CELL_PAD * 4
  const w = ceil(Math.max(headerW + CELL_PAD * 2, bodyW, 120))
  const h = HEADER_H + (s.columns?.length || 0) * ROW_H
  return { w, h, cols }
}

export function classSize(
  s: D2Shape,
  measure: Sizer,
): { w: number; h: number } {
  const line = (
    m: { name: string; type?: string; visibility?: string },
    method: boolean,
  ) =>
    `${vis(m.visibility)} ${m.name}${m.type ? (method ? ' ' : ': ') + m.type : ''}`
  let maxW = measure(s.label).w
  for (const f of s.fields || [])
    maxW = Math.max(maxW, measure(line(f, false)).w)
  for (const m of s.methods || [])
    maxW = Math.max(maxW, measure(line(m, true)).w)
  const w = ceil(maxW + CELL_PAD * 2)
  const h =
    HEADER_H +
    ((s.fields?.length || 0) + (s.methods?.length || 0)) * ROW_H +
    (s.methods?.length ? 1 : 0)
  return { w, h }
}

function vis(v?: string): string {
  return v === 'private' ? '-' : v === 'protected' ? '#' : '+'
}

// ============================================================================
// Engine-neutral layout model. Both the dagre and ELK layout passes produce a
// `Layout`; `toSVG` renders it. This lets the layout engine be swapped (the
// `vmarkd.diagram.d2Layout` setting) without touching the SVG generation.
// ============================================================================
export type NodeKind = 'container' | 'grid' | 'sql' | 'class' | 'shape'
export interface GridInfo {
  cols: number
  cellW: number
  cellH: number
  children: D2Shape[]
  headerH: number
}
export interface PlacedNode {
  s: D2Shape
  x: number // absolute top-left (no margin)
  y: number
  w: number
  h: number
  kind: NodeKind
  sqlCols?: number[]
  grid?: GridInfo
}
export interface PlacedEdge {
  points: [number, number][]
  srcArrow: boolean
  dstArrow: boolean
  label?: string
  lx?: number
  ly?: number
  lw?: number // label box width (for the on-line mask, task 122)
  lh?: number
  src?: string // endpoint node ids — lets toSVG spot parallel/antiparallel pairs (task 122)
  dst?: string
}
export interface Layout {
  W: number
  H: number
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  edgeStyle: 'spline' | 'orthogonal'
}

// Which shapes are non-grid containers (laid out compound/hierarchically) vs grid containers
// (children placed manually) — shared by both layout engines.
export function classify(graph: D2Graph) {
  const byId = new Map<string, D2Shape>()
  for (const s of graph.shapes) byId.set(s.id, s)
  const parents = new Set<string>()
  for (const s of graph.shapes) if (s.container) parents.add(s.container)
  const gridIds = new Set<string>()
  for (const s of graph.shapes)
    if (s.special.isGrid && parents.has(s.id)) gridIds.add(s.id)
  const containers = new Set<string>()
  for (const id of parents) if (!gridIds.has(id)) containers.add(id)
  const inGrid = (s: D2Shape) => !!s.container && gridIds.has(s.container)
  return { byId, parents, gridIds, containers, inGrid }
}

export function computeGridInfo(
  graph: D2Graph,
  measure: Sizer,
  gridIds: Set<string>,
): Map<string, GridInfo> {
  const out = new Map<string, GridInfo>()
  for (const id of gridIds) {
    const s = graph.shapes.find((x) => x.id === id)!
    const children = graph.shapes.filter((c) => c.container === id)
    const n = children.length || 1
    const gc = s.special.gridColumns ? Number(s.special.gridColumns) : 0
    const gr = s.special.gridRows ? Number(s.special.gridRows) : 0
    const cols = gc || (gr ? ceil(n / gr) : ceil(Math.sqrt(n)))
    let cellW = 0
    let cellH = 0
    for (const c of children) {
      const b = shapeBox(c.shape, measure(c.label))
      cellW = Math.max(cellW, b.w)
      cellH = Math.max(cellH, b.h)
    }
    const headerH = s.label ? measure(s.label).h + 12 : 0
    out.set(id, {
      cols,
      cellW: cellW + 16,
      cellH: cellH + 16,
      children,
      headerH,
    })
  }
  return out
}

// Size + kind of a LEAF (a shape that is not a non-grid container): grid container, sql_table,
// class, or a normal shape. Used by both layout engines to size dagre/ELK nodes.
export function leafInfo(
  s: D2Shape,
  measure: Sizer,
  gridInfo: Map<string, GridInfo>,
): {
  w: number
  h: number
  kind: NodeKind
  sqlCols?: number[]
  grid?: GridInfo
} {
  if (gridInfo.has(s.id)) {
    const gi = gridInfo.get(s.id)!
    const rows = ceil(gi.children.length / gi.cols)
    return {
      w: gi.cols * gi.cellW + 16,
      h: rows * gi.cellH + gi.headerH + 16,
      kind: 'grid',
      grid: gi,
    }
  }
  if (s.shape === 'sql_table') {
    const sz = sqlTableSize(s, measure)
    return { w: sz.w, h: sz.h, kind: 'sql', sqlCols: sz.cols }
  }
  if (s.shape === 'class') {
    const sz = classSize(s, measure)
    return { w: sz.w, h: sz.h, kind: 'class' }
  }
  const box = shapeBox(s.shape, measure(s.label))
  return { w: box.w, h: box.h, kind: 'shape' }
}

// ---------------- dagre layout (default engine) ----------------
function layoutDagre(graph: D2Graph, measure: Sizer): Layout {
  const { gridIds, containers, inGrid } = classify(graph)
  const gridInfo = computeGridInfo(graph, measure, gridIds)
  const g: any = new (dagre as any).graphlib.Graph({
    compound: true,
    multigraph: true,
  })
  g.setGraph({
    rankdir: 'TB',
    nodesep: 60,
    ranksep: 100,
    edgesep: 20,
    marginx: 10,
    marginy: 10,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const s of graph.shapes) {
    if (inGrid(s)) continue
    if (containers.has(s.id)) {
      g.setNode(s.id, {
        src: s,
        kind: 'container',
        headerH: measure(s.label).h + 10,
      })
    } else {
      const li = leafInfo(s, measure, gridInfo)
      g.setNode(s.id, {
        width: li.w,
        height: li.h,
        src: s,
        kind: li.kind,
        sqlCols: li.sqlCols,
        grid: li.grid,
      })
    }
  }
  for (const s of graph.shapes) {
    if (inGrid(s) || gridIds.has(s.id)) continue
    if (s.container && containers.has(s.container) && g.hasNode(s.container))
      g.setParent(s.id, s.container)
  }
  let ei = 0
  for (const e of graph.edges) {
    if (!g.hasNode(e.src) || !g.hasNode(e.dst)) continue
    const el = e.label ? measure(e.label, EDGE_FONT_SIZE) : { w: 0, h: 0 }
    g.setEdge(
      e.src,
      e.dst,
      {
        label: e.label || '',
        width: el.w,
        height: el.h,
        srcArrow: e.srcArrow,
        dstArrow: e.dstArrow,
      },
      `e${ei++}`,
    )
  }
  ;(dagre as any).layout(g)

  const gg = g.graph()
  const nodes: PlacedNode[] = []
  for (const id of g.nodes()) {
    const n = g.node(id)
    nodes.push({
      s: n.src,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      w: n.width,
      h: n.height,
      kind: n.kind,
      sqlCols: n.sqlCols,
      grid: n.grid,
    })
  }
  const edges: PlacedEdge[] = []
  for (const eo of g.edges()) {
    const e = g.edge(eo)
    edges.push({
      points: e.points.map((p: any) => [p.x, p.y]),
      srcArrow: e.srcArrow,
      dstArrow: e.dstArrow,
      label: e.label,
      lx: e.x,
      ly: e.y,
    })
  }
  return {
    W: ceil(gg.width),
    H: ceil(gg.height),
    nodes,
    edges,
    edgeStyle: 'spline',
  }
}

export function renderD2Graph(
  graph: D2Graph,
  measure: Sizer,
  palette?: D2Palette,
): string {
  return toSVG(layoutDagre(graph, measure), palette)
}

// ---------------- SVG generation (engine-neutral) ----------------
const esc2 = esc

function splinePath(pts: number[][]): string {
  if (pts.length < 3)
    return pts
      .map(
        (p, i) =>
          `${(i === 0 ? 'M' : 'L') + p[0].toFixed(1)},${p[1].toFixed(1)}`,
      )
      .join(' ')
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function polyPath(pts: number[][]): string {
  return pts
    .map(
      (p, i) => `${(i === 0 ? 'M' : 'L') + p[0].toFixed(1)},${p[1].toFixed(1)}`,
    )
    .join(' ')
}

// Move `from` toward `to` by `dist` (clamped to the segment length). Mirrors D2's
// getArrowheadAdjustments: retract a route endpoint so the stroke meets the arrowhead base / shape
// border cleanly instead of poking through it (task 122).
function towards(from: number[], to: number[], dist: number): number[] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  const t = Math.min(dist, len) / len
  return [from[0] + dx * t, from[1] + dy * t]
}

// Orthogonal path with ROUNDED corners — mirrors D2's pathData (task 122): straight `L` to just
// before each bend, then a quadratic through the corner (control = the corner point), radius clamped
// to half of each adjacent segment so it never overshoots. < 3 points → plain polyline.
const CORNER_R = 8
function roundedPolyPath(pts: number[][], r = CORNER_R): string {
  if (pts.length < 3) return polyPath(pts)
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1
    const ru = Math.min(r, inLen / 2, outLen / 2)
    const ix = cur[0] - ((cur[0] - prev[0]) / inLen) * ru
    const iy = cur[1] - ((cur[1] - prev[1]) / inLen) * ru
    const ox = cur[0] + ((next[0] - cur[0]) / outLen) * ru
    const oy = cur[1] + ((next[1] - cur[1]) / outLen) * ru
    d += ` L${ix.toFixed(1)},${iy.toFixed(1)} Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${ox.toFixed(1)},${oy.toFixed(1)}`
  }
  const last = pts[pts.length - 1]
  d += ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`
  return d
}

function arrow(x: number, y: number, angle: number, color: string): string {
  const len = 10
  const a1 = angle + Math.PI - 0.4
  const a2 = angle + Math.PI + 0.4
  const x1 = x + len * Math.cos(a1)
  const y1 = y + len * Math.sin(a1)
  const x2 = x + len * Math.cos(a2)
  const y2 = y + len * Math.sin(a2)
  return `<polygon points="${x},${y} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="${color}"/>`
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
type Rect = { x: number; y: number; w: number; h: number }
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
// Proper segment-segment intersection (for the edge-crossing guard below).
function segsCross(
  p1: number[],
  p2: number[],
  p3: number[],
  p4: number[],
): boolean {
  const d = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
}
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
// Point at half the arc-length of a polyline — where an on-line label sits (D2 INSIDE_MIDDLE_CENTER).
function polylineMidpoint(pts: number[][]): number[] {
  if (pts.length < 2) return pts[0] ?? [0, 0]
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    seg.push(d)
    total += d
  }
  let half = total / 2
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i]) {
      const t = seg[i] ? half / seg[i] : 0
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ]
    }
    half -= seg[i]
  }
  return pts[pts.length - 1]
}

// Small deterministic string hash (djb2) → a stable, collision-unlikely id suffix so multiple D2
// SVGs on one page don't share a <mask> id. No Math.random — keep toSVG pure/deterministic.
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function toSVG(layout: Layout, palette?: D2Palette): string {
  const OFF = 10
  const W = layout.W + 20
  const H = layout.H + 20
  const themeColor = 'currentColor'
  const sty = paletteStyle(palette) // task 119 — default shape fill/stroke (mono when no palette)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='"Source Sans 3","Source Sans Pro",system-ui,sans-serif'>`,
  ]

  // Simplify each route (collinear cleanup + interior staircase → L, obstacle-guarded — mirrors D2's
  // deleteBends). Leaf nodes are obstacles; containers/grids are NOT (edges legitimately enter them).
  const obstacles: Rect[] = layout.nodes
    .filter((n) => n.kind !== 'container' && n.kind !== 'grid')
    .map((n) => ({ x: n.x + OFF, y: n.y + OFF, w: n.w, h: n.h }))
  // Node-pairs carrying MORE THAN ONE edge (parallel/antiparallel, e.g. d1_pipeline ci↔test run+report).
  // ELK routes each such edge through its own side channel so the two inline labels don't collide; the
  // anchor-guard below preserves those channels. A lone edge (e.g. notify) needs no channel — guarding it
  // would freeze ELK's staircase instead of letting simplifyRoute clean it. task 122
  const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`)
  const pairCount = new Map<string, number>()
  for (const e of layout.edges)
    if (e.src && e.dst) {
      const k = pairKey(e.src, e.dst)
      pairCount.set(k, (pairCount.get(k) || 0) + 1)
    }
  // raw (pre-simplify) segments per edge, in drawn coords — the edge-crossing reference for simplifyRoute
  const rawSegs = layout.edges.map((e) => {
    const s: number[][][] = []
    const pp = e.points
    for (let i = 0; i + 1 < pp.length; i++)
      s.push([
        [pp[i][0] + OFF, pp[i][1] + OFF],
        [pp[i + 1][0] + OFF, pp[i + 1][1] + OFF],
      ])
    return s
  })
  const drawn = layout.edges.map((e, ei) => {
    // Keep the line under its inline label (ELK's lx/ly) so simplifyRoute doesn't straighten the label
    // channel out from under the text — but ONLY for parallel pairs, where ELK made that channel to keep
    // their labels apart. For a lone labelled edge, let it straighten (no anchor). task 122
    const isParallel =
      !!e.src && !!e.dst && (pairCount.get(pairKey(e.src, e.dst)) || 0) >= 2
    const anchor =
      isParallel && e.label && e.lx != null && e.ly != null
        ? [e.lx + OFF, e.ly + OFF]
        : undefined
    const otherSegs: number[][][] = []
    for (let j = 0; j < rawSegs.length; j++)
      if (j !== ei) for (const s of rawSegs[j]) otherSegs.push(s)
    const route = straightenEnds(
      simplifyRoute(
        e.points.map((p) => [p[0] + OFF, p[1] + OFF]),
        obstacles,
        anchor,
        otherSegs,
      ),
      obstacles,
    )
    // On-line label position. For a guarded parallel edge the channel (and ELK's deconfliction spread) is
    // preserved, so use ELK's lx/ly. For a lone edge we let the route straighten, so ELK's point can be
    // off the new line — follow the simplified route's midpoint instead. ELK edges carry lw/lh → masked.
    const masked = !!(e.label && e.lw && e.lh)
    const lpos = e.label
      ? anchor && e.lx != null && e.ly != null
        ? [e.lx + OFF, e.ly + OFF]
        : polylineMidpoint(route)
      : null
    return { e, route, lpos, masked }
  })

  // On-line edge labels (task 122): cut the connection line out from UNDER each label box with a mask
  // (like D2's makeLabelMask) so the centred label reads cleanly without an opaque plate — works on
  // any theme bg. Unique mask id per diagram (content hash) avoids id collisions between SVGs.
  const labelRects = drawn
    .filter((d) => d.masked && d.lpos)
    .map((d) => ({
      x: (d.lpos as number[])[0] - (d.e.lw as number) / 2 - 3,
      y: (d.lpos as number[])[1] - (d.e.lh as number) / 2 - 1,
      w: (d.e.lw as number) + 6,
      h: (d.e.lh as number) + 2,
    }))
  // Canvas bounds: W/H were sized to NODE extents only (layout.W/H). But the A* back-edge router may route a
  // loop in its PAD margin OUTSIDE the node box (even negative x — see cicd2's reg→staging cycle-closer), and
  // labels can poke past too. Such geometry gets clipped by the viewBox AND masked out by the label mask
  // (whose white rect is 0,0,W,H → anything outside reads as masked). Grow the viewBox + mask to cover ALL
  // drawn geometry (nodes + simplified routes + label boxes). Only the overflowing side grows, so diagrams
  // that fit stay byte-identical (vb* === 0/W/H).
  let gMinX = 0
  let gMinY = 0
  let gMaxX = W
  let gMaxY = H
  for (const n of layout.nodes) {
    gMinX = Math.min(gMinX, n.x + OFF)
    gMinY = Math.min(gMinY, n.y + OFF)
    gMaxX = Math.max(gMaxX, n.x + OFF + n.w)
    gMaxY = Math.max(gMaxY, n.y + OFF + n.h)
  }
  for (const d of drawn)
    for (const p of d.route) {
      gMinX = Math.min(gMinX, p[0])
      gMinY = Math.min(gMinY, p[1])
      gMaxX = Math.max(gMaxX, p[0])
      gMaxY = Math.max(gMaxY, p[1])
    }
  for (const r of labelRects) {
    gMinX = Math.min(gMinX, r.x)
    gMinY = Math.min(gMinY, r.y)
    gMaxX = Math.max(gMaxX, r.x + r.w)
    gMaxY = Math.max(gMaxY, r.y + r.h)
  }
  const VBMARGIN = 6
  const vbX = gMinX < 0 ? Math.floor(gMinX) - VBMARGIN : 0
  const vbY = gMinY < 0 ? Math.floor(gMinY) - VBMARGIN : 0
  const vbW = (gMaxX > W ? Math.ceil(gMaxX) + VBMARGIN : W) - vbX
  const vbH = (gMaxY > H ? Math.ceil(gMaxY) + VBMARGIN : H) - vbY
  if (vbX !== 0 || vbY !== 0 || vbW !== W || vbH !== H)
    parts[0] = `<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" font-family='"Source Sans 3","Source Sans Pro",system-ui,sans-serif'>`
  const maskId = `vmarkd-d2lbl-${djb2(`${W}x${H}:${layout.edges.map((e) => e.label || '').join('|')}`)}`
  const maskAttr = labelRects.length ? ` mask="url(#${maskId})"` : ''
  if (labelRects.length) {
    parts.push(
      `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}"><rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="white"/>${labelRects
        .map(
          (r) =>
            `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="black"/>`,
        )
        .join('')}</mask></defs>`,
    )
  }

  // Background pass — containers + grids FIRST so their fills sit BEHIND the edges. With task 119
  // colouring the container fill is OPAQUE; drawing it after the edges (the old order) hid any edge
  // entering a container (e.g. bus→shipping vanished under the Services fill). Leaves are drawn AFTER
  // the edges (foreground pass below) so an edge still trims cleanly at a leaf border.
  for (const n of layout.nodes) {
    if (n.kind !== 'container' && n.kind !== 'grid') continue
    const s = n.s
    const left = n.x + OFF
    const top = n.y + OFF
    if (n.kind === 'grid' && n.grid) {
      parts.push(drawGrid(s, n.grid, left, top, n.w, n.h, sty))
      continue
    }
    const rx = s.borderRadius || 6
    parts.push(
      `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${n.w.toFixed(1)}" height="${n.h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, sty.contFill, sty.contStroke)} fill-opacity="${s.fill ? '1' : sty.contOpacity}"/>`,
    )
    parts.push(
      `<text x="${(left + 8).toFixed(1)}" y="${(top + 16).toFixed(1)}" ${textAttrs(s, FONT_SIZE, sty.contFill)}>${esc2(s.label)}</text>`,
    )
  }

  for (const { e, route, lpos } of drawn) {
    // Retract the line ends so the stroke meets the arrowhead base / border, not the node centre
    // (mirrors D2's getArrowheadAdjustments); the arrowhead itself stays at the original endpoint.
    const rp = route.map((p) => [p[0], p[1]])
    if (rp.length >= 2) {
      const last = rp.length - 1
      rp[last] = towards(rp[last], rp[last - 1], e.dstArrow !== false ? 9 : 1)
      rp[0] = towards(rp[0], rp[1], e.srcArrow === true ? 9 : 1)
    }
    const d =
      layout.edgeStyle === 'orthogonal' ? roundedPolyPath(rp) : splinePath(rp)
    parts.push(
      `<path d="${d}" fill="none" stroke="${themeColor}" stroke-width="2"${maskAttr}/>`,
    )
    const n = route.length
    if (e.dstArrow !== false && n >= 2) {
      const a = Math.atan2(
        route[n - 1][1] - route[n - 2][1],
        route[n - 1][0] - route[n - 2][0],
      )
      parts.push(arrow(route[n - 1][0], route[n - 1][1], a, themeColor))
    }
    if (e.srcArrow === true && n >= 2) {
      const a = Math.atan2(route[0][1] - route[1][1], route[0][0] - route[1][0])
      parts.push(arrow(route[0][0], route[0][1], a, themeColor))
    }
    if (e.label && lpos) {
      parts.push(
        `<text x="${lpos[0].toFixed(1)}" y="${lpos[1].toFixed(1)}" font-size="${EDGE_FONT_SIZE}" text-anchor="middle" dominant-baseline="middle" fill="${themeColor}">${esc2(e.label)}</text>`,
      )
    }
  }

  // Foreground pass — leaf shapes (sql/class/basic) ON TOP of the edges (edges trim at their borders,
  // so covering an edge end is correct). Containers + grids were drawn in the background pass above.
  for (const n of layout.nodes) {
    if (n.kind === 'container' || n.kind === 'grid') continue
    const s = n.s
    const left = n.x + OFF
    const top = n.y + OFF
    const w = n.w
    const h = n.h
    const cx = left + w / 2
    const cy = top + h / 2

    if (n.kind === 'sql') {
      parts.push(drawSqlTable(s, n.sqlCols || [0, 0, 0], left, top, w, h))
      continue
    }
    if (n.kind === 'class') {
      parts.push(drawClass(s, left, top, w, h))
      continue
    }

    const rx = s.borderRadius ? Number(s.borderRadius) : 4
    switch (s.shape) {
      case 'circle':
      case 'oval':
        parts.push(
          `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      case 'diamond':
        parts.push(
          `<polygon points="${cx},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${cx},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      case 'hexagon': {
        const i = w * 0.22
        parts.push(
          `<polygon points="${(left + i).toFixed(1)},${top.toFixed(1)} ${(left + w - i).toFixed(1)},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${(left + w - i).toFixed(1)},${(top + h).toFixed(1)} ${(left + i).toFixed(1)},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'cylinder': {
        const ry = Math.min(h * 0.12, 12)
        parts.push(
          `<path d="M${left},${(top + ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 1 ${(left + w).toFixed(1)},${(top + ry).toFixed(1)} L${(left + w).toFixed(1)},${(top + h - ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 1 ${left},${(top + h - ry).toFixed(1)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${left},${(top + ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 0 ${(left + w).toFixed(1)},${(top + ry).toFixed(1)}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        break
      }
      case 'queue': {
        // D2 queue = a horizontal cylinder: rounded right cap + an inner vertical arc.
        const rx = Math.min(w * 0.12, 14)
        parts.push(
          `<path d="M${left.toFixed(1)},${top.toFixed(1)} L${(left + w - rx).toFixed(1)},${top.toFixed(1)} A${rx.toFixed(1)},${(h / 2).toFixed(1)} 0 0 1 ${(left + w - rx).toFixed(1)},${(top + h).toFixed(1)} L${left.toFixed(1)},${(top + h).toFixed(1)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${(left + w - rx).toFixed(1)},${top.toFixed(1)} A${rx.toFixed(1)},${(h / 2).toFixed(1)} 0 0 0 ${(left + w - rx).toFixed(1)},${(top + h).toFixed(1)}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        break
      }
      case 'person': {
        // Head circle + a shoulders dome (half-ellipse) — a simple, recognizable figure.
        const hr = Math.min(w, h) * 0.2
        const hcy = top + hr + h * 0.06
        const bx1 = left + w * 0.16
        const bx2 = left + w * 0.84
        const by = top + h
        parts.push(
          `<circle cx="${cx.toFixed(1)}" cy="${hcy.toFixed(1)}" r="${hr.toFixed(1)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${bx1.toFixed(1)},${by.toFixed(1)} A${((bx2 - bx1) / 2).toFixed(1)},${(by - hcy - hr).toFixed(1)} 0 0 1 ${bx2.toFixed(1)},${by.toFixed(1)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'cloud': {
        // Bumpy top from three arcs + flat bottom — reads as a cloud at diagram scale.
        const x = left
        const y = top
        parts.push(
          `<path d="M${(x + w * 0.26).toFixed(1)},${(y + h * 0.88).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.22).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.34).toFixed(1)} 0 0 1 ${(x + w * 0.5).toFixed(1)},${(y + h * 0.3).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.32).toFixed(1)} 0 0 1 ${(x + w * 0.78).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.74).toFixed(1)},${(y + h * 0.88).toFixed(1)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      default:
        parts.push(
          `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
    }
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(s, FONT_SIZE, sty.leafFill)}>${esc2(s.label)}</text>`,
    )
  }
  parts.push('</svg>')
  return parts.join('\n')
}

// --- grid container: header + children laid in a uniform grid ---
function drawGrid(
  s: D2Shape,
  gi: GridInfo,
  left: number,
  top: number,
  w: number,
  h: number,
  sty: D2Style,
): string {
  const out: string[] = []
  const rx = s.borderRadius || 6
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, sty.contFill, sty.contStroke)} fill-opacity="${s.fill ? '1' : sty.contOpacity}"/>`,
  )
  if (s.label)
    out.push(
      `<text x="${(left + 8).toFixed(1)}" y="${(top + gi.headerH - 6).toFixed(1)}" ${textAttrs(s, FONT_SIZE, sty.contFill)}>${esc2(s.label)}</text>`,
    )
  const ox = left + 8
  const oy = top + gi.headerH + 8
  gi.children.forEach((c, i) => {
    const col = i % gi.cols
    const row = Math.floor(i / gi.cols)
    const cw = gi.cellW - 16
    const ch = gi.cellH - 16
    const cx = ox + col * gi.cellW + 8
    const cy = oy + row * gi.cellH + 8
    out.push(
      `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${c.borderRadius || 4}" ${paintAttrs(c, sty.leafFill, sty.leafStroke)}/>`,
    )
    out.push(
      `<text x="${(cx + cw / 2).toFixed(1)}" y="${(cy + ch / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(c, FONT_SIZE, sty.leafFill)}>${esc2(c.label)}</text>`,
    )
  })
  return out.join('\n')
}

// --- sql_table: header + one row per column (name | type | constraint) ---
function drawSqlTable(
  s: D2Shape,
  cols: number[],
  left: number,
  top: number,
  w: number,
  h: number,
): string {
  const out: string[] = []
  const stroke = s.stroke || 'currentColor'
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${s.fill || 'transparent'}" stroke="${stroke}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${HEADER_H}" rx="4" fill="${stroke}" fill-opacity="0.12"/>`,
  )
  out.push(
    `<text x="${(left + w / 2).toFixed(1)}" y="${(top + HEADER_H / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" font-weight="700" fill="${s.fontColor || 'currentColor'}">${esc2(s.label)}</text>`,
  )
  ;(s.columns || []).forEach((c, i) => {
    const ry = top + HEADER_H + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-opacity="0.3"/>`,
    )
    const ty = ry + ROW_H / 2
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="currentColor">${esc2(c.name)}</text>`,
    )
    if (c.type)
      out.push(
        `<text x="${(left + CELL_PAD * 2 + cols[0]).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="currentColor" opacity="0.7">${esc2(c.type)}</text>`,
      )
    if (c.constraint)
      out.push(
        `<text x="${(left + w - CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="${EDGE_FONT_SIZE}" fill="currentColor" opacity="0.7">${esc2(abbr(c.constraint))}</text>`,
      )
  })
  return out.join('\n')
}

function abbr(c: string): string {
  return c
    .split(',')
    .map((x) =>
      x === 'primary_key'
        ? 'PK'
        : x === 'foreign_key'
          ? 'FK'
          : x === 'unique'
            ? 'UNQ'
            : x,
    )
    .join(' ')
}

// --- class: header + fields section + methods section ---
function drawClass(
  s: D2Shape,
  left: number,
  top: number,
  w: number,
  h: number,
): string {
  const out: string[] = []
  const stroke = s.stroke || 'currentColor'
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${s.fill || 'transparent'}" stroke="${stroke}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${HEADER_H}" rx="4" fill="${stroke}" fill-opacity="0.12"/>`,
  )
  out.push(
    `<text x="${(left + w / 2).toFixed(1)}" y="${(top + HEADER_H / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" font-weight="700" fill="${s.fontColor || 'currentColor'}">${esc2(s.label)}</text>`,
  )
  let i = 0
  const row = (text: string) => {
    const ty = top + HEADER_H + i * ROW_H + ROW_H / 2
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="currentColor">${esc2(text)}</text>`,
    )
    i++
  }
  for (const f of s.fields || [])
    row(`${vis(f.visibility)} ${f.name}${f.type ? `: ${f.type}` : ''}`)
  if ((s.methods?.length || 0) > 0) {
    const sy = top + HEADER_H + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-opacity="0.3"/>`,
    )
  }
  for (const m of s.methods || [])
    row(`${vis(m.visibility)} ${m.name}${m.type ? ` ${m.type}` : ''}`)
  return out.join('\n')
}

// Re-export so the ELK layout (elk-layout.ts) can render through the same path.
export { toSVG }

// Browser Canvas sizer (production). Tests inject their own.
// INVARIANT: this font stack MUST stay identical to the @font-face family in main.css
// and the bundled media/fonts/ files — change one, change all three, or measureText drifts from
// the rendered SVG. Guarded by a unit test.
const D2_FONT_STACK = '"Source Sans 3","Source Sans Pro",system-ui,sans-serif'
let _ctx: CanvasRenderingContext2D | null = null
export function canvasMeasure(
  text: string,
  fontSize = FONT_SIZE,
): { w: number; h: number } {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d')
  const c = _ctx!
  c.font = `${fontSize}px ${D2_FONT_STACK}`
  const lines = String(text).split('\n')
  let w = 0
  for (const ln of lines) w = Math.max(w, c.measureText(ln).width)
  return { w: Math.ceil(w), h: Math.ceil(lines.length * fontSize * 1.25) }
}

// CRITICAL — faithful-by-construction (NON-NEGOTIABLE): returns a reason string if the graph uses a
// bespoke layout/shape we cannot faithfully render => the caller MUST show raw text LOUDLY, never a
// wrong picture. sql_table/class/grid are rendered (bespoke JS), so only sequence_diagram and `near`
// remain unsupported. Never remove or weaken this without a faithfulness audit. Single enforcement
// point: custom-diagrams.ts renderD2.
export function unsupportedReason(graph: D2Graph): string | null {
  if (graph.sequence) return 'sequence_diagram (use ```mermaid)'
  for (const s of graph.shapes) {
    if (s.special.isSequence) return 'sequence_diagram (use ```mermaid)'
    if (s.special.nearKey) return 'near positioning'
  }
  return null
}
