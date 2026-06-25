// Optional ELK (Eclipse Layout Kernel) layout for D2 — selected via the `vmarkd.diagram.d2Layout`
// setting. Produces the same engine-neutral `Layout` as the dagre path (d2-render.ts), so toSVG
// renders both identically; ELK adds ORTHOGONAL (right-angle) edge routing + native container
// nesting. The vendored elkjs is lazy-loaded (only when this engine is active + a D2 block renders)
// as a SEPARATE bundle, media/vditor/dist/js/elk/elk-main.js — which constructs the ELK instance on
// the MAIN THREAD (no Web Worker) and exposes it as `window.__vmarkdElk`. See elk-entry.ts for why
// we avoid the stock blob-Web-Worker build (it rejects under the VS Code webview).
import type { D2Graph, D2Shape } from './d2-wasm'
import {
  type D2Style,
  type EdgeStyle,
  type Layout,
  type PlacedEdge,
  type PlacedNode,
  type Sizer,
  EDGE_FONT_SIZE,
  buildNearNodes,
  classify,
  computeGridInfo,
  edgeStyle,
  isNearConstant,
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

// Map the d2 root direction keyword (task 127) → ELK direction + the side an edge LEAVES (out) /
// ENTERS (in) a node + whether the flow is horizontal. DOWN/UP keep the vertical flow (ports spread
// along WIDTH); LEFT/RIGHT flip to horizontal (ports spread along HEIGHT). Pure + exported so the
// port-side flipping (the risky part of 127) is unit-tested without booting the ELK engine.
export function elkDirectionConfig(direction?: string): {
  DIR: string
  isHoriz: boolean
  outSide: string
  inSide: string
} {
  const DIR =
    (
      { down: 'DOWN', up: 'UP', right: 'RIGHT', left: 'LEFT' } as Record<
        string,
        string
      >
    )[direction || 'down'] ?? 'DOWN'
  const isHoriz = DIR === 'LEFT' || DIR === 'RIGHT'
  // out/in are opposite sides on the flow axis: DOWN out=SOUTH/in=NORTH, RIGHT out=EAST/in=WEST, etc.
  const outSide =
    DIR === 'DOWN'
      ? 'SOUTH'
      : DIR === 'UP'
        ? 'NORTH'
        : DIR === 'RIGHT'
          ? 'EAST'
          : 'WEST'
  const inSide =
    DIR === 'DOWN'
      ? 'NORTH'
      : DIR === 'UP'
        ? 'SOUTH'
        : DIR === 'RIGHT'
          ? 'WEST'
          : 'EAST'
  return { DIR, isHoriz, outSide, inSide }
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

  // Root layout direction (task 127). Per-container direction is deferred.
  const { DIR, isHoriz, outSide, inSide } = elkDirectionConfig(graph.direction)

  // Grid children are absorbed into the grid leaf (drawn by drawGrid), so they are NOT ELK nodes —
  // an edge touching one must be dropped, else ELK references a non-existent node.
  // Viewport-pinned near shapes (task 126A) are NOT ELK nodes — they're placed by toSVG, so exclude
  // them here (and below) so ELK never sees them and edges touching them are dropped like grid kids.
  const elkNodeIds = new Set(
    graph.shapes
      .filter((s) => !inGrid(s) && !isNearConstant(s.special.nearKey))
      .map((s) => s.id),
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
        .filter(
          (c) => c.container === s.id && !isNearConstant(c.special.nearKey),
        )
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
    // grows along the SPREAD axis to max(natural, max(in,out)*40) so its ports (and thus the lines
    // leaving/entering) spread ~40px apart instead of bunching. Vertical flow spreads ports across the
    // width; horizontal flow (task 127) spreads them down the height — grow that axis instead.
    let w = li.w
    let h = li.h
    if (outs.length >= 2 || ins.length >= 2) {
      if (isHoriz) h = Math.max(li.h, nPorts * 40)
      else w = Math.max(li.w, nPorts * 40)
    }
    // Ports spread evenly across the assigned side: k-th of n at dim*(k+1)/(n+1) → 1 edge centred.
    // The spread runs along height for EAST/WEST sides, width for NORTH/SOUTH (task 127).
    const portPos = (side: string, k: number, n: number) => {
      const t = ((isHoriz ? h : w) * (k + 1)) / (n + 1)
      switch (side) {
        case 'SOUTH':
          return { x: t, y: h }
        case 'NORTH':
          return { x: t, y: 0 }
        case 'EAST':
          return { x: w, y: t }
        default: // WEST
          return { x: 0, y: t }
      }
    }
    const ports = [
      ...outs.map((gi, k) => ({
        id: portId(s.id, 'o', gi),
        ...portPos(outSide, k, outs.length),
        layoutOptions: { 'elk.port.side': outSide },
      })),
      ...ins.map((gi, k) => ({
        id: portId(s.id, 'i', gi),
        ...portPos(inSide, k, ins.length),
        layoutOptions: { 'elk.port.side': inSide },
      })),
    ]
    const node: any = {
      id: s.id,
      width: w,
      height: h,
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

  const roots = graph.shapes
    .filter((s) => !s.container && !isNearConstant(s.special.nearKey))
    .map(buildNode)

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
      style?: EdgeStyle // explicit connection style (task 124 #1)
      // Per-end arrowhead shape/label (task 128), carried through to PlacedEdge for toSVG.
      srcArrowhead?: { shape: string; label?: string }
      dstArrowhead?: { shape: string; label?: string }
      srcColumnIndex?: number // sql_table column-row endpoints (task 133)
      dstColumnIndex?: number
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
      style: edgeStyle(e), // task 124 #1
      srcArrowhead: e.srcArrowhead, // task 128
      dstArrowhead: e.dstArrowhead,
      srcColumnIndex: e.srcColumnIndex, // task 133
      dstColumnIndex: e.dstColumnIndex,
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
      'elk.direction': DIR, // root layout direction (task 127); DOWN matches D2's default
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
      // Fallback matches edgeMeta's value type (src/dst required) so em.label/src/dst type-check; it is
      // effectively dead since every collected edge id was registered in edgeMeta above.
      const em = edgeMeta.get(e.id) || {
        srcArrow: false,
        dstArrow: true,
        src: '',
        dst: '',
      }
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
          style: em.style, // task 124 #1
          srcArrowhead: em.srcArrowhead, // task 128
          dstArrowhead: em.dstArrowhead,
          srcColumnIndex: em.srcColumnIndex, // task 133
          dstColumnIndex: em.dstColumnIndex,
          label: withLabel ? em.label : undefined,
          lx: withLabel ? lp?.[0] : undefined,
          ly: withLabel ? lp?.[1] : undefined,
          lw: withLabel ? elkLbl?.width : undefined,
          lh: withLabel ? elkLbl?.height : undefined,
          src: em.src,
          dst: em.dst,
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

  // Viewport-pinned near shapes — positioned by toSVG, not ELK (task 126A).
  nodes.push(...buildNearNodes(graph, measure, gridInfo))

  return {
    W: Math.ceil(res.width || 0),
    H: Math.ceil(res.height || 0),
    nodes,
    edges: placedEdges,
    edgeStyle: 'orthogonal',
  }
}

// Full ELK render: boot the engine, lay out, emit SVG. Returns null if ELK can't be loaded. The
// post-process passes (alignRows, spreadCrampedRows, …) live in d2-refine.ts and run inside refineLayout —
// elk-layout no longer imports them (the elk-layout↔d2-refine cycle was broken by moving them there).
export async function renderD2GraphElk(
  graph: D2Graph,
  measure: Sizer,
  cdn: string,
  style?: D2Style,
  // `refine` distinguishes the two ELK-based engines exposed by vmarkd.diagram.d2Layout: 'vmarkd' (true,
  // the default) runs our refinement pipeline on top of ELK; 'elk' (false) returns the raw ELK layout.
  refine = true,
): Promise<string | null> {
  try {
    const elk = await bootElk(cdn)
    if (!elk) return null
    const layout = await layoutElk(graph, measure, elk)
    // Full post-process pipeline (task 122): row alignment, adaptive gaps, channel/bend cleanup, back-edge
    // A* reroute, label placement. See d2-refine.ts for the exact ordering and rationale. Skipped for the
    // raw 'elk' engine so users can compare/debug against our embellished 'vmarkd' output.
    // The refine passes assume a VERTICAL flow (row alignment, vertical band compaction, the A* grid),
    // so they're skipped for LEFT/RIGHT layouts (task 127, decision-gate option b — reduced pipeline);
    // UP/DOWN share the same axis and refine fine. Per-axis refine generalisation is a follow-up.
    const horiz = graph.direction === 'left' || graph.direction === 'right'
    if (refine && !horiz) {
      // Viewport-pinned near shapes (task 126A) sit at (0,0) until toSVG places them — hide them from
      // refine so its row/gap passes don't treat the phantom (0,0) node as real geometry, then re-add.
      const near = layout.nodes.filter((n) => n.near)
      layout.nodes = layout.nodes.filter((n) => !n.near)
      refineLayout(layout)
      layout.nodes.push(...near)
    }
    return toSVG(layout, style)
  } catch {
    // ELK can fail in the webview (e.g. blob-worker / CSP). NEVER let that break D2 rendering —
    // return null so renderD2 falls back to the dagre engine.
    return null
  }
}
