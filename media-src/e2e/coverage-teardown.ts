/**
 * Playwright globalTeardown — consolidates the per-test coverage cache into
 * the final v8 + html report. No-op unless E2E_COVERAGE is set.
 */
import { CoverageReport } from 'monocart-coverage-reports'
import coverageOptions from './coverage-options'

export default async function globalTeardown() {
  if (!process.env.E2E_COVERAGE) return
  const results = await new CoverageReport(coverageOptions).generate()
  const pct = results?.summary?.lines?.pct
  if (pct !== undefined) {
    console.log(
      `\nE2E line coverage: ${pct}%  →  ${coverageOptions.outputDir}/index.html`,
    )
  }
}
