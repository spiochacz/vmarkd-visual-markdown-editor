/**
 * Playwright globalSetup — clears any stale coverage cache before a run.
 * No-op unless E2E_COVERAGE is set.
 */
import { CoverageReport } from 'monocart-coverage-reports'
import coverageOptions from './coverage-options'

export default async function globalSetup() {
  if (!process.env.E2E_COVERAGE) return
  await new CoverageReport(coverageOptions).cleanCache()
}
