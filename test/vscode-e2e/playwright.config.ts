import path from 'node:path'
import { defineConfig } from '@playwright/test'
import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from 'vscode-test-playwright'

// "real-vscode" suite — launches an actual VS Code (downloaded to .vscode-test/) with the
// built vMarkd extension loaded, opens a fixture in the vmarkd.editor custom editor, and
// measures/screenshots the REAL webview (VS Code injects its own default CSS + runs the
// real custom-editor pipeline). This closes the harness↔real gap for the "repro only in the
// real editor" bug class. SLOW + heavy (downloads VS Code) — opt-in, NOT in the CI gate;
// run with `npm run test:vscode`. Requires a prior `node build.mjs` (out/ + media/dist/).
//
// Geometry/computed-style assertions only here — NO golden screenshots: linux-electron font
// rendering differs from the harness, and this runs ad hoc, so pixel baselines aren't stable.
const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: __dirname,
  // VS Code single-instances; never parallelise within a worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Cold VS Code boot + webview render under WSLg/CI is occasionally slow and racy; this is an
  // opt-in PARITY smoke (the harness specs are the real guard), so retry transient boot stalls
  // rather than fail the ad-hoc run.
  retries: 2,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    extensionDevelopmentPath: repoRoot,
    // A recent stable VS Code (extension engines require ^1.110.0).
    vscodeVersion: 'stable',
  },
})
