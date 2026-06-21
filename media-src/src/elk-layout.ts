// Optional ELK (Eclipse Layout Kernel) layout for D2 — selected via the `vmarkd.diagram.d2Layout`
// setting. Produces the same engine-neutral `Layout` as the dagre path (d2-render.ts), so toSVG
// renders both identically; ELK adds ORTHOGONAL (right-angle) edge routing + native container
// nesting. The vendored elkjs is lazy-loaded (only when this engine is active + a D2 block renders)
// as a SEPARATE bundle, media/vditor/dist/js/elk/elk-main.js — which constructs the ELK instance on
// the MAIN THREAD (no Web Worker) and exposes it as `window.__vmarkdElk`. See elk-entry.ts for why
// we avoid the stock blob-Web-Worker build (it rejects under the VS Code webview).
import type { D2Graph, D2Shape } from './d2-wasm'
import {
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
      const node = {
        id: s.id,
        labels: [{ text: s.label }],
        children: kids,
        edges: [] as any[],
        layoutOptions: { 'elk.padding': '[top=34,left=14,bottom=14,right=14]' },
      }
      nodeById.set(s.id, node)
      return node
    }
    const li = leafInfo(s, measure, gridInfo)
    meta.set(s.id, { s, kind: li.kind, sqlCols: li.sqlCols, grid: li.grid })
    const node = {
      id: s.id,
      width: li.w,
      height: li.h,
      labels: [{ text: s.label }],
    }
    nodeById.set(s.id, node)
    return node
  }

  const roots = graph.shapes.filter((s) => !s.container).map(buildNode)

  // Grid children are absorbed into the grid leaf (drawn by drawGrid), so they are NOT ELK nodes —
  // an edge touching one must be dropped, else ELK references a non-existent node.
  const elkNodeIds = new Set(
    graph.shapes.filter((s) => !inGrid(s)).map((s) => s.id),
  )

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
    { srcArrow: boolean; dstArrow: boolean; label?: string }
  >()
  const rootEdges: any[] = []
  let ei = 0
  for (const e of graph.edges) {
    if (!elkNodeIds.has(e.src) || !elkNodeIds.has(e.dst)) continue
    const id = `e${ei++}`
    edgeMeta.set(id, {
      srcArrow: e.srcArrow,
      dstArrow: e.dstArrow,
      label: e.label,
    })
    const owner = lcaContainer(e.src, e.dst)
    const elkEdge: any = { id, sources: [e.src], targets: [e.dst] }
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
      'elk.spacing.edgeNode': '40',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '50',
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      // Place edge labels in space ELK reserves for them (task 122) — paired with the sized,
      // per-label-inline `labels` we attach per edge above.
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
export async function renderD2GraphElk(
  graph: D2Graph,
  measure: Sizer,
  cdn: string,
): Promise<string | null> {
  try {
    const elk = await bootElk(cdn)
    if (!elk) return null
    const layout = await layoutElk(graph, measure, elk)
    return toSVG(layout)
  } catch {
    // ELK can fail in the webview (e.g. blob-worker / CSP). NEVER let that break D2 rendering —
    // return null so renderD2 falls back to the dagre engine.
    return null
  }
}
