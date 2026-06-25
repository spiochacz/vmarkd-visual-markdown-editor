import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Boot the vendored compile-only WASM in an isolated vm context and return window.d2compile.
function bootCompile(): (src: string) => any {
  const wasmExec = readFileSync(r('../vendor/d2/wasm_exec.js'), 'utf8')
  const wasm = readFileSync(r('../vendor/d2/d2-compile.wasm'))
  const ctx: any = {
    TextEncoder,
    TextDecoder,
    crypto,
    performance,
    console,
    fetch,
    Date,
    Math,
    Object,
    Array,
    JSON,
    Uint8Array,
    Reflect,
    WebAssembly,
  }
  ctx.globalThis = ctx
  // TinyGo's wasm_exec.js exports `Go` onto `global`/`window`/`self` (it predates the globalThis
  // convention Go's own wasm_exec uses), so the isolated vm context must expose one — point `global`
  // at the context. Without it the loader throws "cannot export Go".
  ctx.global = ctx
  vm.createContext(ctx)
  vm.runInContext(wasmExec, ctx)
  const go = new ctx.Go()
  return { go, wasm, ctx } as any
}

describe('d2 compile-only wasm (node smoke)', () => {
  let compile: (src: string) => any
  it('boots and compiles a->b into a graph with 2 shapes + 1 edge', async () => {
    const { go, wasm, ctx }: any = bootCompile()
    const { instance } = await WebAssembly.instantiate(wasm, go.importObject)
    go.run(instance) // do NOT await
    await new Promise((res) => setTimeout(res, 80))
    compile = ctx.d2compile
    const out = compile('a -> b')
    expect(out.error).toBeUndefined()
    const graph = JSON.parse(out.graph)
    expect(graph.shapes.length).toBe(2)
    expect(graph.edges.length).toBe(1)
    expect(graph.edges[0].dstArrow).toBe(true)
    expect(graph.sequence).toBe(false)
  })

  it('flags a top-level sequence_diagram on the graph', () => {
    const out = compile('shape: sequence_diagram\nalice -> bob: hi')
    expect(out.error).toBeUndefined()
    expect(JSON.parse(out.graph).sequence).toBe(true)
  })

  it('emits a circle shape + container nesting + grid flag', () => {
    const circle = JSON.parse(compile('x: {shape: circle}').graph)
    expect(circle.shapes[0].shape).toBe('circle')

    const nested = JSON.parse(compile('box: {\n  a -> b\n}').graph)
    expect(nested.shapes.find((s: any) => s.id === 'box.a')?.container).toBe(
      'box',
    )

    const grid = JSON.parse(compile('grid: {grid-rows: 2; a;b;c;d}').graph)
    expect(grid.shapes.find((s: any) => s.id === 'grid')?.special.isGrid).toBe(
      true,
    )
  })

  it('returns { error } for invalid d2 (never throws)', () => {
    const out = compile('a ->')
    expect(out.error).toBeTruthy()
  })

  it('marshals root + per-container direction (task 127)', () => {
    const graph = JSON.parse(
      compile('direction: right\na -> b\nc: {\n  direction: up\n  x -> y\n}')
        .graph,
    )
    expect(graph.direction).toBe('right')
    expect(graph.shapes.find((s: any) => s.id === 'c')?.direction).toBe('up')
    // a plain graph emits no direction field (omitempty)
    expect(JSON.parse(compile('a -> b').graph).direction).toBeUndefined()
  })

  it('marshals arrowhead shapes + labels per end (task 128)', () => {
    const graph = JSON.parse(
      compile(
        'a -> b: {\n  source-arrowhead: 1 { shape: cf-one }\n  target-arrowhead: * { shape: cf-many }\n}\np -> q: { target-arrowhead.shape: diamond }\nm -> n',
      ).graph,
    )
    const ab = graph.edges.find((e: any) => e.src === 'a')
    expect(ab.srcArrowhead).toEqual({ shape: 'cf-one', label: '1' })
    expect(ab.dstArrowhead).toEqual({ shape: 'cf-many', label: '*' })
    const pq = graph.edges.find((e: any) => e.src === 'p')
    expect(pq.dstArrowhead?.shape).toBe('diamond')
    expect(pq.srcArrowhead).toBeUndefined()
    // a plain edge carries no arrowhead objects (falls back to the booleans)
    const mn = graph.edges.find((e: any) => e.src === 'm')
    expect(mn.srcArrowhead).toBeUndefined()
    expect(mn.dstArrowhead).toBeUndefined()
  })

  it('resolves the filled-* arrowhead variant from style.filled (task 128)', () => {
    const graph = JSON.parse(
      compile(
        'a -> b: { target-arrowhead: { shape: diamond; style.filled: true } }',
      ).graph,
    )
    expect(graph.edges[0].dstArrowhead?.shape).toBe('filled-diamond')
  })

  it('marshals connection style: stroke/dash/width/opacity/animated (task 124 #1)', () => {
    const e = JSON.parse(
      compile(
        'a -> b: { style: { stroke: red; stroke-width: 4; stroke-dash: 3; opacity: 0.5; animated: true } }',
      ).graph,
    ).edges[0]
    expect(e.stroke).toBe('red')
    expect(e.strokeWidth).toBe('4')
    expect(e.strokeDash).toBe('3')
    expect(e.opacity).toBe('0.5')
    expect(e.animated).toBe(true)
    // an unstyled edge carries none (renderer keeps the theme default)
    const plain = JSON.parse(compile('a -> b').graph).edges[0]
    expect(plain.stroke).toBeUndefined()
    expect(plain.animated).toBeFalsy()
  })

  it('marshals sql_table column FK endpoints as indices (task 133)', () => {
    const graph = JSON.parse(
      compile(
        'users: { shape: sql_table; id: int {constraint: primary_key}; name: string }\norders: { shape: sql_table; id: int; user_id: int {constraint: foreign_key} }\norders.user_id -> users.id',
      ).graph,
    )
    const fk = graph.edges[0]
    expect(fk.src).toBe('orders') // endpoint is the TABLE node, not orders.user_id
    expect(fk.dst).toBe('users')
    expect(fk.srcColumnIndex).toBe(1) // user_id is the 2nd column of orders
    expect(fk.dstColumnIndex).toBe(0) // id is the 1st column of users
  })
})
