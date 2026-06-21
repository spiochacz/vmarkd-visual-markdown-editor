import dagre from '@dagrejs/dagre'
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
function paintAttrs(s: Partial<D2Shape>, defaultFill: string): string {
  const stroke = s.stroke || 'currentColor'
  const fill = s.fill || defaultFill
  const sw = s.strokeWidth ? Number(s.strokeWidth) : 2
  let a = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`
  if (s.strokeDash && Number(s.strokeDash) > 0)
    a += ` stroke-dasharray="${s.strokeDash},${s.strokeDash}"`
  if (s.opacity && Number(s.opacity) !== 1) a += ` opacity="${s.opacity}"`
  return a
}

// Label paint: explicit fontColor > contrast-vs-fill > currentColor; + bold/italic.
function textAttrs(s: Partial<D2Shape>, fontSize = FONT_SIZE): string {
  const color = s.fontColor || labelColor(s.fill)
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

export function renderD2Graph(graph: D2Graph, measure: Sizer): string {
  return toSVG(layoutDagre(graph, measure))
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

function toSVG(layout: Layout): string {
  const OFF = 10
  const W = layout.W + 20
  const H = layout.H + 20
  const themeColor = 'currentColor'
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='"Source Sans 3","Source Sans Pro",system-ui,sans-serif'>`,
  ]

  for (const e of layout.edges) {
    const pts = e.points.map((p) => [p[0] + OFF, p[1] + OFF])
    // Retract the line ends so the stroke meets the arrowhead base / border, not the node centre
    // (mirrors D2's getArrowheadAdjustments); the arrowhead itself stays at the original endpoint.
    const rp = pts.map((p) => [p[0], p[1]])
    if (rp.length >= 2) {
      const last = rp.length - 1
      rp[last] = towards(rp[last], rp[last - 1], e.dstArrow !== false ? 9 : 1)
      rp[0] = towards(rp[0], rp[1], e.srcArrow === true ? 9 : 1)
    }
    const d =
      layout.edgeStyle === 'orthogonal' ? roundedPolyPath(rp) : splinePath(rp)
    parts.push(
      `<path d="${d}" fill="none" stroke="${themeColor}" stroke-width="2"/>`,
    )
    const n = pts.length
    if (e.dstArrow !== false && n >= 2) {
      const a = Math.atan2(
        pts[n - 1][1] - pts[n - 2][1],
        pts[n - 1][0] - pts[n - 2][0],
      )
      parts.push(arrow(pts[n - 1][0], pts[n - 1][1], a, themeColor))
    }
    if (e.srcArrow === true && n >= 2) {
      const a = Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0])
      parts.push(arrow(pts[0][0], pts[0][1], a, themeColor))
    }
    if (e.label && e.lx != null && e.ly != null) {
      parts.push(
        `<text x="${(e.lx + OFF).toFixed(1)}" y="${(e.ly + OFF).toFixed(1)}" font-size="${EDGE_FONT_SIZE}" text-anchor="middle" dominant-baseline="middle" fill="${themeColor}">${esc2(e.label)}</text>`,
      )
    }
  }

  // containers + grids behind leaves
  const order = (k: NodeKind) => (k === 'container' || k === 'grid' ? 0 : 1)
  const nodes = layout.nodes
    .slice()
    .sort((a, b) => order(a.kind) - order(b.kind))
  for (const n of nodes) {
    const s = n.s
    const left = n.x + OFF
    const top = n.y + OFF
    const w = n.w
    const h = n.h
    const cx = left + w / 2
    const cy = top + h / 2

    if (n.kind === 'grid' && n.grid) {
      parts.push(drawGrid(s, n.grid, left, top, w, h))
      continue
    }
    if (n.kind === 'container') {
      const rx = s.borderRadius || 6
      parts.push(
        `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, 'transparent')} fill-opacity="${s.fill ? '1' : '0.04'}"/>`,
      )
      parts.push(
        `<text x="${(left + 8).toFixed(1)}" y="${(top + 16).toFixed(1)}" ${textAttrs(s)}>${esc2(s.label)}</text>`,
      )
      continue
    }
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
          `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" ${paintAttrs(s, 'transparent')}/>`,
        )
        break
      case 'diamond':
        parts.push(
          `<polygon points="${cx},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${cx},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, 'transparent')}/>`,
        )
        break
      case 'hexagon': {
        const i = w * 0.22
        parts.push(
          `<polygon points="${(left + i).toFixed(1)},${top.toFixed(1)} ${(left + w - i).toFixed(1)},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${(left + w - i).toFixed(1)},${(top + h).toFixed(1)} ${(left + i).toFixed(1)},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, 'transparent')}/>`,
        )
        break
      }
      case 'cylinder': {
        const ry = Math.min(h * 0.12, 12)
        parts.push(
          `<path d="M${left},${(top + ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 1 ${(left + w).toFixed(1)},${(top + ry).toFixed(1)} L${(left + w).toFixed(1)},${(top + h - ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 1 ${left},${(top + h - ry).toFixed(1)} Z" ${paintAttrs(s, 'transparent')}/>`,
        )
        parts.push(
          `<path d="M${left},${(top + ry).toFixed(1)} A${(w / 2).toFixed(1)},${ry.toFixed(1)} 0 0 0 ${(left + w).toFixed(1)},${(top + ry).toFixed(1)}" fill="none" stroke="${s.stroke || themeColor}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        break
      }
      case 'queue': {
        // D2 queue = a horizontal cylinder: rounded right cap + an inner vertical arc.
        const rx = Math.min(w * 0.12, 14)
        parts.push(
          `<path d="M${left.toFixed(1)},${top.toFixed(1)} L${(left + w - rx).toFixed(1)},${top.toFixed(1)} A${rx.toFixed(1)},${(h / 2).toFixed(1)} 0 0 1 ${(left + w - rx).toFixed(1)},${(top + h).toFixed(1)} L${left.toFixed(1)},${(top + h).toFixed(1)} Z" ${paintAttrs(s, 'transparent')}/>`,
        )
        parts.push(
          `<path d="M${(left + w - rx).toFixed(1)},${top.toFixed(1)} A${rx.toFixed(1)},${(h / 2).toFixed(1)} 0 0 0 ${(left + w - rx).toFixed(1)},${(top + h).toFixed(1)}" fill="none" stroke="${s.stroke || themeColor}" stroke-width="${s.strokeWidth || 2}"/>`,
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
          `<circle cx="${cx.toFixed(1)}" cy="${hcy.toFixed(1)}" r="${hr.toFixed(1)}" ${paintAttrs(s, 'transparent')}/>`,
        )
        parts.push(
          `<path d="M${bx1.toFixed(1)},${by.toFixed(1)} A${((bx2 - bx1) / 2).toFixed(1)},${(by - hcy - hr).toFixed(1)} 0 0 1 ${bx2.toFixed(1)},${by.toFixed(1)} Z" ${paintAttrs(s, 'transparent')}/>`,
        )
        break
      }
      case 'cloud': {
        // Bumpy top from three arcs + flat bottom — reads as a cloud at diagram scale.
        const x = left
        const y = top
        parts.push(
          `<path d="M${(x + w * 0.26).toFixed(1)},${(y + h * 0.88).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.22).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.34).toFixed(1)} 0 0 1 ${(x + w * 0.5).toFixed(1)},${(y + h * 0.3).toFixed(1)} A${(w * 0.18).toFixed(1)},${(h * 0.32).toFixed(1)} 0 0 1 ${(x + w * 0.78).toFixed(1)},${(y + h * 0.46).toFixed(1)} A${(w * 0.16).toFixed(1)},${(h * 0.24).toFixed(1)} 0 0 1 ${(x + w * 0.74).toFixed(1)},${(y + h * 0.88).toFixed(1)} Z" ${paintAttrs(s, 'transparent')}/>`,
        )
        break
      }
      default:
        parts.push(
          `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, 'transparent')}/>`,
        )
    }
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(s)}>${esc2(s.label)}</text>`,
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
): string {
  const out: string[] = []
  const rx = s.borderRadius || 6
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, 'transparent')} fill-opacity="${s.fill ? '1' : '0.04'}"/>`,
  )
  if (s.label)
    out.push(
      `<text x="${(left + 8).toFixed(1)}" y="${(top + gi.headerH - 6).toFixed(1)}" ${textAttrs(s)}>${esc2(s.label)}</text>`,
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
      `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="${c.borderRadius || 4}" ${paintAttrs(c, 'transparent')}/>`,
    )
    out.push(
      `<text x="${(cx + cw / 2).toFixed(1)}" y="${(cy + ch / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(c)}>${esc2(c.label)}</text>`,
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
