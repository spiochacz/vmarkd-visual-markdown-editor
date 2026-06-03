import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Pinned, vendored Lute engine (media-src/vendor/lute) — see tasks/66.
// These guard the pin's integrity and the Mulan PSL v2 license compliance so a
// corrupted file, a forgotten `source.json` bump, or a dropped notice fails CI
// instead of shipping silently. The build (build.mjs `syncLute`) enforces the
// same sha256 and copies LICENSE/NOTICE into the shipped media/ tree.
const VENDOR = fileURLToPath(
  new URL('../../media-src/vendor/lute/', import.meta.url),
)
const read = (f: string) => readFileSync(VENDOR + f)
const source = JSON.parse(read('source.json').toString())

describe('vendored Lute pin', () => {
  it('records a full 40-char commit SHA and a Go toolchain version', () => {
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(source.repo).toBe('88250/lute')
    expect(source.goVersion).toMatch(/^go\d+\./)
  })

  it('lute.min.js matches the sha256 recorded in source.json', () => {
    const got = createHash('sha256').update(read('lute.min.js')).digest('hex')
    expect(got).toBe(source.sha256)
  })

  it('lute.min.js.map matches the mapSha256 recorded in source.json', () => {
    const got = createHash('sha256')
      .update(read('lute.min.js.map'))
      .digest('hex')
    expect(got).toBe(source.mapSha256)
  })

  it('is a GopherJS bundle that exposes the Lute global', () => {
    const js = read('lute.min.js').toString()
    expect(js).toContain('$goVersion')
    expect(js).toContain('Lute')
  })
})

describe('Lute license compliance (Mulan PSL v2 §4)', () => {
  it('ships the license text', () => {
    const license = read('LICENSE').toString()
    expect(license).toMatch(/Mulan Permissive Software License|木兰宽松许可证/)
  })

  it('ships an attribution NOTICE naming the copyright holder and source commit', () => {
    const notice = read('NOTICE').toString()
    expect(notice).toContain('b3log.org')
    expect(notice).toContain(source.commit)
    expect(source.license).toBe('Mulan PSL v2')
  })

  it('build output (if present) carries the notices next to the binary', () => {
    // After `node build.mjs`, syncLute copies these into the shipped media/ tree.
    const shipped = fileURLToPath(
      new URL('../../media/vditor/dist/js/lute/', import.meta.url),
    )
    if (!existsSync(shipped + 'lute.min.js')) return // pre-build: nothing to check
    expect(existsSync(shipped + 'lute.LICENSE')).toBe(true)
    expect(existsSync(shipped + 'lute.NOTICE')).toBe(true)
    const got = createHash('sha256')
      .update(readFileSync(shipped + 'lute.min.js'))
      .digest('hex')
    expect(got).toBe(source.sha256)
  })
})
