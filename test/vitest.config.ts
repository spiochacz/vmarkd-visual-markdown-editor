import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '..')

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      // The backend imports the real `vscode` module, which only exists inside
      // the Extension Host. Point it at our in-memory mock for unit tests.
      vscode: resolve(here, 'backend/vscode-mock.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'test/backend/**/*.test.ts',
      // Migrated webview unit tests (pure logic — no DOM needed).
      'media-src/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(repoRoot, 'coverage'),
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'media-src/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        // Entry points / wiring that need the real Extension Host or DOM.
        'media-src/src/main.ts',
        'media-src/src/preload.ts',
        'media-src/src/types.ts',
      ],
      // NON-REGRESSION floor, not an aspiration (task 150 item 3). Baseline at
      // introduction was ~59/55/57/60 (stmts/branch/funcs/lines); these sit a few
      // points below so a real coverage DROP fails `npm run test:coverage` (run in
      // CI) while normal fluctuation doesn't. RAISE them as coverage grows; never
      // lower to make a red build green — add tests instead.
      thresholds: {
        statements: 56,
        branches: 51,
        functions: 54,
        lines: 56,
      },
    },
  },
})
