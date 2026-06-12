import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Coverage cache lifecycle (no-op unless E2E_COVERAGE is set).
  globalSetup: './e2e/coverage-setup.ts',
  globalTeardown: './e2e/coverage-teardown.ts',
  // Golden screenshots (visual.spec.ts), element-scoped. Tuned empirically: a clean
  // re-render diffs ~0 px, while a deliberate 3 px border change diffs ~1000 px
  // (≈1.6%) — so 0.5% catches any ≳3 px layout shift yet leaves headroom for
  // anti-aliasing. Playwright's per-pixel `threshold` (0.2 default) already discards
  // sub-20%-colour AA noise, so matched-glyph cross-machine drift (local WSL Ubuntu
  // vs the ubuntu-latest CI runner — same pinned chromium + linux fonts) stays well
  // under this. Goldens carry a `-linux` platform suffix, so both share one baseline.
  // Regenerate ONLY after a DELIBERATE visual change:
  //   npx playwright test visual.spec.ts --update-snapshots
  // (verify the new PNGs by eye) — never to silence an unexplained diff; the diff
  // image in test-results/ shows WHERE it moved.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  use: { baseURL: 'http://localhost:9123' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:9123',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
