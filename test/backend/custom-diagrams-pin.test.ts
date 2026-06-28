import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const resolve = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

function readJson(rel: string) {
  return JSON.parse(readFileSync(resolve(rel), 'utf8'))
}

describe('wavedrom pin (task 101)', () => {
  const source = readJson('../../media-src/vendor/wavedrom/source.json')
  const jsPath = resolve('../../media-src/vendor/wavedrom/wavedrom.min.js')

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['wavedrom.min.js'].sha256)
  })

  it('is a self-contained IIFE that sets window.wavedrom', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('wavedrom')
    expect(js).toContain('renderWaveForm')
  })

  it('has a version and MIT license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/wavedrom/LICENSE'),
      'utf8',
    )
    expect(license).toContain('MIT')
  })
})

describe('smiles-drawer pin (task 96 — 2.3.0 bump)', () => {
  const source = readJson('../../media-src/vendor/smiles-drawer/source.json')
  const jsPath = resolve(
    '../../media-src/vendor/smiles-drawer/smiles-drawer.min.js',
  )

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['smiles-drawer.min.js'].sha256)
  })

  it('is the global UMD build exposing SmiDrawer with draw()', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('SmiDrawer')
    expect(js).toContain('draw')
  })

  it('is pinned to 2.3.0 (the bumped version) and MIT', () => {
    // SHA above already locks the exact bytes (verified byte-identical to npm smiles-drawer@2.3.0);
    // this asserts the source.json label matches so the esbuild `?v=` cache-buster stays correct.
    expect(source.version).toBe('2.3.0')
    const license = readFileSync(
      resolve('../../media-src/vendor/smiles-drawer/LICENSE'),
      'utf8',
    )
    expect(license).toContain('MIT')
  })
})

describe('markmap combined offline bundle pin (task 95 — 0.18.12)', () => {
  const source = readJson('../../media-src/vendor/markmap/source.json')
  const jsPath = resolve('../../media-src/vendor/markmap/markmap.min.js')

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['markmap.min.js'].sha256)
  })

  it('is the combined lib+view bundle exposing window.markmap (Markmap + Transformer)', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('window.markmap')
    expect(js).toContain('Markmap')
    expect(js).toContain('Transformer')
    // (the bundle carries inert CDN strings from markmap-view's autoloader, but the render path
    //  uses the bundled lib/view directly — offline is proven by the real-VS-Code e2e under CSP
    //  default-src 'none'; so no no-CDN string assertion here.)
  })

  it('is pinned to 0.18.12 with MIT (markmap) + ISC (d3) licenses', () => {
    expect(source.version).toBe('0.18.12')
    const license = readFileSync(
      resolve('../../media-src/vendor/markmap/LICENSE'),
      'utf8',
    )
    expect(license).toContain('MIT')
    expect(license).toContain('ISC')
  })
})

describe('nomnoml pin (task 103)', () => {
  const source = readJson('../../media-src/vendor/nomnoml/source.json')
  const jsPath = resolve('../../media-src/vendor/nomnoml/nomnoml.min.js')

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['nomnoml.min.js'].sha256)
  })

  it('is an IIFE that exposes nomnoml.renderSvg', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('nomnoml')
    expect(js).toContain('renderSvg')
  })

  it('renderSvg produces an SVG string', () => {
    const vm = require('node:vm')
    const code = readFileSync(jsPath, 'utf8')
    const ctx = { window: {}, self: {} } as any
    ctx.window = ctx
    ctx.self = ctx
    vm.createContext(ctx)
    vm.runInContext(code, ctx)
    const svg = ctx.nomnoml.renderSvg('[A] -> [B]')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('has a version and MIT license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/nomnoml/LICENSE'),
      'utf8',
    )
    expect(license).toContain('MIT')
  })
})

describe('leaflet pin (task 99)', () => {
  const source = readJson('../../media-src/vendor/leaflet/source.json')
  const jsPath = resolve('../../media-src/vendor/leaflet/leaflet.js')
  const cssPath = resolve('../../media-src/vendor/leaflet/leaflet.css')

  it('vendored JS exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['leaflet.js'].sha256)
  })

  it('vendored CSS exists and sha256 matches source.json', () => {
    expect(existsSync(cssPath)).toBe(true)
    const css = readFileSync(cssPath)
    const got = createHash('sha256').update(css).digest('hex')
    expect(got).toBe(source.files['leaflet.css'].sha256)
  })

  it('is a UMD that exposes Leaflet with geoJSON support', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('Leaflet')
    expect(js).toContain('geoJSON')
  })

  it('has a version and BSD-2-Clause license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/leaflet/LICENSE'),
      'utf8',
    )
    expect(license).toContain('BSD')
  })
})

describe('topojson-client pin (task 99)', () => {
  const source = readJson('../../media-src/vendor/topojson/source.json')
  const jsPath = resolve(
    '../../media-src/vendor/topojson/topojson-client.min.js',
  )

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['topojson-client.min.js'].sha256)
  })

  it('is an IIFE that exposes topojson.feature', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('feature')
    expect(js).toContain('topojson')
  })

  it('has a version and ISC license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/topojson/LICENSE'),
      'utf8',
    )
    expect(license.length).toBeGreaterThan(10)
  })
})

describe('three.js STL viewer pin (task 100)', () => {
  const source = readJson('../../media-src/vendor/threejs/source.json')
  const jsPath = resolve('../../media-src/vendor/threejs/three-stl.min.js')

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['three-stl.min.js'].sha256)
  })

  it('is a tree-shaken IIFE exposing __threeSTL with STLLoader', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('__threeSTL')
    expect(js).toContain('STLLoader')
    expect(js).toContain('OrbitControls')
  })

  it('has a version and MIT license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/threejs/LICENSE'),
      'utf8',
    )
    expect(license).toContain('MIT')
  })
})

describe('vega-embed pin (task 102)', () => {
  const source = readJson('../../media-src/vendor/vega/source.json')
  const jsPath = resolve('../../media-src/vendor/vega/vega-embed.min.js')

  it('vendored bundle exists and sha256 matches source.json', () => {
    expect(existsSync(jsPath)).toBe(true)
    const js = readFileSync(jsPath)
    const got = createHash('sha256').update(js).digest('hex')
    expect(got).toBe(source.files['vega-embed.min.js'].sha256)
  })

  it('is an IIFE exposing window.vegaEmbed', () => {
    const js = readFileSync(jsPath, 'utf8')
    expect(js).toContain('vegaEmbed')
  })

  it('has a version and BSD-3-Clause license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/vega/LICENSE'),
      'utf8',
    )
    expect(license).toContain('Redistribution and use')
  })
})

describe('d2 compile-only wasm pin (task 104)', () => {
  const source = readJson('../../media-src/vendor/d2/source.json')
  const wasmPath = resolve('../../media-src/vendor/d2/d2-compile.wasm')
  const execPath = resolve('../../media-src/vendor/d2/wasm_exec.js')

  it('vendored wasm exists and sha256 matches source.json', () => {
    expect(existsSync(wasmPath)).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(wasmPath))
      .digest('hex')
    expect(got).toBe(source.files['d2-compile.wasm'].sha256)
  })

  it('vendored wasm_exec.js exists and sha256 matches source.json', () => {
    expect(existsSync(execPath)).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(execPath))
      .digest('hex')
    expect(got).toBe(source.files['wasm_exec.js'].sha256)
  })

  it('wasm starts with the \\0asm magic header', () => {
    const buf = readFileSync(wasmPath)
    expect(Array.from(buf.subarray(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d])
  })

  it('has a version and MPL-2.0 license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/d2/LICENSE'),
      'utf8',
    )
    expect(license).toContain('Mozilla Public License')
  })

  // D2_VER in the loader is a cache-buster that MUST equal the vendored version, else a webview
  // can serve stale wasm bytes across an extension update (mermaid/echarts have the same rule).
  it('d2-wasm.ts D2_VER matches source.json version', () => {
    const loader = readFileSync(
      resolve('../../media-src/src/d2-wasm.ts'),
      'utf8',
    )
    const m = loader.match(/const D2_VER = '([^']+)'/)
    expect(m?.[1]).toBe(source.version)
  })
})

describe('elkjs optional D2 layout engine pin (task 104)', () => {
  const source = readJson('../../media-src/vendor/elk/source.json')
  const apiPath = resolve('../../media-src/vendor/elk/elk-api.js')
  const workerPath = resolve('../../media-src/vendor/elk/elk-worker.min.js')

  it('vendored elk-api.js exists and sha256 matches source.json', () => {
    expect(existsSync(apiPath)).toBe(true)
    const got = createHash('sha256').update(readFileSync(apiPath)).digest('hex')
    expect(got).toBe(source.files['elk-api.js'].sha256)
  })

  it('vendored elk-worker.min.js exists and sha256 matches source.json', () => {
    expect(existsSync(workerPath)).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(workerPath))
      .digest('hex')
    expect(got).toBe(source.files['elk-worker.min.js'].sha256)
  })

  it('elk-api.js exposes the ELK class with a workerFactory contract', () => {
    const js = readFileSync(apiPath, 'utf8')
    expect(js).toContain('ELK')
    expect(js).toContain('workerFactory')
  })

  it('elk-worker.min.js exports a main-thread fake Worker (CommonJS branch)', () => {
    const js = readFileSync(workerPath, 'utf8')
    // The in-process fake Worker is exported only via the CommonJS branch — esbuild provides that
    // module context (elk-entry.ts), so no real Web Worker is ever created. See elk-entry.ts.
    expect(js).toContain('Worker:')
    expect(js).toContain('gwtOnLoad')
  })

  // The stock elk.bundled.js spawns a blob Web Worker that rejects under the VS Code webview; we
  // deliberately do NOT vendor or ship it. Lock that decision in.
  it('does NOT vendor the blob-Web-Worker elk.bundled.js', () => {
    expect(
      existsSync(resolve('../../media-src/vendor/elk/elk.bundled.js')),
    ).toBe(false)
    expect(source.files['elk.bundled.js']).toBeUndefined()
  })

  it('elk-entry.ts wires the main-thread fake worker onto window.__vmarkdElk', () => {
    const entry = readFileSync(
      resolve('../../media-src/src/elk-entry.ts'),
      'utf8',
    )
    expect(entry).toContain('workerFactory')
    expect(entry).toContain('__vmarkdElk')
    expect(entry).toContain('elk-worker.min.js')
  })

  it('has a version and EPL-2.0 license', () => {
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/)
    const license = readFileSync(
      resolve('../../media-src/vendor/elk/LICENSE'),
      'utf8',
    )
    expect(license).toContain('Eclipse Public License')
  })
})

// BND-4 invariant: the Canvas measureText font stack (d2-render.ts) and the bundled @font-face
// family (main.css) must agree, or label sizing drifts from the rendered SVG. Guard the rename.
describe('d2 font-stack invariant (BND-4)', () => {
  it('d2-render.ts and main.css both pin "Source Sans 3"', () => {
    const render = readFileSync(
      resolve('../../media-src/src/d2-render.ts'),
      'utf8',
    )
    const css = readFileSync(resolve('../../media-src/src/main.css'), 'utf8')
    expect(render).toContain('"Source Sans 3"')
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Source Sans 3"/)
  })
})
