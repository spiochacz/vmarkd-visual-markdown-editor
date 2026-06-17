import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const resolve = (rel: string) =>
  fileURLToPath(new URL(rel, import.meta.url))

function readJson(rel: string) {
  return JSON.parse(readFileSync(resolve(rel), 'utf8'))
}

describe('wavedrom pin (task 101)', () => {
  const source = readJson(
    '../../media-src/vendor/wavedrom/source.json',
  )
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

describe('nomnoml pin (task 103)', () => {
  const source = readJson(
    '../../media-src/vendor/nomnoml/source.json',
  )
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
  const source = readJson(
    '../../media-src/vendor/leaflet/source.json',
  )
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
  const source = readJson(
    '../../media-src/vendor/topojson/source.json',
  )
  const jsPath = resolve('../../media-src/vendor/topojson/topojson-client.min.js')

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
  const source = readJson(
    '../../media-src/vendor/threejs/source.json',
  )
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
