import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Pinned, vendored Mermaid build (media-src/vendor/mermaid) — see tasks/86.
// Vditor bundles 11.6.0; we vendor a newer same-major build. These guard the pin's
// integrity + MIT attribution so a corrupted file, a forgotten source.json bump, or a
// dropped notice fails CI. build.mjs `syncMermaid` enforces the same sha256 and copies
// LICENSE/NOTICE into the shipped media/ tree.
const VENDOR = fileURLToPath(
  new URL('../../media-src/vendor/mermaid/', import.meta.url),
)
const read = (f: string) => readFileSync(VENDOR + f)
const source = JSON.parse(read('source.json').toString())

describe('vendored Mermaid pin', () => {
  it('records the package, an 11.x version, and MIT license', () => {
    expect(source.package).toBe('mermaid')
    expect(source.version).toMatch(/^11\.\d+\.\d+$/)
    expect(source.license).toBe('MIT')
  })

  it('mermaid.min.js matches the sha256 recorded in source.json', () => {
    const got = createHash('sha256')
      .update(read('mermaid.min.js'))
      .digest('hex')
    expect(got).toBe(source.sha256)
  })

  it('is the global build Vditor loads (exposes globalThis.mermaid) at the pinned version', () => {
    const js = read('mermaid.min.js').toString()
    expect(js).toMatch(/globalThis(\.|\[")mermaid/)
    expect(js).toContain(`version:"${source.version}"`)
  })
})

describe('Mermaid license compliance (MIT)', () => {
  it('ships the MIT license text', () => {
    expect(read('LICENSE').toString()).toMatch(/MIT License/i)
  })

  it('ships an attribution NOTICE naming the project + pinned version', () => {
    const notice = read('NOTICE').toString()
    expect(notice).toMatch(/mermaid/i)
    expect(notice).toContain(source.version)
  })

  it('build output (if present) carries the notices next to the binary at the pinned sha', () => {
    const shipped = fileURLToPath(
      new URL('../../media/vditor/dist/js/mermaid/', import.meta.url),
    )
    if (!existsSync(`${shipped}mermaid.min.js`)) return // pre-build: nothing to check
    expect(existsSync(`${shipped}mermaid.LICENSE`)).toBe(true)
    expect(existsSync(`${shipped}mermaid.NOTICE`)).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(`${shipped}mermaid.min.js`))
      .digest('hex')
    expect(got).toBe(source.sha256)
  })
})
