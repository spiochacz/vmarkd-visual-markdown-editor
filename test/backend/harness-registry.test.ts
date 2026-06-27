import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import coverageOptions from '../../media-src/e2e/coverage-options'
import {
  COVERAGE_KEYS,
  HARNESS_ENTRIES,
} from '../../media-src/e2e/harness-entries.mjs'

// Meta-test for the e2e harness registry (task 150 item 2). serve.mjs (esbuild
// entryPoints + HTML routes) and coverage-options.ts (entryFilter) all derive from
// harness-entries.mjs; these assertions lock that against re-introducing the drift
// that silently dropped 9 bundles (incl. custom-diagrams) from coverage.
const e2eDir = fileURLToPath(new URL('../../media-src/e2e/', import.meta.url))

describe('e2e harness registry', () => {
  it('matches every coverage-counted bundle with the coverage entryFilter', () => {
    for (const key of COVERAGE_KEYS) {
      expect(
        coverageOptions.entryFilter({ url: `/${key}.js` }),
        `coverage allowlist must include /${key}.js`,
      ).toBe(true)
    }
  })

  it('excludes the perf-only bench bundle from coverage', () => {
    expect(COVERAGE_KEYS).not.toContain('bench')
    expect(coverageOptions.entryFilter({ url: '/bench.js' })).toBe(false)
  })

  it('counts the custom-diagrams harness (the specific bundle this task un-dropped)', () => {
    expect(
      coverageOptions.entryFilter({ url: '/custom-diagrams-harness.js' }),
    ).toBe(true)
  })

  it('has the ts entry + html page on disk for every registered harness', () => {
    for (const e of HARNESS_ENTRIES) {
      expect(existsSync(path.join(e2eDir, e.ts)), `missing ${e.ts}`).toBe(true)
      expect(existsSync(path.join(e2eDir, e.html)), `missing ${e.html}`).toBe(
        true,
      )
    }
  })

  it('drops non-harness scripts (e.g. vendored lute) from coverage', () => {
    expect(
      coverageOptions.entryFilter({ url: '/vditor/dist/js/lute/lute.min.js' }),
    ).toBe(false)
  })
})
