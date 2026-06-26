import dagre from '@dagrejs/dagre'
import { MERMAID_PALETTES, mix } from '../../src/mermaid-palettes'
// Route-simplification geometry + the Rect obstacle type moved to the shared leaf module (task 123).
import { type Rect, simplifyRoute, straightenEnds } from './d2-geometry'
import type { D2Edge, D2Graph, D2Shape } from './d2-wasm'

const FONT_SIZE = 16
export const EDGE_FONT_SIZE = 14
const INNER_PAD = 5
const P = 40 // d2 defaultPadding
// shape:text / shape:code (task 124 #2). Code uses a monospace face, but the injected Sizer can't
// switch font, so code boxes are sized from the char count at the monospace advance (~0.6em). text and
// code are the only shapes that render \n-separated multi-line labels (as <tspan> rows).
const CODE_FONT = 13
const CODE_CHAR_W = 0.6 // monospace advance per char (em)
const PROSE_LH = 1.35 // multi-line label line-height factor
const TEXT_PAD = 4 // borderless text gutter
const CODE_PAD = 10 // code panel padding
export type Sizer = (
  text: string,
  fontSize?: number,
) => { w: number; h: number } // import to type a custom measure fn

const ceil = Math.ceil
const SQRT2 = Math.SQRT2
const esc = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// task 124 #5 — only make a node clickable for safe link schemes (http/https/mailto, a relative path,
// or an in-doc #/wiki ref). Blocks javascript:/vbscript:/data:/file: (defense in depth; the webview
// link handler + CSP are the other layers). Returns the trimmed href or null.
function safeLinkHref(link?: string): string | null {
  if (!link) return null
  const t = link.trim()
  if (!t || /^(javascript|vbscript|data|file):/i.test(t)) return null
  return t
}
// task 124 #3 — a small decorative icon badge (top-left). Precise icon placement = task 134. CSP gates
// the URL: data:/blob: always, https only when image.allowRemoteImages is on (else it just won't load).
function nodeIconImage(
  icon: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const s = Math.min(24, w * 0.5, h * 0.5)
  return `<image href="${esc(icon)}" x="${(x + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`
}
// task 124 #5 — a transparent hit-rect carrying the <title> tooltip and/or the <a> link, drawn ON TOP
// of a node (post-pass) so hover/click beat the shape's own fill. SVG <a> routes via fixLinkClick.
function nodeHitOverlay(
  s: Partial<D2Shape>,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  const tip = s.tooltip ? `<title>${esc(s.tooltip)}</title>` : ''
  const href = safeLinkHref(s.link)
  if (!tip && !href) return null
  const rect = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="transparent" pointer-events="all"${href ? ' style="cursor:pointer"' : ''}>${tip}</rect>`
  return href ? `<a href="${esc(href)}">${rect}</a>` : rect
}

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
    // The cases below match d2 v0.7.1 lib/shape GetDimensionsToFit so labels fit the bespoke
    // geometry the toSVG switch now draws for these shapes (previously they fell through to a
    // plain rectangle box). ARC=24 (defaultArcDepth), wedge constants per shape.
    case 'queue':
      // shape_queue: 1 arc left + 2 arcs right (3*24), padX=20
      return { w: ceil(w + 3 * 24 + 20), h: ceil(h + P) }
    case 'stored_data':
      // shape_stored_data: 2 side wedges (15) + padX=30
      return { w: ceil(w + 2 * 15 + 30), h: ceil(h + P) }
    case 'step':
      // shape_step: 2 wedges (35) + padX=10, padY += wedge
      return { w: ceil(w + 2 * 35 + 10), h: ceil(h + P + 35) }
    case 'callout':
      // shape_callout: a downward tail adds tipHeight (45) below the body
      return { w: ceil(w + P), h: ceil(h + 45 + 20) }
    case 'package':
      // shape_package: a top tab band above the label (≈ measured +52 over the content box)
      return { w: ceil(w + P), h: ceil(h + 52) }
    case 'cloud':
      // shape_cloud: the puffy body needs generous room around the centred label
      return { w: ceil(w * 1.4 + 30), h: ceil(h * 1.6 + 30) }
    case 'person': {
      // shape_person: a square figure with the label rendered BELOW it — reserve a label band
      // under a square figure sized from the label height.
      const band = FONT_SIZE + 8
      const fig = ceil(h + 28)
      return { w: ceil(Math.max(fig, w)), h: fig + band }
    }
    default:
      return { w: ceil(w + P), h: ceil(h + P) } // rectangle/"": (40,40)
  }
}

export function shapeBox(shape: string, m: { w: number; h: number }) {
  return dimsToFit(shape, m.w + INNER_PAD, m.h + INNER_PAD)
}

// Box for a multi-line shape:text / shape:code label (task 124 #2). text → proportional Sizer per
// line; code → monospace estimate (the Sizer has no mono font). Returns the FINAL padded box and
// bypasses dimsToFit, whose 40px rectangle padding is wrong for borderless prose / a tight code panel.
export function textShapeBox(
  shape: string,
  label: string,
  measure: Sizer,
): { w: number; h: number } {
  const lines = String(label).split('\n')
  const isCode = shape === 'code'
  const fs = isCode ? CODE_FONT : FONT_SIZE
  const pad = isCode ? CODE_PAD : TEXT_PAD
  let cw = 0
  if (isCode) {
    const cols = lines.reduce((m, l) => Math.max(m, l.length), 1)
    cw = cols * CODE_CHAR_W * CODE_FONT
  } else {
    for (const l of lines) cw = Math.max(cw, measure(l).w)
  }
  return {
    w: ceil(cw + 2 * pad),
    h: ceil(lines.length * fs * PROSE_LH + 2 * pad),
  }
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
export interface D2Style {
  leafFill: string // d2 B6 — leaf shape fill (near-white in light themes)
  leafStroke: string // d2 B1 — every shape + connection stroke
  contFill: string // d2 B4 — level-0 container fill (see `fills` for the nesting cascade)
  contStroke: string // d2 B1
  contOpacity: string
  edge: string // d2 B1 — connection lines + arrowheads
  bg?: string // d2 N7 — page background rect (undefined = transparent canvas, follows the editor)
  mono: boolean
  // Full d2 token map for FAITHFUL sql_table / class / label colouring (verified against the binary).
  // In mono these all collapse to currentColor/transparent so the legacy monochrome look is preserved.
  text: string // d2 N1 — node + container labels
  textMuted: string // d2 N2 — edge labels (italic) + sql column type
  paper: string // d2 N7 — sql_table/class body fill + their header text
  accent: string // d2 B2 — sql column name / class +- visibility
  accent2: string // d2 AA2 — sql constraint / class field type
  fills: string[] // d2 [B4,B5,B6,N7] — container fill by nesting depth (index = level, clamped)
}
export function paletteStyle(p?: D2Palette): D2Style {
  if (!p)
    return {
      leafFill: 'transparent',
      leafStroke: 'currentColor',
      contFill: 'transparent',
      contStroke: 'currentColor',
      contOpacity: '0.04',
      edge: 'currentColor',
      mono: true,
      text: 'currentColor',
      textMuted: 'currentColor',
      paper: 'transparent',
      accent: 'currentColor',
      accent2: 'currentColor',
      fills: ['transparent', 'transparent', 'transparent', 'transparent'],
    }
  const accent = p.accent || p.line || p.fg
  return {
    leafFill: mix(p.bg, accent, 0.1), // subtle accent-tinted surface
    leafStroke: accent, // coloured border, D2-like
    contFill: mix(p.bg, p.fg, 0.05), // muted container surface
    contStroke: mix(p.fg, accent, 0.4),
    contOpacity: '1',
    edge: p.line || accent,
    bg: p.bg, // paint the editor background so the paired theme blends into that environment
    mono: false,
    text: p.fg,
    textMuted: mix(p.bg, p.fg, 0.6),
    paper: p.bg,
    accent,
    accent2: accent,
    fills: [
      mix(p.bg, p.fg, 0.1),
      mix(p.bg, p.fg, 0.06),
      mix(p.bg, p.fg, 0.03),
      p.bg,
    ],
  }
}

// Named colour themes for D2 diagrams, selected via `vmarkd.diagram.d2Theme`. The `d2-*` themes are
// FAITHFUL ports of d2 v0.7.1's own token mapping (every token + element→token assignment verified
// against the real `d2` binary): leaf fill=B6, every stroke + connection=B1, container fill cascades
// B4→B5→B6→N7 by nesting depth, labels=N1, edge labels=N2 (italic), page=N7; sql_table/class use the
// NEUTRAL tokens (white N7 body, dark N1 border + solid N1 header with N7 text, column name=B2,
// type=N2, constraint=AA2). 'mono' keeps the original currentColor behaviour (no page background).
const d2Catalog = (t: {
  N1: string
  N2: string
  N7: string
  B1: string
  B2: string
  B4: string
  B5: string
  B6: string
  AA2: string
}): D2Style => ({
  leafFill: t.B6,
  leafStroke: t.B1,
  contFill: t.B4,
  contStroke: t.B1,
  contOpacity: '1',
  edge: t.B1,
  bg: t.N7,
  mono: false,
  text: t.N1,
  textMuted: t.N2,
  paper: t.N7,
  accent: t.B2,
  accent2: t.AA2,
  fills: [t.B4, t.B5, t.B6, t.N7],
})

// Editor-paired themes (vscode/github light+dark) — mirror the mermaid palette look: SUBTLE accent-
// tinted fills (not d2's saturated tokens), accent borders + edges, page bg = the editor's own
// background, so the diagram blends into that environment like mermaid does. Reuses MERMAID_PALETTES.
const pairedTheme = (id: string): D2Style => paletteStyle(MERMAID_PALETTES[id])

const D2_THEMES: Record<string, D2Style> = {
  // d2 catalog — full token sets pulled verbatim from `d2 --theme=<id>` (v0.7.1).
  'd2-original': d2Catalog({
    N1: '#0A0F25',
    N2: '#676C7E',
    N7: '#FFFFFF',
    B1: '#0D32B2',
    B2: '#0D32B2',
    B4: '#E3E9FD',
    B5: '#EDF0FD',
    B6: '#F7F8FE',
    AA2: '#4A6FF3',
  }), // Neutral default (0)
  'd2-neutral-grey': d2Catalog({
    N1: '#0A0F25',
    N2: '#676C7E',
    N7: '#FFFFFF',
    B1: '#0A0F25',
    B2: '#676C7E',
    B4: '#CFD2DD',
    B5: '#DEE1EB',
    B6: '#EEF1F8',
    AA2: '#676C7E',
  }), // Neutral Grey (1)
  'd2-cool-classics': d2Catalog({
    N1: '#0A0F25',
    N2: '#676C7E',
    N7: '#FFFFFF',
    B1: '#000536',
    B2: '#0F66B7',
    B4: '#87BFF3',
    B5: '#BCDDFB',
    B6: '#E5F3FF',
    AA2: '#076F6F',
  }), // Cool classics (4)
  'd2-dark-mauve': d2Catalog({
    N1: '#CDD6F4',
    N2: '#BAC2DE',
    N7: '#1E1E2E',
    B1: '#CBA6F7',
    B2: '#CBA6F7',
    B4: '#585B70',
    B5: '#45475A',
    B6: '#313244',
    AA2: '#F38BA8',
  }), // Dark Mauve (200)
  'd2-terminal': d2Catalog({
    N1: '#000410',
    N2: '#0000B8',
    N7: '#FFFFFF',
    B1: '#000410',
    B2: '#0000E4',
    B4: '#E7E9EE',
    B5: '#F5F6F9',
    B6: '#FFFFFF',
    AA2: '#008566',
  }), // Terminal (300)
  // editor-paired (mermaid-style tints)
  'vscode-light': pairedTheme('vscode-light-2026'),
  'vscode-dark': pairedTheme('vscode-dark-2026'),
  'github-light': pairedTheme('github-light'),
  'github-dark': pairedTheme('github-dark'),
}

// Resolve a theme NAME to its style. Unknown / 'mono' / undefined → the monochrome currentColor style
// (today's default), so existing diagrams are unchanged unless a colour theme is explicitly selected.
export function d2Theme(name?: string): D2Style {
  return (name && D2_THEMES[name]) || paletteStyle()
}

// Label paint: explicit fontColor > contrast-vs-fill > currentColor; + bold/italic. `effFill` is the
// palette default fill the shape actually got (task 119) — contrast the label against THAT (not the
// undefined source fill) so text stays legible on a coloured tint on light AND dark themes.
function textAttrs(
  s: Partial<D2Shape>,
  fontSize = FONT_SIZE,
  effFill?: string,
  themeText?: string,
): string {
  // d2 paints labels with its N1 token regardless of fill (passed as themeText). An explicit source
  // fontColor still wins; an explicit source fill falls back to contrast-vs-fill; else themeText (N1),
  // else currentColor (mono).
  const color =
    s.fontColor ||
    (s.fill ? labelColor(s.fill) : themeText) ||
    labelColor(effFill)
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
  // Viewport-pinned `near: <constant>` shape (task 126A): excluded from the layout engine, obstacles
  // and the tight bbox; positioned in toSVG relative to the final drawing bounds. Holds the constant.
  near?: string
}
// Explicit connection style (task 124 #1). Absent fields → the renderer keeps the theme default
// (sty.edge stroke / width 2). `animated` flows the dashes via a reduced-motion-safe CSS class.
export interface EdgeStyle {
  stroke?: string
  strokeWidth?: string
  strokeDash?: string
  opacity?: string
  animated?: boolean
}
// Pack a graph edge's explicit style for the renderer; undefined when it set none (keep the default).
export function edgeStyle(e: D2Edge): EdgeStyle | undefined {
  if (!e.stroke && !e.strokeWidth && !e.strokeDash && !e.opacity && !e.animated)
    return undefined
  return {
    stroke: e.stroke,
    strokeWidth: e.strokeWidth,
    strokeDash: e.strokeDash,
    opacity: e.opacity,
    animated: e.animated,
  }
}
export interface PlacedEdge {
  points: [number, number][]
  srcArrow: boolean
  dstArrow: boolean
  style?: EdgeStyle // explicit connection style (task 124 #1)
  // Per-end arrowhead shape + label (task 128); undefined → fall back to srcArrow/dstArrow (triangle/none).
  srcArrowhead?: { shape: string; label?: string }
  dstArrowhead?: { shape: string; label?: string }
  label?: string
  lx?: number
  ly?: number
  lw?: number // label box width (for the on-line mask, task 122)
  lh?: number
  src?: string // endpoint node ids — lets toSVG spot parallel/antiparallel pairs (task 122)
  dst?: string
  // sql_table column-row endpoints (task 133); when set, toSVG attaches the edge end to that
  // column's row of the table node instead of the node-box centre.
  srcColumnIndex?: number
  dstColumnIndex?: number
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

// The 8 viewport-constant `near:` keys (task 126A). A shape pinned to one of these is pulled OUT of
// the layout flow and placed relative to the final drawing bounds. Any OTHER nearKey is a shape id
// (the relative "near another shape" form) — still unsupported (Phase B), so it stays a fallback.
const NEAR_CONSTANTS = new Set([
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
])
export function isNearConstant(key?: string): boolean {
  return !!key && NEAR_CONSTANTS.has(key)
}

// Build the PlacedNodes for viewport-pinned `near:` shapes (task 126A): sized like normal leaves but
// flagged `near` (= the constant) with x/y left at 0 — toSVG positions them once the drawing bounds
// are known. Shared by both layout engines so the two paths stay in sync.
export function buildNearNodes(
  graph: D2Graph,
  measure: Sizer,
  gridInfo: Map<string, GridInfo>,
): PlacedNode[] {
  const out: PlacedNode[] = []
  for (const s of graph.shapes) {
    if (!isNearConstant(s.special.nearKey)) continue
    const li = leafInfo(s, measure, gridInfo)
    out.push({
      s,
      x: 0,
      y: 0,
      w: li.w,
      h: li.h,
      kind: li.kind,
      sqlCols: li.sqlCols,
      grid: li.grid,
      near: s.special.nearKey,
    })
  }
  return out
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
  // text/code carry multi-line prose; size them from line count, not the single-line label box.
  if (s.shape === 'text' || s.shape === 'code') {
    return { ...textShapeBox(s.shape, s.label, measure), kind: 'shape' }
  }
  // image has no text to size from (label is usually just the id) — floor to a default picture box.
  if (s.shape === 'image') {
    const b = shapeBox(s.shape, measure(s.label))
    return { w: Math.max(b.w, 96), h: Math.max(b.h, 72), kind: 'shape' }
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
    // Root direction (task 127): d2 down/up/right/left → dagre TB/BT/LR/RL.
    rankdir:
      (
        { down: 'TB', up: 'BT', right: 'LR', left: 'RL' } as Record<
          string,
          string
        >
      )[graph.direction || 'down'] ?? 'TB',
    nodesep: 60,
    ranksep: 100,
    edgesep: 20,
    marginx: 10,
    marginy: 10,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const s of graph.shapes) {
    if (inGrid(s)) continue
    if (isNearConstant(s.special.nearKey)) continue // pinned out of layout (task 126A)
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
        style: edgeStyle(e), // task 124 #1
        srcArrowhead: e.srcArrowhead, // task 128
        dstArrowhead: e.dstArrowhead,
        srcColumnIndex: e.srcColumnIndex, // task 133
        dstColumnIndex: e.dstColumnIndex,
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
  // Viewport-pinned near shapes — positioned by toSVG, not the engine (task 126A).
  nodes.push(...buildNearNodes(graph, measure, gridInfo))
  const edges: PlacedEdge[] = []
  for (const eo of g.edges()) {
    const e = g.edge(eo)
    edges.push({
      points: e.points.map((p: any) => [p.x, p.y]),
      srcArrow: e.srcArrow,
      dstArrow: e.dstArrow,
      style: e.style, // task 124 #1
      srcArrowhead: e.srcArrowhead, // task 128
      dstArrowhead: e.dstArrowhead,
      srcColumnIndex: e.srcColumnIndex, // task 133
      dstColumnIndex: e.dstColumnIndex,
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
  style?: D2Style,
): string {
  return toSVG(layoutDagre(graph, measure), style)
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

// How far to retract the connection stroke from its endpoint so it meets the arrowhead base cleanly
// instead of poking through the glyph (task 128). Per shape, because a diamond is longer than a
// triangle and a crow's-foot "many" stops at its apex while "one" lets the line run to the entity.
function arrowheadDepth(shape: string): number {
  switch (shape) {
    case 'none':
    case 'line':
      return 1
    case 'diamond':
    case 'filled-diamond':
      return 16
    case 'circle':
    case 'filled-circle':
    case 'box':
    case 'filled-box':
      return 12
    case 'cross':
    case 'cf-one':
    case 'cf-one-required':
      return 2 // the bar(s) cross the line at the entity; stroke runs to the border
    case 'cf-many':
    case 'cf-many-required':
      return 14 // line stops at the foot's apex
    default:
      return 9 // triangle / unfilled-triangle / arrow
  }
}

// arrowhead: draw the d2 arrowhead `shape` at endpoint (x,y), with the connection arriving along
// `angle` (radians, pointing TOWARD the endpoint). Returns SVG (task 128). Unfilled variants use
// fill="none" — safe because the stroke is retracted (arrowheadDepth) so no line shows through. The
// crow's-foot glyphs (cf-*) draw ER cardinality notation as short strokes at the entity border.
function arrowhead(
  shape: string,
  x: number,
  y: number,
  angle: number,
  color: string,
): string {
  const bx = -Math.cos(angle) // back along the line, away from the node
  const by = -Math.sin(angle)
  const px = -Math.sin(angle) // perpendicular (≈ the entity border tangent)
  const py = Math.cos(angle)
  // point at (back*b + perp*p) from the endpoint, formatted "x,y"
  const at = (b: number, p: number) =>
    `${(x + bx * b + px * p).toFixed(1)},${(y + by * b + py * p).toFixed(1)}`
  switch (shape) {
    case 'none':
    case 'line':
      return ''
    case 'arrow': {
      // open barbed V (two strokes, no fill)
      const len = 11
      const a1 = angle + Math.PI - 0.4
      const a2 = angle + Math.PI + 0.4
      return `<path d="M${(x + len * Math.cos(a1)).toFixed(1)},${(y + len * Math.sin(a1)).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(x + len * Math.cos(a2)).toFixed(1)},${(y + len * Math.sin(a2)).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2"/>`
    }
    case 'unfilled-triangle':
    case 'triangle': {
      const len = 10
      const a1 = angle + Math.PI - 0.4
      const a2 = angle + Math.PI + 0.4
      const pts = `${x.toFixed(1)},${y.toFixed(1)} ${(x + len * Math.cos(a1)).toFixed(1)},${(y + len * Math.sin(a1)).toFixed(1)} ${(x + len * Math.cos(a2)).toFixed(1)},${(y + len * Math.sin(a2)).toFixed(1)}`
      return shape === 'triangle'
        ? `<polygon points="${pts}" fill="${color}"/>`
        : `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>`
    }
    case 'diamond':
    case 'filled-diamond': {
      const L = 16
      const W = 6
      const pts = `${at(0, 0)} ${at(L / 2, W)} ${at(L, 0)} ${at(L / 2, -W)}`
      const fill = shape === 'filled-diamond' ? color : 'none'
      return `<polygon points="${pts}" fill="${fill}" stroke="${color}" stroke-width="1.5"/>`
    }
    case 'circle':
    case 'filled-circle': {
      const r = 5.5
      const cx = x + bx * r
      const cy = y + by * r
      const fill = shape === 'filled-circle' ? color : 'none'
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${color}" stroke-width="1.5"/>`
    }
    case 'box':
    case 'filled-box': {
      const S = 11
      const h = S / 2
      const pts = `${at(0, h)} ${at(0, -h)} ${at(S, -h)} ${at(S, h)}`
      const fill = shape === 'filled-box' ? color : 'none'
      return `<polygon points="${pts}" fill="${fill}" stroke="${color}" stroke-width="1.5"/>`
    }
    case 'cross': {
      // an X straddling the line near the entity (two diagonal ticks)
      const D = 8
      const W = 5
      return (
        `<line x1="${(x + bx * (D - W) + px * W).toFixed(1)}" y1="${(y + by * (D - W) + py * W).toFixed(1)}" x2="${(x + bx * (D + W) - px * W).toFixed(1)}" y2="${(y + by * (D + W) - py * W).toFixed(1)}" stroke="${color}" stroke-width="2"/>` +
        `<line x1="${(x + bx * (D - W) - px * W).toFixed(1)}" y1="${(y + by * (D - W) - py * W).toFixed(1)}" x2="${(x + bx * (D + W) + px * W).toFixed(1)}" y2="${(y + by * (D + W) + py * W).toFixed(1)}" stroke="${color}" stroke-width="2"/>`
      )
    }
    case 'cf-one':
      // a single perpendicular tick across the line near the entity (ER "one")
      return `<line x1="${(x + bx * 11 + px * 7).toFixed(1)}" y1="${(y + by * 11 + py * 7).toFixed(1)}" x2="${(x + bx * 11 - px * 7).toFixed(1)}" y2="${(y + by * 11 - py * 7).toFixed(1)}" stroke="${color}" stroke-width="2"/>`
    case 'cf-one-required':
      // two parallel ticks (ER "exactly one")
      return [9, 15]
        .map(
          (d) =>
            `<line x1="${(x + bx * d + px * 7).toFixed(1)}" y1="${(y + by * d + py * 7).toFixed(1)}" x2="${(x + bx * d - px * 7).toFixed(1)}" y2="${(y + by * d - py * 7).toFixed(1)}" stroke="${color}" stroke-width="2"/>`,
        )
        .join('')
    case 'cf-many':
    case 'cf-many-required': {
      // crow's foot: three prongs fanning from an apex (back along the line) to the entity border
      const foot = 14
      const w = 7
      const apexX = x + bx * foot
      const apexY = y + by * foot
      const prong = (dp: number) =>
        `<line x1="${apexX.toFixed(1)}" y1="${apexY.toFixed(1)}" x2="${(x + px * dp).toFixed(1)}" y2="${(y + py * dp).toFixed(1)}" stroke="${color}" stroke-width="2"/>`
      let g = prong(0) + prong(w) + prong(-w)
      if (shape === 'cf-many-required')
        // a bar behind the foot (ER "one or many")
        g += `<line x1="${(apexX + bx * 5 + px * 7).toFixed(1)}" y1="${(apexY + by * 5 + py * 7).toFixed(1)}" x2="${(apexX + bx * 5 - px * 7).toFixed(1)}" y2="${(apexY + by * 5 - py * 7).toFixed(1)}" stroke="${color}" stroke-width="2"/>`
      return g
    }
    default: {
      // unknown → default filled triangle
      const len = 10
      const a1 = angle + Math.PI - 0.4
      const a2 = angle + Math.PI + 0.4
      return `<polygon points="${x.toFixed(1)},${y.toFixed(1)} ${(x + len * Math.cos(a1)).toFixed(1)},${(y + len * Math.sin(a1)).toFixed(1)} ${(x + len * Math.cos(a2)).toFixed(1)},${(y + len * Math.sin(a2)).toFixed(1)}" fill="${color}"/>`
    }
  }
}

// Resolve the effective arrowhead shape for one end of an edge (task 128): an explicit shape from the
// source wins; otherwise fall back to the legacy boolean (present → triangle, absent → none).
function endShape(
  head: { shape: string } | undefined,
  hasArrow: boolean,
): string {
  if (head?.shape) return head.shape
  return hasArrow ? 'triangle' : 'none'
}

// arrowheadLabel: ER cardinality / role text (e.g. "1", "*", a role name) beside an arrowhead (task
// 128). Placed just back from the endpoint `p` and offset PERPENDICULAR to the incoming segment
// (p→neighbour `q`) so it sits beside the line rather than on it. Muted, like edge labels.
function arrowheadLabel(
  text: string,
  p: number[],
  q: number[],
  sty: D2Style,
): string {
  const dx = p[0] - q[0]
  const dy = p[1] - q[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // back 16px from the endpoint along the line, then 11px to the side (perpendicular = (-uy,ux))
  const bx = p[0] - ux * 16 - uy * 11
  const by = p[1] - uy * 16 + ux * 11
  return `<text x="${bx.toFixed(1)}" y="${by.toFixed(1)}" font-size="${EDGE_FONT_SIZE}" text-anchor="middle" dominant-baseline="middle" fill="${sty.textMuted}">${esc2(text)}</text>`
}

// (route simplification — simplifyRoute / straightenEnds + helpers — moved to d2-geometry.ts, task 123)
// Point at half the arc-length of a polyline — where an on-line label sits (D2 INSIDE_MIDDLE_CENTER).
// Candidate label positions on STRAIGHT segments of the route, never across a bend (task 122). Centring a
// label at the arc-length midpoint (the old behaviour) lands it ON a corner whenever a bend sits near
// mid-route (common for L/staircase routes) — the centred, line-masking box then covers the bend. Instead,
// for each straight run long enough to hold the box clear of BOTH corners (label width matters on a
// horizontal run, height on a vertical run), sample positions along its clear band. Results are ordered by
// closeness to the desired arc fraction, so candidates[0] is the most central choice; toSVG walks the list
// to DECONFLICT overlapping labels (try the next position when one collides). Falls back to the longest
// segment's centre if no run is long enough. `frac` lets parallel siblings stagger (1/3, 2/3, …).
type LSeg = {
  a: number[]
  b: number[]
  len: number
  horiz: boolean
  start: number
}
export function labelCandidates(
  pts: number[][],
  lw: number,
  lh: number,
  frac = 0.5,
): number[][] {
  const n = pts.length
  if (n < 2) return [pts[0] ?? [0, 0]]
  const segs: LSeg[] = []
  let tot = 0
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const horiz = Math.abs(a[1] - b[1]) <= Math.abs(a[0] - b[0])
    segs.push({ a, b, len, horiz, start: tot })
    tot += len
  }
  const targetD = tot * frac
  const MARGIN = 8
  const STEP = 12
  const at = (s: LSeg, along: number): number[] => {
    const t = s.len ? along / s.len : 0.5
    return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]
  }
  const need = (s: LSeg) => (s.horiz ? lw : lh) / 2 + MARGIN // half-extent to clear a corner along the axis
  const fit = segs.filter((s) => s.len >= 2 * need(s))
  if (!fit.length) {
    // nothing fits → longest segment, centred (minimises corner overlap)
    let s = segs[0]
    for (const c of segs) if (c.len > s.len) s = c
    return [at(s, s.len / 2)]
  }
  // PRIMARY (candidates[0]): the fitting segment whose CENTRE is nearest the target fraction, with the box
  // clamped into that segment's clear band. This is the single most-central, bend-clear spot — used as-is
  // when the label has no conflict, so non-overlapping labels are never disturbed by deconfliction.
  const clamp = (s: LSeg) =>
    Math.max(need(s), Math.min(s.len - need(s), targetD - s.start))
  let pseg = fit[0]
  let bestc = Math.abs(fit[0].start + fit[0].len / 2 - targetD)
  for (const s of fit) {
    const sc = Math.abs(s.start + s.len / 2 - targetD)
    if (sc < bestc) {
      bestc = sc
      pseg = s
    }
  }
  const primary = at(pseg, clamp(pseg))
  // ALTERNATIVES: sample every fitting segment's clear band (+ band ends + each segment's clamped target),
  // ordered by closeness to the target — walked by toSVG's deconfliction only when the primary collides.
  const alt: { pos: number[]; score: number }[] = []
  for (const s of fit) {
    const lo = need(s)
    const hi = s.len - need(s)
    for (let along = lo; along <= hi + 0.01; along += STEP)
      alt.push({
        pos: at(s, along),
        score: Math.abs(s.start + along - targetD),
      })
    alt.push({ pos: at(s, hi), score: Math.abs(s.start + hi - targetD) })
    alt.push({
      pos: at(s, clamp(s)),
      score: Math.abs(s.start + clamp(s) - targetD),
    })
  }
  alt.sort((a, b) => a.score - b.score)
  return [primary, ...alt.map((o) => o.pos)]
}
// single best position (candidates[0]); used by placeLabels for guarded parallel pairs
export function labelAnchor(
  pts: number[][],
  lw: number,
  lh: number,
  frac = 0.5,
): number[] {
  return labelCandidates(pts, lw, lh, frac)[0]
}

// Small deterministic string hash (djb2) → a stable, collision-unlikely id suffix so multiple D2
// SVGs on one page don't share a <mask> id. No Math.random — keep toSVG pure/deterministic.
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function toSVG(layout: Layout, style?: D2Style): string {
  const OFF = 10
  const W = layout.W + 20
  const H = layout.H + 20
  const sty = style ?? paletteStyle() // mono (currentColor) unless a colour theme is supplied
  const themeColor = sty.edge // connection lines + arrowheads + edge labels
  // Container/grid fill cascades by nesting depth (d2: B4→B5→B6→N7 by level). Compute each shape's
  // level from its container chain; mono keeps the flat transparent fill.
  const byId = new Map(layout.nodes.map((n) => [n.s.id, n.s]))
  const levelOf = (s: D2Shape): number => {
    let lvl = 0
    let c = s.container
    while (c) {
      lvl++
      c = byId.get(c)?.container
    }
    return lvl
  }
  const contFillAt = (s: D2Shape): string =>
    sty.mono
      ? sty.contFill
      : sty.fills[Math.min(levelOf(s), sty.fills.length - 1)]
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='"Source Sans 3","Source Sans Pro",system-ui,sans-serif'>`,
  ]

  // Simplify each route (collinear cleanup + interior staircase → L, obstacle-guarded — mirrors D2's
  // deleteBends). Leaf nodes are obstacles; containers/grids are NOT (edges legitimately enter them).
  const obstacles: Rect[] = layout.nodes
    .filter((n) => n.kind !== 'container' && n.kind !== 'grid' && !n.near)
    .map((n) => ({ x: n.x + OFF, y: n.y + OFF, w: n.w, h: n.h }))

  // Placed-node boxes (OFF-adjusted) keyed by id — used to attach sql_table FK edges to a column row
  // (task 133) instead of the table-box centre.
  const nodeBoxById = new Map(
    layout.nodes.map((n) => [
      n.s.id,
      { x: n.x + OFF, y: n.y + OFF, w: n.w, h: n.h, kind: n.kind },
    ]),
  )
  // A clean orthogonal connector between two sql_table column ROWS (task 133). d2 emits FK edges with
  // table-node endpoints + a column index each; we route row→row here, exiting/entering each table on
  // the side facing the other so the line never crosses its own tables. Returns null when neither end
  // is a column endpoint (the edge keeps its normal routed path).
  const columnFKRoute = (e: PlacedEdge): number[][] | null => {
    if (e.srcColumnIndex == null && e.dstColumnIndex == null) return null
    const sb = e.src ? nodeBoxById.get(e.src) : undefined
    const db = e.dst ? nodeBoxById.get(e.dst) : undefined
    if (!sb || !db || sb.kind !== 'sql' || db.kind !== 'sql') return null
    const rowY = (b: { y: number }, i: number | undefined, fallback: number) =>
      i == null ? fallback : b.y + HEADER_H + i * ROW_H + ROW_H / 2
    const sy = rowY(sb, e.srcColumnIndex, sb.y + sb.h / 2)
    const dy = rowY(db, e.dstColumnIndex, db.y + db.h / 2)
    const STUB = 20
    // Side selection: when the tables' x-ranges OVERLAP (vertically stacked) exit BOTH on the same
    // side with the riser clear to that side — a tidy C. Otherwise (side by side) each exits the side
    // FACING the other, riser midway between — a Z. (A naïve "face each other" criss-crosses stacked
    // tables through their own centres.)
    const overlapX = sb.x < db.x + db.w && db.x < sb.x + sb.w
    let sx: number
    let dx: number
    let riserX: number
    if (overlapX) {
      const right = sb.x + sb.w >= db.x + db.w // exit on the side with the table that reaches furthest
      sx = right ? sb.x + sb.w : sb.x
      dx = right ? db.x + db.w : db.x
      riserX = right
        ? Math.max(sb.x + sb.w, db.x + db.w) + STUB
        : Math.min(sb.x, db.x) - STUB
    } else if (db.x >= sb.x + sb.w) {
      sx = sb.x + sb.w // dst is to the right → src exits right, dst enters left
      dx = db.x
      riserX = (sx + dx) / 2
    } else {
      sx = sb.x // dst is to the left → src exits left, dst enters right
      dx = db.x + db.w
      riserX = (sx + dx) / 2
    }
    // [row, riser at riserX, row] — a clean orthogonal C (stacked) or Z (side by side).
    return [
      [sx, sy],
      [riserX, sy],
      [riserX, dy],
      [dx, dy],
    ]
  }
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
    // sql_table FK edges get a purpose-built row→row connector (task 133) instead of the engine's
    // table→table route; everything else uses the simplified, obstacle-guarded route.
    const fk = columnFKRoute(e)
    const route =
      fk ??
      straightenEnds(
        simplifyRoute(
          e.points.map((p) => [p[0] + OFF, p[1] + OFF]),
          obstacles,
          anchor,
          otherSegs,
        ),
        obstacles,
      )
    // `anchor` (placeLabels' lx/ly) is used ABOVE only to guard simplifyRoute (preserve the channel under a
    // parallel pair's label). The final label POSITION for every labelled edge — parallel or lone — is
    // chosen by the deconfliction pass below on the simplified route, so it is bend-clear AND non-overlapping.
    // (Positioning here per-edge meant two labels could collide, e.g. oauth redirect / request+token, which
    // pairKey even groups as an antiparallel pair.) ELK edges carry lw/lh → masked.
    const masked = !!(e.label && e.lw && e.lh)
    const lpos: number[] | null = null
    return { e, route, lpos, masked }
  })

  // Lone-edge label placement + DECONFLICTION (task 122). labelCandidates gives positions on the straight
  // segments of each route (clear of that route's OWN bends), ordered most-central first. Each lone label is
  // then scored against everything already placed and committed at its lowest-cost candidate, where cost is
  // lexicographic: (1) don't overlap another label box, (2) don't cover ANOTHER edge's bend, (3) stay near
  // the route midpoint. So two wide labels on nearby parallel segments (oauth redirect / request+token) no
  // longer stack, AND a label sliding to avoid a neighbour won't land on someone else's corner. Parallel-pair
  // boxes are seeded as obstacles; widest labels go first (fewest free spots).
  const GAP = 10 // min breathing room kept between two label boxes (4 looked "za gęsto" on oauth's hub)
  const boxOf = (pos: number[], lw: number, lh: number) => ({
    x: pos[0] - lw / 2 - 3,
    y: pos[1] - lh / 2 - 1,
    w: lw + 6,
    h: lh + 2,
  })
  type LBox = { x: number; y: number; w: number; h: number }
  const boxesOverlap = (a: LBox, b: LBox) =>
    a.x < b.x + b.w + GAP &&
    a.x + a.w + GAP > b.x &&
    a.y < b.y + b.h + GAP &&
    a.y + a.h + GAP > b.y
  // every route's INTERIOR vertices (= its bends) with the owning edge, so a label can avoid covering a bend
  const cornerList: { p: number[]; owner: unknown }[] = []
  for (const d of drawn) {
    const r = d.route
    for (let i = 1; i + 1 < r.length; i++)
      cornerList.push({ p: r[i], owner: d })
  }
  const inBox = (p: number[], b: LBox) =>
    p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h
  // every route's axis-aligned SEGMENTS with the owning edge — so a label can avoid sitting ACROSS another
  // edge's line. The mask cuts the line under a label, but a label parked on a busy junction still reads as
  // "covering" 2-3 lines (oauth hub); penalising line-crossings nudges it to a clearer stretch.
  const segList: { a: number[]; b: number[]; owner: unknown }[] = []
  for (const d of drawn) {
    const r = d.route
    for (let i = 0; i + 1 < r.length; i++)
      segList.push({ a: r[i], b: r[i + 1], owner: d })
  }
  const segHitsBoxLbl = (a: number[], b: number[], box: LBox) => {
    if (Math.abs(a[0] - b[0]) < 0.5) {
      // vertical
      const x = a[0]
      if (x <= box.x || x >= box.x + box.w) return false
      return (
        Math.max(a[1], b[1]) > box.y && Math.min(a[1], b[1]) < box.y + box.h
      )
    }
    const y = a[1]
    if (y <= box.y || y >= box.y + box.h) return false
    return Math.max(a[0], b[0]) > box.x && Math.min(a[0], b[0]) < box.x + box.w
  }
  // STATIC obstacles a label must also avoid (besides other labels + bends): container TITLE text, container
  // WALL strokes (the mask only cuts edge lines, not the container rect — a label across a wall reads as
  // struck-through, e.g. dataplatform "snapshot" over the Stream Processing right wall), and leaf node boxes
  // (a label belongs on the route between nodes, not on a node's own label, e.g. "consume" over the
  // "Stream Processing" title). Penalised in the cost so labels slide to a clear spot.
  const staticBoxes: LBox[] = []
  const WALL = 6 // wall-band thickness to catch a label straddling a container stroke
  for (const n of layout.nodes) {
    const left = n.x + OFF
    const top = n.y + OFF
    if (n.kind === 'container' || n.kind === 'grid') {
      const tw = ((n.s.label?.length ?? 0) * FONT_SIZE) / 1.85 + 6 // title text width estimate
      if (tw > 8) staticBoxes.push({ x: left + 6, y: top + 2, w: tw, h: 18 })
      staticBoxes.push({ x: left - WALL / 2, y: top, w: WALL, h: n.h }) // left wall
      staticBoxes.push({ x: left + n.w - WALL / 2, y: top, w: WALL, h: n.h }) // right wall
      staticBoxes.push({ x: left, y: top - WALL / 2, w: n.w, h: WALL }) // top wall
      staticBoxes.push({ x: left, y: top + n.h - WALL / 2, w: n.w, h: WALL }) // bottom wall
    } else {
      staticBoxes.push({ x: left, y: top, w: n.w, h: n.h }) // leaf node box (its own label lives inside)
    }
  }
  // fixed obstacles: parallel-pair label boxes (already positioned, not moved here)
  const fixedBoxes: LBox[] = []
  for (const d of drawn)
    if (d.lpos && d.masked)
      fixedBoxes.push(boxOf(d.lpos, d.e.lw as number, d.e.lh as number))
  // lone labels start at their primary (candidates[0]); coordinate-descent then nudges them apart
  const lone = drawn.filter((d) => d.e.label && !d.lpos)
  const candOf = new Map<(typeof lone)[number], number[][]>()
  for (const d of lone) {
    const c = labelCandidates(d.route, d.e.lw ?? 0, d.e.lh ?? 0)
    candOf.set(d, c)
    d.lpos = c[0]
  }
  // Iterative deconfliction (coordinate descent). Each pass re-places every lone label at its lowest-cost
  // candidate given ALL OTHER labels' CURRENT positions — cost lexicographic: (1) don't overlap another
  // label box, (2) don't cover ANOTHER edge's bend, (3) stay near the route midpoint (candidate index).
  // Re-placing against current positions (not just earlier-placed) lets BOTH members of a colliding pair
  // move, so two wide labels on nearby parallel segments (oauth redirect / request+token) separate instead
  // of one staying stuck. Total cost is monotonically non-increasing → converges; capped at 6 passes.
  const order = [...lone].sort((a, b) => (b.e.lw ?? 0) - (a.e.lw ?? 0))
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (const d of order) {
      const lw = d.e.lw ?? 0
      const lh = d.e.lh ?? 0
      if (!(lw && lh)) continue // unmasked label: no box → nothing to deconflict
      const others = fixedBoxes.slice()
      for (const o of lone)
        if (o !== d && o.e.lw && o.e.lh)
          others.push(boxOf(o.lpos as number[], o.e.lw, o.e.lh))
      const cands = candOf.get(d) as number[][]
      let best = cands[0]
      let bestCost = Number.POSITIVE_INFINITY
      cands.forEach((c, idx) => {
        const box = boxOf(c, lw, lh)
        let ovr = 0
        for (const p of others) if (boxesOverlap(box, p)) ovr++
        let stat = 0
        for (const p of staticBoxes) if (boxesOverlap(box, p)) stat++
        let bend = 0
        for (const cc of cornerList)
          if (cc.owner !== d && inBox(cc.p, box)) bend++
        let line = 0
        for (const s of segList)
          if (s.owner !== d && segHitsBoxLbl(s.a, s.b, box)) line++
        // label-overlap ≫ static (title/wall/node) ≫ other-bend ≫ other-line ≫ distance-from-mid
        const cost = ovr * 10000 + stat * 4000 + bend * 1000 + line * 500 + idx
        if (cost < bestCost) {
          bestCost = cost
          best = c
        }
      })
      if (best !== d.lpos) {
        d.lpos = best
        changed = true
      }
    }
    if (!changed) break
  }

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
  // Canvas = TIGHT bbox of ALL drawn geometry (nodes + simplified routes + label boxes) + a uniform margin.
  // ELK's layout.W/H is unreliable after refineLayout: too WIDE once compactBackRings pulls the back-edge
  // rings in (dead right margin), and too NARROW when the A* router loops into its PAD margin (cicd2's
  // negative-x cycle-closer used to get clipped). Sizing to the real extent fixes both. The label mask's
  // white rect must cover the same box (it masks-out anything outside it).
  let gMinX = Number.POSITIVE_INFINITY
  let gMinY = Number.POSITIVE_INFINITY
  let gMaxX = Number.NEGATIVE_INFINITY
  let gMaxY = Number.NEGATIVE_INFINITY
  const grow = (x: number, y: number) => {
    if (x < gMinX) gMinX = x
    if (y < gMinY) gMinY = y
    if (x > gMaxX) gMaxX = x
    if (y > gMaxY) gMaxY = y
  }
  for (const n of layout.nodes) {
    if (n.near) continue // near shapes are placed relative to the tight bbox below (task 126A)
    grow(n.x + OFF, n.y + OFF)
    grow(n.x + OFF + n.w, n.y + OFF + n.h)
  }
  for (const d of drawn) for (const p of d.route) grow(p[0], p[1])
  for (const r of labelRects) {
    grow(r.x, r.y)
    grow(r.x + r.w, r.y + r.h)
  }
  if (!Number.isFinite(gMinX)) {
    gMinX = 0
    gMinY = 0
    gMaxX = W
    gMaxY = H
  }

  // Position viewport-pinned near shapes relative to the TIGHT content bbox (task 126A), then grow the
  // bbox to include them. Each constant maps to a band (top/center/bottom × left/center/right); the
  // shape sits just OUTSIDE the content on its edge with a uniform margin. center-left/right go to the
  // sides; everything else above/below. Multiple shapes in the same region stack downward.
  const nearNodes = layout.nodes.filter((n) => n.near)
  if (nearNodes.length) {
    const cMinX = gMinX
    const cMinY = gMinY
    const cMaxX = gMaxX
    const cMaxY = gMaxY
    const ccx = (cMinX + cMaxX) / 2
    const ccy = (cMinY + cMaxY) / 2
    const NM = 24 // margin between the content and a pinned shape
    const stack = new Map<string, number>() // per-region vertical offset for stacking
    for (const n of nearNodes) {
      const key = n.near as string
      const [vert, horiz] = key.split('-')
      let left: number
      let top: number
      // center-left / center-right pin to the SIDES (outside horizontally); all else above/below.
      if (vert === 'center' && horiz !== 'center') {
        left = horiz === 'left' ? cMinX - NM - n.w : cMaxX + NM
        top = ccy - n.h / 2
      } else {
        left =
          horiz === 'left'
            ? cMinX
            : horiz === 'right'
              ? cMaxX - n.w
              : ccx - n.w / 2
        top = vert === 'top' ? cMinY - NM - n.h : cMaxY + NM
        if (vert === 'center') top = ccy - n.h / 2
      }
      const off = stack.get(key) || 0
      top += off
      stack.set(key, off + n.h + 8)
      // store layout coords (the draw passes add OFF back)
      n.x = left - OFF
      n.y = top - OFF
      grow(left, top)
      grow(left + n.w, top + n.h)
    }
  }
  const VBMARGIN = OFF
  const vbX = Math.floor(gMinX) - VBMARGIN
  const vbY = Math.floor(gMinY) - VBMARGIN
  const vbW = Math.ceil(gMaxX) + VBMARGIN - vbX
  const vbH = Math.ceil(gMaxY) + VBMARGIN - vbY
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

  // Page background (colour themes only). A self-contained light/dark card behind everything so the
  // diagram reads identically regardless of the VS Code editor background. Mono theme has no bg →
  // transparent canvas that follows the editor (today's behaviour). Drawn first = furthest back.
  if (sty.bg)
    parts.push(
      `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${sty.bg}"/>`,
    )

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
    const cfill = contFillAt(s) // d2 nesting cascade B4→B5→B6→N7
    parts.push(
      `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${n.w.toFixed(1)}" height="${n.h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, cfill, sty.contStroke)} fill-opacity="${s.fill ? '1' : sty.contOpacity}"/>`,
    )
    parts.push(
      `<text x="${(left + 8).toFixed(1)}" y="${(top + 16).toFixed(1)}" ${textAttrs(s, FONT_SIZE, cfill, sty.text)}>${esc2(s.label)}</text>`,
    )
  }

  let hasAnimated = false // task 124 #1 — inject the marching-dash CSS only when an edge uses it
  for (const { e, route, lpos } of drawn) {
    // Effective arrowhead shape per end (task 128): explicit shape wins, else the legacy boolean.
    const dstShape = endShape(e.dstArrowhead, e.dstArrow !== false)
    const srcShape = endShape(e.srcArrowhead, e.srcArrow === true)
    // Retract the line ends so the stroke meets the arrowhead base / border, not the node centre
    // (mirrors D2's getArrowheadAdjustments); the arrowhead itself stays at the original endpoint.
    // Depth varies per shape — a diamond is longer than a triangle, a crow's-foot "many" stops at
    // its apex (task 128).
    const rp = route.map((p) => [p[0], p[1]])
    if (rp.length >= 2) {
      const last = rp.length - 1
      rp[last] = towards(rp[last], rp[last - 1], arrowheadDepth(dstShape))
      rp[0] = towards(rp[0], rp[1], arrowheadDepth(srcShape))
    }
    const d =
      layout.edgeStyle === 'orthogonal' ? roundedPolyPath(rp) : splinePath(rp)
    // Connection style (task 124 #1): an explicit source style wins; else keep the theme default
    // (themeColor / width 2). The arrowheads below follow the same effective stroke colour.
    const es = e.style
    const eStroke = es?.stroke || themeColor
    let edgeAttrs = `stroke="${eStroke}" stroke-width="${es?.strokeWidth ? Number(es.strokeWidth) : 2}"`
    if (es?.strokeDash && Number(es.strokeDash) > 0)
      edgeAttrs += ` stroke-dasharray="${es.strokeDash},${es.strokeDash}"`
    else if (es?.animated) edgeAttrs += ` stroke-dasharray="8,4"` // a march needs a dash pattern; default when unset
    if (es?.opacity && Number(es.opacity) !== 1)
      edgeAttrs += ` opacity="${es.opacity}"`
    if (es?.animated) hasAnimated = true
    parts.push(
      `<path d="${d}" fill="none" ${edgeAttrs}${es?.animated ? ' class="d2-anim"' : ''}${maskAttr}/>`,
    )
    const n = route.length
    if (dstShape !== 'none' && n >= 2) {
      const a = Math.atan2(
        route[n - 1][1] - route[n - 2][1],
        route[n - 1][0] - route[n - 2][0],
      )
      parts.push(
        arrowhead(dstShape, route[n - 1][0], route[n - 1][1], a, eStroke),
      )
      // Arrowhead label (ER cardinality / role, task 128): small muted text beside the endpoint.
      if (e.dstArrowhead?.label)
        parts.push(
          arrowheadLabel(e.dstArrowhead.label, route[n - 1], route[n - 2], sty),
        )
    }
    if (srcShape !== 'none' && n >= 2) {
      const a = Math.atan2(route[0][1] - route[1][1], route[0][0] - route[1][0])
      parts.push(arrowhead(srcShape, route[0][0], route[0][1], a, eStroke))
      if (e.srcArrowhead?.label)
        parts.push(
          arrowheadLabel(e.srcArrowhead.label, route[0], route[1], sty),
        )
    }
    if (e.label && lpos) {
      // d2 draws connection labels in N2 (muted), italic — not the connection's own colour.
      parts.push(
        `<text x="${lpos[0].toFixed(1)}" y="${lpos[1].toFixed(1)}" font-size="${EDGE_FONT_SIZE}" text-anchor="middle" dominant-baseline="middle" font-style="italic" fill="${sty.textMuted}">${esc2(e.label)}</text>`,
      )
    }
  }

  // Animated connections (task 124 #1): march the dashes via CSS, disabled under reduced-motion.
  // Injected once, only when an edge opted in. SVG <style> is global regardless of document position.
  if (hasAnimated)
    parts.push(
      '<style>@keyframes d2dash{to{stroke-dashoffset:-12}}.d2-anim{animation:d2dash .6s linear infinite}@media(prefers-reduced-motion:reduce){.d2-anim{animation:none}}</style>',
    )

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
      parts.push(drawSqlTable(s, n.sqlCols || [0, 0, 0], left, top, w, h, sty))
      continue
    }
    if (n.kind === 'class') {
      parts.push(drawClass(s, left, top, w, h, sty))
      continue
    }

    const R = left + w
    const B = top + h
    const f1 = (v: number) => v.toFixed(1)
    // All bespoke shape geometry below is a faithful port of d2 v0.7.1 lib/shape (paths derived
    // from the real `d2` binary's SVG output, sizing from GetDimensionsToFit/GetInnerBox). The
    // label position (lx,ly) defaults to the box centre but shifts for shapes whose D2 inner box
    // is offset (cylinder caps, queue caps, callout tail, package tab, document wave).
    let lx = cx
    let ly = cy

    // person: head+shoulders silhouette as ONE outline, label rendered BELOW the figure (d2
    // shape_person renders the label outside, under the figure). dimsToFit reserves a label band.
    if (s.shape === 'person') {
      const band = FONT_SIZE + 8
      const sd = Math.min(w, h - band) // square figure side, centred in the box top
      const fx = cx - sd / 2
      const X = (t: number) => f1(fx + t * sd)
      const Y = (t: number) => f1(top + t * sd)
      parts.push(
        `<path d="M${X(1)},${Y(1)} H${X(0)} V${Y(0.99)} C${X(0)},${Y(0.82)} ${X(0.108)},${Y(0.67)} ${X(0.283)},${Y(0.59)} C${X(0.183)},${Y(0.53)} ${X(0.133)},${Y(0.43)} ${X(0.133)},${Y(0.33)} C${X(0.133)},${Y(0.15)} ${X(0.292)},${Y(0)} ${X(0.5)},${Y(0)} C${X(0.7)},${Y(0)} ${X(0.867)},${Y(0.15)} ${X(0.867)},${Y(0.33)} C${X(0.867)},${Y(0.44)} ${X(0.808)},${Y(0.53)} ${X(0.717)},${Y(0.59)} C${X(0.892)},${Y(0.66)} ${X(1)},${Y(0.82)} ${X(1)},${Y(0.99)} V${Y(1)} H${X(1)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
      )
      parts.push(
        `<text x="${f1(cx)}" y="${f1(top + sd + band / 2)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(s, FONT_SIZE, sty.leafFill, sty.text)}>${esc2(s.label)}</text>`,
      )
      continue
    }

    const rx = s.borderRadius ? Number(s.borderRadius) : 4

    // shape: image (task 124 #3) — the node IS the picture (s.icon = the URL); fills the box. CSP
    // gates the URL (data:/blob: always, https only with image.allowRemoteImages). A tooltip/link, if
    // any, is added by the decorations post-pass below.
    if (s.shape === 'image' && s.icon) {
      parts.push(
        `<image href="${esc2(s.icon)}" x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" preserveAspectRatio="xMidYMid meet"/>`,
      )
      continue
    }

    // shape: text / code (task 124 #2 — no WASM; shape + label already marshalled). text = borderless
    // left-aligned prose; code = monospace in a subtle panel. Multi-line labels become <tspan> rows
    // (SVG <text> doesn't wrap on \n). Geometry mirrors leafInfo's textShapeBox. Syntax highlighting
    // for code needs the block language (not marshalled yet) and is deferred.
    if (s.shape === 'text' || s.shape === 'code') {
      const isCode = s.shape === 'code'
      const fs = isCode ? CODE_FONT : FONT_SIZE
      const pad = isCode ? CODE_PAD : TEXT_PAD
      if (isCode)
        // d2 paints code on its N7 paper fill; an explicit source style still wins.
        parts.push(
          `<rect x="${f1(left)}" y="${f1(top)}" width="${f1(w)}" height="${f1(h)}" rx="${rx}" fill="${s.fill || sty.paper}" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 1}"${s.opacity && Number(s.opacity) !== 1 ? ` opacity="${s.opacity}"` : ''}/>`,
        )
      const fam = isCode
        ? ' font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"'
        : ''
      const tx = f1(left + pad)
      const tspans = String(s.label)
        .split('\n')
        .map(
          (ln, i) =>
            `<tspan x="${tx}" y="${f1(top + pad + fs + i * fs * PROSE_LH)}">${esc2(ln)}</tspan>`,
        )
        .join('')
      parts.push(
        `<text font-size="${fs}"${fam} fill="${s.fontColor || sty.text}">${tspans}</text>`,
      )
      continue
    }

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
        const i = w * 0.25 // d2 hexagon inset = w/4
        parts.push(
          `<polygon points="${(left + i).toFixed(1)},${top.toFixed(1)} ${(left + w - i).toFixed(1)},${top.toFixed(1)} ${(left + w).toFixed(1)},${cy} ${(left + w - i).toFixed(1)},${(top + h).toFixed(1)} ${(left + i).toFixed(1)},${(top + h).toFixed(1)} ${left.toFixed(1)},${cy}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'cylinder': {
        // d2 shape_cylinder: vertical sides + bezier ellipse caps; constant cap depth (arc=24,
        // defaultArcDepth). Front lip of the top cap drawn on top. Label sits below the top cap.
        const c = Math.min(24, h * 0.32)
        const x45 = f1(left + w * 0.45)
        const x55 = f1(left + w * 0.55)
        parts.push(
          `<path d="M${f1(left)},${f1(top + c)} C${f1(left)},${f1(top)} ${x45},${f1(top)} ${f1(cx)},${f1(top)} C${x55},${f1(top)} ${f1(R)},${f1(top)} ${f1(R)},${f1(top + c)} V${f1(B - c)} C${f1(R)},${f1(B)} ${x55},${f1(B)} ${f1(cx)},${f1(B)} C${x45},${f1(B)} ${f1(left)},${f1(B)} ${f1(left)},${f1(B - c)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${f1(left)},${f1(top + c)} C${f1(left)},${f1(top + 2 * c)} ${x45},${f1(top + 2 * c)} ${f1(cx)},${f1(top + 2 * c)} C${x55},${f1(top + 2 * c)} ${f1(R)},${f1(top + 2 * c)} ${f1(R)},${f1(top + c)}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        ly = top + 2 * c + (h - 3 * c) / 2 // d2 inner box: top += 2*arc, height -= 3*arc
        break
      }
      case 'queue': {
        // d2 shape_queue: a horizontal cylinder — 1 arc left, 2 arcs right (arc=24). Label sits
        // in the inner box (x += arc, width -= 3*arc → centre shifts left by arc/2).
        const c = Math.min(24, w * 0.32)
        const y45 = f1(top + h * 0.45)
        const y55 = f1(top + h * 0.55)
        const Lc = f1(left + c)
        const Rc = f1(left + w - c)
        const R2c = f1(left + w - 2 * c)
        parts.push(
          `<path d="M${Lc},${f1(top)} H${Rc} C${f1(R)},${f1(top)} ${f1(R)},${y45} ${f1(R)},${f1(cy)} C${f1(R)},${y55} ${f1(R)},${f1(B)} ${Rc},${f1(B)} H${Lc} C${f1(left)},${f1(B)} ${f1(left)},${y55} ${f1(left)},${f1(cy)} C${f1(left)},${y45} ${f1(left)},${f1(top)} ${Lc},${f1(top)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${Rc},${f1(top)} C${R2c},${f1(top)} ${R2c},${y45} ${R2c},${f1(cy)} C${R2c},${y55} ${R2c},${f1(B)} ${Rc},${f1(B)}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        lx = left + c + (w - 3 * c) / 2
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
      case 'parallelogram': {
        // d2 shape_parallelogram: slanted box, slant = 26px constant.
        const sl = Math.min(26, w * 0.33)
        parts.push(
          `<polygon points="${f1(left + sl)},${f1(top)} ${f1(R)},${f1(top)} ${f1(R - sl)},${f1(B)} ${f1(left)},${f1(B)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'document': {
        // d2 shape_document: rectangle with a single wavy dip along the bottom (overflows ~5%).
        const yb = f1(top + h * 0.86)
        parts.push(
          `<path d="M${f1(left)},${yb} L${f1(left)},${f1(top)} L${f1(R)},${f1(top)} L${f1(R)},${yb} C${f1(left + w * 0.833)},${f1(top + h * 0.68)} ${f1(left + w * 0.667)},${f1(top + h * 0.68)} ${f1(cx)},${yb} C${f1(left + w * 0.333)},${f1(top + h * 1.05)} ${f1(left + w * 0.167)},${f1(top + h * 1.05)} ${f1(left)},${yb} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        ly = top + h * 0.37 // label centred in the inner box (top 74%)
        break
      }
      case 'page': {
        // d2 shape_page: rectangle with a folded top-right corner (fold ~20px).
        const fold = Math.min(20, w * 0.33, h * 0.33)
        const xf = f1(R - fold)
        const yf = f1(top + fold)
        parts.push(
          `<path d="M${f1(left)},${f1(top)} H${xf} L${f1(R)},${yf} V${f1(B)} H${f1(left)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        parts.push(
          `<path d="M${xf},${f1(top)} V${yf} H${f1(R)}" fill="none" stroke="${s.stroke || sty.leafStroke}" stroke-width="${s.strokeWidth || 2}"/>`,
        )
        break
      }
      case 'stored_data': {
        // d2 shape_stored_data: cylinder on its side — both vertical edges bow right (wedge=15).
        const wd = Math.min(15, w * 0.3)
        parts.push(
          `<path d="M${f1(left + wd)},${f1(top)} H${f1(R)} C${f1(R - 4)},${f1(top)} ${f1(R - wd)},${f1(top + h * 0.27)} ${f1(R - wd)},${f1(cy)} C${f1(R - wd)},${f1(top + h * 0.73)} ${f1(R - 4)},${f1(B)} ${f1(R)},${f1(B)} H${f1(left + wd)} C${f1(left + 4)},${f1(B)} ${f1(left)},${f1(top + h * 0.73)} ${f1(left)},${f1(cy)} C${f1(left)},${f1(top + h * 0.27)} ${f1(left + 4)},${f1(top)} ${f1(left + wd)},${f1(top)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'package': {
        // d2 shape_package: rectangle with a smaller tab on the top-left.
        const tw = w * 0.5
        const th = Math.min(Math.max(h * 0.2, 20), 55)
        parts.push(
          `<path d="M${f1(left)},${f1(top)} L${f1(left + tw)},${f1(top)} L${f1(left + tw)},${f1(top + th)} L${f1(R)},${f1(top + th)} L${f1(R)},${f1(B)} L${f1(left)},${f1(B)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        ly = top + th + (h - th) / 2 // label below the tab
        break
      }
      case 'step': {
        // d2 shape_step: chevron/arrow block (wedge=35 on both sides).
        const wd = Math.min(35, w * 0.4)
        parts.push(
          `<polygon points="${f1(left)},${f1(top)} ${f1(R - wd)},${f1(top)} ${f1(R)},${f1(cy)} ${f1(R - wd)},${f1(B)} ${f1(left)},${f1(B)} ${f1(left + wd)},${f1(cy)}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        break
      }
      case 'callout': {
        // d2 shape_callout: speech bubble — body rectangle with a downward tail at bottom-centre.
        const tipW = Math.min(30, w * 0.3)
        const tipH = Math.min(45, h * 0.4)
        const yb = f1(B - tipH)
        parts.push(
          `<path d="M${f1(left)},${f1(top)} V${yb} H${f1(cx)} V${f1(B)} L${f1(cx + tipW)},${yb} H${f1(R)} V${f1(top)} Z" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
        ly = top + (h - tipH) / 2 // label in the body, above the tail
        break
      }
      default:
        parts.push(
          `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, sty.leafFill, sty.leafStroke)}/>`,
        )
    }
    parts.push(
      `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(s, FONT_SIZE, sty.leafFill, sty.text)}>${esc2(s.label)}</text>`,
    )
  }

  // Decorations pass (task 124 #3/#5) — ON TOP of every node so icons show and the tooltip/link
  // hit-rect beats the shape's fill for hover/click. shape:image draws its own picture above (skip its
  // icon here). Covers containers + leaves; grids manage their own children.
  for (const n of layout.nodes) {
    if (n.kind === 'grid') continue
    const s = n.s
    const left = n.x + OFF
    const top = n.y + OFF
    if (s.icon && s.shape !== 'image')
      parts.push(nodeIconImage(s.icon, left, top, n.w, n.h))
    const ov = nodeHitOverlay(s, left, top, n.w, n.h)
    if (ov) parts.push(ov)
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
  // Grid container = a level-0 container fill (d2 B4); cells are leaves (B6).
  const cfill = sty.mono ? sty.contFill : sty.fills[0]
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ${paintAttrs(s, cfill, sty.contStroke)} fill-opacity="${s.fill ? '1' : sty.contOpacity}"/>`,
  )
  if (s.label)
    out.push(
      `<text x="${(left + 8).toFixed(1)}" y="${(top + gi.headerH - 6).toFixed(1)}" ${textAttrs(s, FONT_SIZE, cfill, sty.text)}>${esc2(s.label)}</text>`,
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
      `<text x="${(cx + cw / 2).toFixed(1)}" y="${(cy + ch / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${textAttrs(c, FONT_SIZE, sty.leafFill, sty.text)}>${esc2(c.label)}</text>`,
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
  sty: D2Style,
): string {
  const out: string[] = []
  // Faithful d2 sql_table colouring (verified against the binary): NEUTRAL body (N7 fill, N1 border),
  // a SOLID N1 header with N7 (paper) title text, dividers in N1, and columns name=B2 / type=N2 /
  // constraint=AA2. In mono there are no fixed colours, so fall back to the original subtle look
  // (transparent body, currentColor border, faint header tint, currentColor text).
  const border = s.stroke || (sty.mono ? 'currentColor' : sty.text)
  const body = s.fill || (sty.mono ? 'transparent' : sty.paper)
  const headerFill = sty.mono ? 'currentColor' : sty.text
  const headerOp = sty.mono ? ' fill-opacity="0.12"' : ''
  const headerText = s.fontColor || (sty.mono ? 'currentColor' : sty.paper)
  const nameC = sty.mono ? 'currentColor' : sty.accent
  const typeC = sty.mono ? 'currentColor' : sty.textMuted
  const consC = sty.mono ? 'currentColor' : sty.accent2
  const dim = sty.mono ? ' opacity="0.7"' : '' // mono dims type/constraint; themed uses full tokens
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${body}" stroke="${border}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${HEADER_H}" rx="4" fill="${headerFill}"${headerOp}/>`,
  )
  out.push(
    `<text x="${(left + w / 2).toFixed(1)}" y="${(top + HEADER_H / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" font-weight="700" fill="${headerText}">${esc2(s.label)}</text>`,
  )
  ;(s.columns || []).forEach((c, i) => {
    const ry = top + HEADER_H + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="${border}" stroke-width="1"${sty.mono ? ' stroke-opacity="0.3"' : ''}/>`,
    )
    const ty = ry + ROW_H / 2
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${nameC}">${esc2(c.name)}</text>`,
    )
    if (c.type)
      out.push(
        `<text x="${(left + CELL_PAD * 2 + cols[0]).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${typeC}"${dim}>${esc2(c.type)}</text>`,
      )
    if (c.constraint)
      out.push(
        `<text x="${(left + w - CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="end" dominant-baseline="central" font-size="${EDGE_FONT_SIZE}" fill="${consC}"${dim}>${esc2(abbr(c.constraint))}</text>`,
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
  sty: D2Style,
): string {
  const out: string[] = []
  // Faithful d2 class colouring: NEUTRAL body (N7 fill, N1 border), SOLID N1 header with N7 title,
  // and members coloured per token — visibility marker=B2, name=N1, type=AA2 (via tspans). Mono falls
  // back to the original subtle monochrome look.
  const border = s.stroke || (sty.mono ? 'currentColor' : sty.text)
  const body = s.fill || (sty.mono ? 'transparent' : sty.paper)
  const headerFill = sty.mono ? 'currentColor' : sty.text
  const headerOp = sty.mono ? ' fill-opacity="0.12"' : ''
  const headerText = s.fontColor || (sty.mono ? 'currentColor' : sty.paper)
  const visC = sty.mono ? 'currentColor' : sty.accent // B2
  const nameC = sty.mono ? 'currentColor' : sty.text // N1
  const typeC = sty.mono ? 'currentColor' : sty.accent2 // AA2
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${body}" stroke="${border}" stroke-width="${s.strokeWidth || 2}"/>`,
  )
  out.push(
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${HEADER_H}" rx="4" fill="${headerFill}"${headerOp}/>`,
  )
  out.push(
    `<text x="${(left + w / 2).toFixed(1)}" y="${(top + HEADER_H / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${FONT_SIZE}" font-weight="700" fill="${headerText}">${esc2(s.label)}</text>`,
  )
  let i = 0
  const row = (
    visibility: string | undefined,
    name: string,
    type: string | undefined,
    sep: string,
  ) => {
    const ty = top + HEADER_H + i * ROW_H + ROW_H / 2
    let spans = `<tspan fill="${visC}">${esc2(vis(visibility))}</tspan> <tspan fill="${nameC}">${esc2(name)}</tspan>`
    if (type)
      spans += `<tspan fill="${nameC}">${esc2(sep)}</tspan><tspan fill="${typeC}">${esc2(type)}</tspan>`
    out.push(
      `<text x="${(left + CELL_PAD).toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="central" font-size="${FONT_SIZE}" fill="${nameC}">${spans}</text>`,
    )
    i++
  }
  for (const f of s.fields || []) row(f.visibility, f.name, f.type, ': ')
  if ((s.methods?.length || 0) > 0) {
    const sy = top + HEADER_H + i * ROW_H
    out.push(
      `<line x1="${left.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(left + w).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${border}" stroke-width="1"${sty.mono ? ' stroke-opacity="0.3"' : ''}/>`,
    )
  }
  for (const m of s.methods || []) row(m.visibility, m.name, m.type, ' ')
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
    // Viewport-constant near (top-center, …) is now supported (task 126A); only the relative
    // "near: <shape-id>" form (Phase B) still falls back to raw source.
    if (s.special.nearKey && !isNearConstant(s.special.nearKey))
      return 'near positioning (relative to a shape)'
  }
  return null
}
