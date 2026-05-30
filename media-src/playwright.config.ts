import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Coverage cache lifecycle (no-op unless E2E_COVERAGE is set).
  globalSetup: './e2e/coverage-setup.ts',
  globalTeardown: './e2e/coverage-teardown.ts',
  use: { baseURL: 'http://localhost:9123' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:9123',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
