// Guards the vendored-asset license-compliance invariant (tasks/149): every library whose bytes we
// ship under media/ must also ship its license text. The build copies licenses via the single
// syncVendored() engine driven by VENDORED_ASSETS; this test enforces the source-of-truth side so the
// omission (d2 MPL-2.0 + elk EPL-2.0 + 10 others shipped with no license before task 149) can't recur.
// Build-independent: it validates media-src/vendor/ + the table, not the built media/ tree.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VENDORED_ASSETS } from '../../media-src/vendor/vendored-assets.mjs'

const vendorDir = (dir: string) =>
  fileURLToPath(new URL(`../../media-src/vendor/${dir}`, import.meta.url))
const vendorFile = (dir: string, file: string) =>
  fileURLToPath(
    new URL(`../../media-src/vendor/${dir}/${file}`, import.meta.url),
  )

describe('vendored-asset license compliance (task 149)', () => {
  it.each(
    VENDORED_ASSETS.map((e) => [e.dir, e] as const),
  )('%s declares at least one license file', (_dir, entry) => {
    expect(entry.license?.length ?? 0).toBeGreaterThan(0)
  })

  it.each(
    VENDORED_ASSETS.flatMap((e) =>
      (e.license ?? []).map((f) => [e.dir, f] as const),
    ),
  )('%s ships license file %s (exists in the vendor dir)', (dir, file) => {
    expect(existsSync(vendorFile(dir, file))).toBe(true)
  })

  it.each(
    VENDORED_ASSETS.flatMap((e) =>
      e.copy.map(([src]) => [e.dir, src] as const),
    ),
  )('%s copy source %s exists in the vendor dir', (dir, src) => {
    expect(existsSync(vendorFile(dir, src))).toBe(true)
  })

  // No vendor dir with a source.json may be silently un-synced (the accretion that hid the license
  // gap): every pinned vendor must appear in the table.
  it('VENDORED_ASSETS covers every pinned vendor dir', () => {
    const root = fileURLToPath(
      new URL('../../media-src/vendor', import.meta.url),
    )
    const pinned = readdirSync(root, { withFileTypes: true })
      .filter(
        (d) => d.isDirectory() && existsSync(`${root}/${d.name}/source.json`),
      )
      .map((d) => d.name)
    const tabled = new Set(VENDORED_ASSETS.map((e) => e.dir))
    const missing = pinned.filter((d) => !tabled.has(d))
    expect(missing).toEqual([])
  })

  // Explicit copyleft landmine guard: these legally REQUIRE the license to ship with the binary.
  it.each([
    ['d2', 'MPL-2.0'],
    ['elk', 'EPL-2.0'],
    ['plantuml', 'MIT (plantuml)'],
    // viz-global.js (@viz-js/viz) moved to its own dir (task 144 item 6) — shared by plantuml + graphviz.
    ['viz', 'MIT (@viz-js/viz)'],
  ])('copyleft/attribution-critical %s (%s) has a vendored license', (dir) => {
    const entry = VENDORED_ASSETS.find((e) => e.dir === dir)
    expect(entry, `no VENDORED_ASSETS entry for ${dir}`).toBeTruthy()
    expect(entry!.license!.length).toBeGreaterThan(0)
    for (const f of entry!.license!) {
      expect(existsSync(vendorFile(dir, f)), `${dir}/${f} missing`).toBe(true)
    }
    expect(existsSync(vendorDir(dir))).toBe(true)
  })
})
