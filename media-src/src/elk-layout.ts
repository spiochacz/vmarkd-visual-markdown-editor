// Optional ELK (Eclipse Layout Kernel) layout for D2 — selected via the `vmarkd.diagram.d2Layout`
// setting. Produces the same engine-neutral `Layout` as the dagre path (d2-render.ts), so toSVG
// renders both identically; ELK adds ORTHOGONAL (right-angle) edge routing + native container
// nesting. The vendored elkjs is lazy-loaded (only when this engine is active + a D2 block renders)
// as a SEPARATE bundle, media/vditor/dist/js/elk/elk-main.js — which constructs the ELK instance on
// the MAIN THREAD (no Web Worker) and exposes it as `window.__vmarkdElk`. See elk-entry.ts for why
// we avoid the stock blob-Web-Worker build (it rejects under the VS Code webview).
import type { D2Graph, D2Shape } from './d2-wasm'
import {
  type D2Palette,
  type Layout,
  type PlacedEdge,
  type PlacedNode,
  type Sizer,
  EDGE_FONT_SIZE,
  classify,
  computeGridInfo,
  leafInfo,
  toSVG,
} from './d2-render'
import { refineLayout } from './d2-refine'

declare const window: any

let elkInstance: any = null
let bootPromise: Promise<any> | null = null

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(id)) return resolve()
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => resolve()
    document.head.appendChild(s)
  })
}

// Lazy-load elk-main.js (constructs a main-thread ELK instance → window.__vmarkdElk) and cache it.
// Returns null if the engine can't be loaded (caller then falls back to dagre).
export function bootElk(cdn: string): Promise<any> {
  if (elkInstance) return Promise.resolve(elkInstance)
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    await loadScript(`${cdn}/dist/js/elk/elk-main.js`, 'vditorElkScript')
    elkInstance = window.__vmarkdElk ?? null
    return elkInstance
  })()
  return bootPromise
}

// Build an ELK graph (hierarchy for non-grid containers; fixed-size leaves for grid/sql/class/shape).
// `extraOptions` merges into (and overrides) the root layoutOptions — used by the render harness to
// trial alternate ELK option sets (aspectRatio/wrapping/algorithm/direction); the shipped path
// (renderD2GraphElk) passes none, keeping the default layered-DOWN orthogonal layout.
export async function layoutElk(
  graph: D2Graph,
  measure: Sizer,
  elk: any,
  extraOptions: Record<string, string> = {},
): Promise<Layout> {
  const { containers, gridIds, inGrid } = classify(graph)
  const gridInfo = computeGridInfo(graph, measure, gridIds)

  // Grid children are absorbed into the grid leaf (drawn by drawGrid), so they are NOT ELK nodes —
  // an edge touching one must be dropped, else ELK references a non-existent node.
  const elkNodeIds = new Set(
    graph.shapes.filter((s) => !inGrid(s)).map((s) => s.id),
  )

  // Port distribution along the NATURAL width (task 122): give each leaf its own ELK port per edge,
  // spread evenly across the existing border (1 edge → centred), so a node's edges leave/enter at
  // separate points instead of bunching at one — WITHOUT widening the box (D2 widens; we don't).
  // Outgoing → SOUTH (DOWN layout), incoming → NORTH. Keyed by the graph.edges index so the edge loop
  // below references the same port. Containers get no ports (edges use the container id, free port).
  const outList = new Map<string, number[]>()
  const inList = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, k: string, v: number) => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }
  // Always build ports (task 122): each leaf gets one ELK port per edge, spread evenly across its border
  // so a node's edges leave/enter at separate points instead of bunching at one. Containers get no ports.
  graph.edges.forEach((e, gi) => {
    if (!elkNodeIds.has(e.src) || !elkNodeIds.has(e.dst)) return
    if (!containers.has(e.src)) push(outList, e.src, gi)
    if (!containers.has(e.dst)) push(inList, e.dst, gi)
  })
  const portId = (id: string, side: 'o' | 'i', gi: number) =>
    `${id}${side}${gi}`

  // id -> kind/size, so we can rebuild PlacedNodes after ELK assigns positions.
  const meta = new Map<
    string,
    { s: D2Shape; kind: PlacedNode['kind']; sqlCols?: number[]; grid?: any }
  >()

  // Keep a handle on every built ELK node so edges can be attached to their least-common-ancestor
  // container (see below) rather than all dumped on root.
  const nodeById = new Map<string, any>()
  const buildNode = (s: D2Shape): any => {
    if (containers.has(s.id)) {
      meta.set(s.id, { s, kind: 'container' })
      const kids = graph.shapes
        .filter((c) => c.container === s.id)
        .map(buildNode)
      // Per-container edge↔edge spacing (task 122): tightens the routing LANES so an edge crossing a
      // container's interior sits 24px from the next lane (matches D2's container lanes). Baked from the
      // validated harness value.
      const ee = 24
      // Per-container edge↔node spacing (task 122): widens the routing LANES beside the node column inside
      // a container (where back-edges like ml's fail/retrain loop around), matching D2's wider container
      // lanes. Must be set on the CONTAINER node (not root) to affect intra-container routing. Baked = 60.
      const en = 60
      // Container padding (task 122): the gap between a line routed at the container edge and the box WALL
      // is the padding — the lever for "lines too close to the grouping box". Baked = 24 (top keeps the
      // extra 20px for the container label: 34 + (24 - 14) = 44).
      const cp = 24
      const pad = `[top=${34 + (cp - 14)},left=${cp},bottom=${cp},right=${cp}]`
      const node = {
        id: s.id,
        labels: [{ text: s.label }],
        children: kids,
        edges: [] as any[],
        layoutOptions: {
          'elk.padding': pad,
          'elk.spacing.edgeEdge': String(ee),
          'elk.layered.spacing.edgeEdgeBetweenLayers': String(ee),
          'elk.spacing.edgeNode': String(en),
          'elk.layered.spacing.edgeNodeBetweenLayers': String(en),
        },
      }
      nodeById.set(s.id, node)
      return node
    }
    const li = leafInfo(s, measure, gridInfo)
    meta.set(s.id, { s, kind: li.kind, sqlCols: li.sqlCols, grid: li.grid })
    const outs = outList.get(s.id) || []
    const ins = inList.get(s.id) || []
    const nPorts = Math.max(outs.length, ins.length)
    // D2's EXACT node-widening rule (d2elklayout/layout.go, task 122): a node with ≥2 ports on either side
    // widens to max(natural, max(in,out)*40) so its ports (and thus the lines leaving/entering) spread
    // ~40px apart instead of bunching on a narrow box. Baked from the validated harness path.
    let w = li.w
    if (outs.length >= 2 || ins.length >= 2) w = Math.max(li.w, nPorts * 40)
    // Ports spread evenly across the border: k-th of n at w*(k+1)/(n+1) → 1 edge centred.
    const ports = [
      ...outs.map((gi, k) => ({
        id: portId(s.id, 'o', gi),
        x: (w * (k + 1)) / (outs.length + 1),
        y: li.h,
        layoutOptions: { 'elk.port.side': 'SOUTH' },
      })),
      ...ins.map((gi, k) => ({
        id: portId(s.id, 'i', gi),
        x: (w * (k + 1)) / (ins.length + 1),
        y: 0,
        layoutOptions: { 'elk.port.side': 'NORTH' },
      })),
    ]
    const node: any = {
      id: s.id,
      width: w,
      height: li.h,
      labels: [{ text: s.label }],
    }
    if (ports.length) {
      node.ports = ports
      // FIXED_SIDE (task 122): lets ELK ORDER + position ports on the SOUTH/NORTH side it was assigned,
      // which kills declaration-order crossings. Baked from the validated harness path.
      node.layoutOptions = { 'elk.portConstraints': 'FIXED_SIDE' }
    }
    nodeById.set(s.id, node)
    return node
  }

  const roots = graph.shapes.filter((s) => !s.container).map(buildNode)

  // The container chain above a shape (nearest first), used to find an edge's owning container.
  const parentOf = new Map<string, string | undefined>()
  for (const s of graph.shapes) parentOf.set(s.id, s.container)
  const chainUp = (id: string): string[] => {
    const out: string[] = []
    let c = parentOf.get(id)
    while (c) {
      out.push(c)
      c = parentOf.get(c)
    }
    return out
  }
  // Least-common-ancestor CONTAINER of two endpoints (null = the root graph). ELK requires each edge
  // declared on the LCA of its endpoints; declaring intra-container edges on root + INCLUDE_CHILDREN
  // mis-routed them to the origin (top-left). Owning-container declaration fixes the routing.
  const lcaContainer = (a: string, b: string): string | null => {
    const cb = new Set(chainUp(b))
    for (const x of chainUp(a)) if (cb.has(x)) return x
    return null
  }

  const edgeMeta = new Map<
    string,
    {
      srcArrow: boolean
      dstArrow: boolean
      label?: string
      src: string
      dst: string
    }
  >()
  const rootEdges: any[] = []
  let ei = 0
  let gi = -1 // absolute graph.edges index (matches the port pre-pass keys)
  for (const e of graph.edges) {
    gi++
    if (!elkNodeIds.has(e.src) || !elkNodeIds.has(e.dst)) continue
    const id = `e${ei++}`
    edgeMeta.set(id, {
      srcArrow: e.srcArrow,
      dstArrow: e.dstArrow,
      label: e.label,
      src: e.src,
      dst: e.dst,
    })
    const owner = lcaContainer(e.src, e.dst)
    // Use the per-edge port when the endpoint is a leaf with ports; else the node id (containers).
    const srcRef = outList.has(e.src) ? portId(e.src, 'o', gi) : e.src
    const dstRef = inList.has(e.dst) ? portId(e.dst, 'i', gi) : e.dst
    const elkEdge: any = { id, sources: [srcRef], targets: [dstRef] }
    // Hand ELK the SIZED label so its layered pass reserves a gap for it (a "label dummy node") and
    // routes around it — instead of us dropping the text on the raw route midpoint where it collides
    // with lines/boxes (task 122). Measure with the SAME sizer + edge font size toSVG draws with, or
    // the reserved gap won't match the rendered text.
    if (e.label) {
      const lm = measure(e.label, EDGE_FONT_SIZE)
      elkEdge.labels = [
        {
          text: e.label,
          width: lm.w,
          height: lm.h,
          // Per-label (NOT root) — D2 sets it here; makes ELK centre the label ON the line instead of
          // beside it (task 122 on-line style). Root-level was a no-op.
          layoutOptions: { 'elk.edgeLabels.inline': 'true' },
        },
      ]
    }
    if (owner && nodeById.get(owner)?.edges)
      nodeById.get(owner).edges.push(elkEdge)
    else rootEdges.push(elkEdge)
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN', // matches D2's default + the dagre rankdir:TB path
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      // Layout tuning ported from D2's own d2elklayout config (source-verified, task 113/122): balanced
      // Brandes-Köpf alignment + preserved model order (stable, declaration-ordered) + greedy
      // model-order cycle breaking + higher thoroughness + min-size nodes → D2's clean BALANCED
      // fan-out instead of a lopsided one. Chosen by eye over baseline/airy/horizontal variants.
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
      'elk.layered.thoroughness': '8',
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      // Spacing/padding matched to D2 for clearer layer separation.
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '40',
      // Edge↔node lane spacing (task 122): the lever for how far bends sit from boxes — the edge↔node
      // clearance INSIDE the inter-layer gap, where a DOWN-routed edge turns into its horizontal channel.
      // ELK's default is only 10 → bends hug the box; D2 sets it wider (EdgeNodeSpacing → both keys,
      // d2elklayout/layout.go). Baked = 60 from the validated harness path so back-edges loop around boxes
      // with room (matches the per-container `en`).
      'elk.spacing.edgeNode': '60',
      'elk.layered.spacing.edgeNodeBetweenLayers': '60',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '50',
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      // Place edge labels in space ELK reserves for them (task 122) — paired with the sized,
      // per-label-inline `labels` we attach per edge above. We leave centerLabelPlacementStrategy at
      // ELK's default (MEDIAN_LAYER, same as D2): it keeps antiparallel pairs as a tight parallel pair
      // AND spreads their labels along the centre line so they don't collide (TAIL_LAYER instead shoved
      // the two lines far apart — broke the routing). The deconfliction works because toSVG now reads the
      // label position straight from ELK (lx/ly) instead of recomputing the geometric midpoint.
      'elk.edgeLabels.placement': 'CENTER',
      ...extraOptions,
    },
    children: roots,
    edges: rootEdges,
  }

  const res = await elk.layout(elkGraph)

  const nodes: PlacedNode[] = []
  const placedEdges: PlacedEdge[] = []

  // ELK reports a node's child positions AND any edges it owns RELATIVE TO THAT NODE'S top-left.
  // With `hierarchyHandling: INCLUDE_CHILDREN` ELK moves each edge onto its least-common-ancestor
  // node, so an intra-container edge (e.g. spa→ssr) lives on the container with container-relative
  // coords — NOT on root. Reading only res.edges left those edges (and their labels) stranded at the
  // origin (top-left). So collect edges at EVERY level, offset by that node's absolute origin.
  const collectEdges = (node: any, ax: number, ay: number) => {
    for (const e of node.edges || []) {
      const em = edgeMeta.get(e.id) || { srcArrow: false, dstArrow: true }
      // ELK placed the label (CENTER) in the gap it reserved — its x/y is the label box's top-left,
      // relative to this node, so centre it + offset like the route points. Fall back to the route
      // midpoint only if ELK returned no label position (task 122).
      const elkLbl = e.labels?.[0]
      const labelPos =
        em.label && elkLbl && elkLbl.x != null
          ? [
              elkLbl.x + (elkLbl.width || 0) / 2 + ax,
              elkLbl.y + (elkLbl.height || 0) / 2 + ay,
            ]
          : null
      let firstSection = true
      for (const sec of e.sections || []) {
        const pts: [number, number][] = [
          sec.startPoint,
          ...(sec.bendPoints || []),
          sec.endPoint,
        ].map((p: any) => [p.x + ax, p.y + ay])
        // An edge can have several sections — draw the label on the FIRST only, at ELK's reserved
        // position (else the section midpoint).
        const mid = pts[Math.floor(pts.length / 2)]
        const lp = labelPos ?? mid
        const withLabel = firstSection && !!em.label
        placedEdges.push({
          points: pts,
          srcArrow: em.srcArrow,
          dstArrow: em.dstArrow,
          label: withLabel ? em.label : undefined,
          lx: withLabel ? lp?.[0] : undefined,
          ly: withLabel ? lp?.[1] : undefined,
          lw: withLabel ? elkLbl?.width : undefined,
          lh: withLabel ? elkLbl?.height : undefined,
          src: (em as any).src,
          dst: (em as any).dst,
        })
        firstSection = false
      }
    }
  }

  const walk = (n: any, ox: number, oy: number) => {
    const x = ox + (n.x || 0)
    const y = oy + (n.y || 0)
    const m = meta.get(n.id)
    if (m)
      nodes.push({
        s: m.s,
        x,
        y,
        w: n.width,
        h: n.height,
        kind: m.kind,
        sqlCols: m.sqlCols,
        grid: m.grid,
      })
    // This node's own edges are relative to its top-left (x,y).
    collectEdges(n, x, y)
    for (const c of n.children || []) walk(c, x, y)
  }
  collectEdges(res, 0, 0) // root-level edges are relative to (0,0)
  for (const c of res.children || []) walk(c, 0, 0)

  return {
    W: Math.ceil(res.width || 0),
    H: Math.ceil(res.height || 0),
    nodes,
    edges: placedEdges,
    edgeStyle: 'orthogonal',
  }
}

// Full ELK render: boot the engine, lay out, emit SVG. Returns null if ELK can't be loaded.
// Snap top-level leaf rows to a common centre-Y so a mixed-height row (e.g. a tall cylinder next to
// short rectangles) doesn't leave boxes 30-40px off a shared line — ELK centres uniform rows but not
// mixed-height ones, and there's no ELK flag for it (verified). Group leaves by centre-Y proximity,
// snap each group to its median, then drag every edge endpoint by the Δy of its nearest node so the
// routes follow; toSVG's simplifyRoute re-cleans them. Container children are left alone (their coords
// are container-relative — moving them could break the container). task 122.
export function alignRows(layout: Layout): void {
  const leaves = layout.nodes.filter(
    (n) => n.kind !== 'container' && n.kind !== 'grid' && !n.s.container,
  )
  const groups: { cy: number; items: PlacedNode[] }[] = []
  for (const n of [...leaves].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = n.y + n.h / 2
    const g = groups.find((gr) => Math.abs(gr.cy - cy) < 40)
    if (g) {
      g.items.push(n)
      g.cy = (g.cy * (g.items.length - 1) + cy) / g.items.length
    } else groups.push({ cy, items: [n] })
  }
  const delta = new Map<string, number>()
  for (const g of groups) {
    if (g.items.length < 2) continue
    const cys = g.items.map((n) => n.y + n.h / 2).sort((a, b) => a - b)
    const median = cys[Math.floor(cys.length / 2)]
    for (const n of g.items) {
      const d = median - (n.y + n.h / 2)
      if (Math.abs(d) > 0.5) {
        n.y += d
        delta.set(n.s.id, d)
      }
    }
  }
  if (!delta.size) return
  const centres = layout.nodes.map((n) => ({
    id: n.s.id,
    x: n.x + n.w / 2,
    y: n.y + n.h / 2,
  }))
  const nearestDelta = (px: number, py: number): number => {
    let best: string | null = null
    let bd = Number.POSITIVE_INFINITY
    for (const c of centres) {
      const dd = (c.x - px) ** 2 + (c.y - py) ** 2
      if (dd < bd) {
        bd = dd
        best = c.id
      }
    }
    return best ? delta.get(best) || 0 : 0
  }
  for (const e of layout.edges) {
    if (!e.points.length) continue
    const f = e.points[0]
    f[1] += nearestDelta(f[0], f[1])
    const l = e.points[e.points.length - 1]
    l[1] += nearestDelta(l[0], l[1])
  }
}

// After ELK layout + alignRows, a horizontal edge segment can sit jammed against a box top with no
// vertical room — e.g. cqrs `read` runs just above Orders View, squeezed between the projection row and
// the cylinder tops. ELK minimises edge length so it parks the turn right on the box edge and never
// reclaims the gap. spreadCrampedRows finds such segments and pushes the lower row (the box it's jammed
// against) + everything below it DOWN by a step-function Δy so the segment gets TARGET clearance —
// dragging every node y, every edge point y, and every straddling container's height to match. Routes
// stay orthogonal: only y shifts, by a step function of y, so a vertical segment crossing the boundary
// just lengthens. No-op when nothing is cramped. task 122.
export function spreadCrampedRows(layout: Layout): void {
  const CLEAR = 16 // a horizontal segment within this of a box top counts as cramped
  const TARGET = 24 // clearance to give it after spreading
  const MINLEN = 26 // ignore short port-attach jogs
  const leaves = layout.nodes.filter(
    (n) => n.kind !== 'container' && n.kind !== 'grid',
  )
  const xov = (a1: number, a2: number, b1: number, b2: number) =>
    Math.min(a2, b2) - Math.max(a1, b1) > 4
  // Each cramped horizontal segment → one push-down event at the lower-row top it's jammed against.
  const events: { y: number; d: number }[] = []
  for (const e of layout.edges) {
    const p = e.points
    for (let i = 1; i + 2 <= p.length - 1; i++) {
      const a = p[i]
      const b = p[i + 1]
      if (Math.abs(a[1] - b[1]) > 0.5) continue // horizontal only
      if (Math.abs(a[0] - b[0]) < MINLEN) continue // skip short jogs
      const yH = a[1]
      const x1 = Math.min(a[0], b[0])
      const x2 = Math.max(a[0], b[0])
      let lowTop = Number.POSITIVE_INFINITY
      for (const B of leaves) {
        if (!xov(x1, x2, B.x, B.x + B.w)) continue
        const top = B.y
        if (top > yH + 0.5 && top - yH < CLEAR && top < lowTop) lowTop = top
      }
      if (!Number.isFinite(lowTop)) continue
      const need = TARGET - (lowTop - yH)
      if (need <= 0) continue
      const ex = events.find((ev) => Math.abs(ev.y - lowTop) < 20)
      if (ex) ex.d = Math.max(ex.d, Math.ceil(need))
      else events.push({ y: lowTop, d: Math.ceil(need) })
    }
  }
  if (!events.length) return
  // Step function: a coordinate at/below an event boundary shifts down by that event's Δ (cumulative).
  const shift = (y: number) =>
    events.reduce((s, ev) => s + (ev.y <= y + 0.5 ? ev.d : 0), 0)
  // A container straddling an event boundary grows by that Δ so it keeps wrapping its moved children.
  const inside = (top: number, bot: number) =>
    events.reduce(
      (s, ev) => s + (ev.y > top + 0.5 && ev.y < bot - 0.5 ? ev.d : 0),
      0,
    )
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
}

export async function renderD2GraphElk(
  graph: D2Graph,
  measure: Sizer,
  cdn: string,
  palette?: D2Palette,
): Promise<string | null> {
  try {
    const elk = await bootElk(cdn)
    if (!elk) return null
    const layout = await layoutElk(graph, measure, elk)
    // Full post-process pipeline (task 122): row alignment, adaptive gaps, channel/bend cleanup, back-edge
    // A* reroute, label placement. See d2-refine.ts for the exact ordering and rationale.
    refineLayout(layout)
    return toSVG(layout, palette)
  } catch {
    // ELK can fail in the webview (e.g. blob-worker / CSP). NEVER let that break D2 rendering —
    // return null so renderD2 falls back to the dagre engine.
    return null
  }
}
