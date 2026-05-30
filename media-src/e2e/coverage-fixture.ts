/**
 * Playwright test wrapper that (opt-in) records V8 JS coverage per test.
 *
 * Enabled only when E2E_COVERAGE is set, so the default `test:e2e` run is
 * behaviourally identical to before (no coverage overhead). Specs import
 * `test`/`expect` from here instead of `@playwright/test`.
 */
import { test as base, expect } from '@playwright/test'
import { CoverageReport } from 'monocart-coverage-reports'
import coverageOptions from './coverage-options'

const COVERAGE_ENABLED = !!process.env.E2E_COVERAGE

export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page, browserName }, use) => {
      // page.coverage is Chromium-only.
      const active = COVERAGE_ENABLED && browserName === 'chromium'
      if (active) {
        await page.coverage.startJSCoverage({ resetOnNavigation: false })
      }

      await use()

      if (active) {
        const coverage = await page.coverage.stopJSCoverage()
        // Persists to the shared on-disk cache; generated in global teardown.
        await new CoverageReport(coverageOptions).add(coverage)
      }
    },
    { auto: true },
  ],
})

export { expect }
