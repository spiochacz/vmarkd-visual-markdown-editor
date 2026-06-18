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
})
