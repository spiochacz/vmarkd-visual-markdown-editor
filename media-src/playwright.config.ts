import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:9123' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:9123',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
