// Lazy loader for the vendored compile-only D2 WASM. Boots the TinyGo runtime once,
// caches the global window.d2compile, and exposes compileD2(src) -> graph object.
//
// The wasm is built with TinyGo (~6x smaller than stock Go); we ship TinyGo's wasm_exec.js.
// Its `Go` class is API-compatible with Go's (new Go() / go.importObject / go.run(instance)) and
// registers window.d2compile the same way, so this boot needs NO TinyGo-specific changes (verified
// rendering in headless chromium via the d2-render-harness). See media-src/vendor/d2/build/.
//
// CSP: instantiation goes through WebAssembly.instantiate, authorized by script-src 'unsafe-eval'
// (already shipped — the stock-Go wasm booted under the same CSP). If a future wasm fails to boot,
// add 'wasm-unsafe-eval' to html-builder.ts (the vmarkd-renderer-theming skill flags this).
//
// This module OWNS the D2Graph contract: the Go entrypoint (media-src/vendor/d2/build/main.go)
// emits JSON that MUST match this interface — keep them in sync (verified by d2-wasm.test.ts).

import { loadScript } from './load-script'

// The (Tiny)Go wasm_exec runtime handle + the synchronous compile entrypoint it registers.
// Typed so the window-global boundary is narrowed immediately on read (task 151 item 5).
interface GoRuntime {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): void
}
// d2compile returns EITHER an error string OR a JSON `graph` string (parsed to D2Graph).
interface D2CompileResult {
  error?: string
  graph?: string
}
type D2CompileFn = (src: string) => D2CompileResult
declare const window: Window & {
  Go?: new () => GoRuntime
  d2compile?: D2CompileFn
}

export interface D2Column {
  name: string
  type?: string
  constraint?: string
}
export interface D2Member {
  name: string
  type?: string // field type / method return
  visibility?: string
}
export interface D2Shape {
  id: string
  idVal: string
  label: string
  shape: string
  container?: string
  fill?: string
  stroke?: string
  strokeWidth?: string
  strokeDash?: string
  opacity?: string
  fontColor?: string
  borderRadius?: string
  bold?: boolean
  italic?: boolean
  // Interaction + media (task 124 #3/#5). tooltip → <title>; link → clickable <a>; icon = image URL
  // (the picture for shape:image, or a decorative icon on any other shape).
  tooltip?: string
  link?: string
  icon?: string
  direction?: string // per-container layout direction up|down|left|right (task 127)
  columns?: D2Column[] // sql_table
  fields?: D2Member[] // class fields
  methods?: D2Member[] // class methods
  special: {
    isSequence: boolean
    isGrid: boolean
    gridRows?: string
    gridColumns?: string
    nearKey?: string
  }
}
// One end of an edge's arrowhead: the d2-resolved shape string + optional cardinality/role
// label (task 128). Absent when the source didn't customise that end (fall back to the
// srcArrow/dstArrow boolean → default triangle / none).
export interface D2Arrowhead {
  shape: string // triangle | arrow | diamond | filled-diamond | circle | cf-many | … | none
  label?: string
}
export interface D2Edge {
  src: string
  dst: string
  label?: string
  srcArrow: boolean
  dstArrow: boolean
  // Connection style (task 124 #1); absent fields → the renderer keeps the theme default.
  stroke?: string
  strokeWidth?: string
  strokeDash?: string
  opacity?: string
  animated?: boolean
  srcArrowhead?: D2Arrowhead // task 128
  dstArrowhead?: D2Arrowhead // task 128
  // Column-row endpoints for sql_table FK edges (task 133); d2 computes these at compile time.
  // When set, the edge attaches to that column's row of the table node (a port), not the node box.
  srcColumnIndex?: number
  dstColumnIndex?: number
}
export interface D2Graph {
  shapes: D2Shape[]
  edges: D2Edge[]
  // A top-level `shape: sequence_diagram` lives on the ROOT object (not in shapes), so the
  // Go side sets this graph-level flag for both the top-level and named-container forms.
  sequence: boolean
  // Root layout direction up|down|left|right (task 127); empty/undefined = default (down).
  direction?: string
}

// Cache-buster: MUST equal media-src/vendor/d2/source.json "version" (bump both on a D2 update).
const D2_VER = '0.1.33'

let bootPromise: Promise<D2CompileFn | null> | null = null

export function bootD2(cdn: string): Promise<D2CompileFn | null> {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    await loadScript(
      `${cdn}/dist/js/d2/wasm_exec.js?v=${D2_VER}`,
      'vditorD2WasmExec',
    )
    if (!window.Go) return null
    let buf: ArrayBuffer
    try {
      const resp = await fetch(`${cdn}/dist/js/d2/d2-compile.wasm?v=${D2_VER}`)
      buf = await resp.arrayBuffer()
    } catch {
      return null
    }
    const go = new window.Go()
    const { instance } = await WebAssembly.instantiate(buf, go.importObject)
    go.run(instance) // blocks on select{}; do not await
    // Phase 0: cold init ~470 ms; d2compile registers within a few frames after go.run().
    // 50 rAF (~0.8 s @60 fps) is a generous safety margin, NOT a tuned constant. If the
    // global never registers we return null -> compileD2 -> {error:'d2 wasm unavailable'},
    // which renderD2 logs distinctly from a compile error.
    for (let i = 0; i < 50 && typeof window.d2compile !== 'function'; i++) {
      await new Promise((r) => requestAnimationFrame(r))
    }
    return typeof window.d2compile === 'function' ? window.d2compile : null
  })()
  return bootPromise
}

// window.d2compile is SYNCHRONOUS once booted; this exported wrapper is ASYNC because it first
// boots the WASM, and on any failure it RESOLVES (never rejects) with { error }.
export async function compileD2(
  cdn: string,
  src: string,
): Promise<D2Graph | { error: string }> {
  const fn = await bootD2(cdn)
  if (!fn) return { error: 'd2 wasm unavailable' }
  const out = fn(src)
  if (out.error) return { error: out.error }
  const g = JSON.parse(out.graph) as D2Graph
  // Go marshals nil slices as null; normalize so callers can iterate safely.
  if (!g.shapes) g.shapes = []
  if (!g.edges) g.edges = []
  return g
}
