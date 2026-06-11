import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Pinned, vendored ECharts build (media-src/vendor/echarts) — see tasks/89.
// Vditor bundles 5.5.1; we vendor a newer build (ECharts 6, a MAJOR bump — fidelity verified
// at pin time). These guard the pin's integrity + Apache-2.0 attribution so a corrupted file, a
// forgotten source.json bump, or a dropped notice fails CI. build.mjs `syncEcharts` enforces the
// same sha256 and copies LICENSE/NOTICE into the shipped media/ tree.
const VENDOR = fileURLToPath(
  new URL('../../media-src/vendor/echarts/', import.meta.url),
)
const read = (f: string) => readFileSync(VENDOR + f)
const source = JSON.parse(read('source.json').toString())

describe('vendored ECharts pin', () => {
  it('records the package, a 6.x version, and Apache-2.0 license', () => {
    expect(source.package).toBe('echarts')
    expect(source.version).toMatch(/^6\.\d+\.\d+$/)
    expect(source.license).toBe('Apache-2.0')
  })

  it('echarts.min.js matches the sha256 recorded in source.json', () => {
    const got = createHash('sha256')
      .update(read('echarts.min.js'))
      .digest('hex')
    expect(got).toBe(source.sha256)
  })

  it('is the global UMD build Vditor loads (exposes window.echarts) at the pinned version', () => {
    const js = read('echarts.min.js').toString()
    expect(js).toMatch(/\.echarts\s*=\s*\{\}/)
    expect(js).toContain(`version="${source.version}"`)
  })
})

describe('ECharts license compliance (Apache-2.0)', () => {
  it('ships the Apache-2.0 license text', () => {
    expect(read('LICENSE').toString()).toMatch(/Apache License/i)
  })

  it('ships an attribution NOTICE naming the project + pinned version', () => {
    const notice = read('NOTICE').toString()
    expect(notice).toMatch(/echarts/i)
    expect(notice).toContain(source.version)
  })

  it('build output (if present) carries the notices next to the binary at the pinned sha', () => {
    const shipped = fileURLToPath(
      new URL('../../media/vditor/dist/js/echarts/', import.meta.url),
    )
    if (!existsSync(shipped + 'echarts.min.js')) return // pre-build: nothing to check
    expect(existsSync(shipped + 'echarts.LICENSE')).toBe(true)
    expect(existsSync(shipped + 'echarts.NOTICE')).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(shipped + 'echarts.min.js'))
      .digest('hex')
    expect(got).toBe(source.sha256)
  })
})
