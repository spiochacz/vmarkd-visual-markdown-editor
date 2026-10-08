import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'
import { captureStages } from '../../test/parity/capture'
import type { ParityRun } from '../../test/parity/compare'
import { PARITY_CONFIGS } from '../../test/parity/configs'
import { judgeRuns } from '../../test/parity/gate'
import { buildParityPage } from './parity-harness'

// Task 532 — the cross-stage parity gate, chromium layer (CI, every PR). Canonical fixture ×
// every element kind × five stages (held overlay · IR · WYSIWYG · Preview · split pane) × the
// 10-configuration matrix. The page is the host's REAL HTML around the production bundle (see
// parity-harness.ts); the real-VS-Code twin (test/vscode-e2e/parity-matrix.spec.ts) shares the capture
// sequence, the comparator, the policy and the allow-list. Needs `node build.mjs` first.
//
// One capture test per configuration (serial — they fill the shared `runs` list), then ONE verdict
// test over all of them, so a run lists every difference in every configuration rather than the first.
// A stale allow-list entry fails the verdict too (see compare.ts).
test.describe.configure({ mode: 'serial' })

const runs: ParityRun[] = []
const ORIGIN = 'http://localhost:9123'

async function open(page: Page, html: string): Promise<void> {
  // The webview talks to the host through acquireVsCodeApi; the inline init payload boots the editor
  // without a reply, so a no-op stub is enough (same as prerender.spec.ts).
  await page.addInitScript(() => {
    ;(window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi =
      () => ({
        postMessage: () => undefined,
        getState: () => undefined,
        setState: () => undefined,
      })
  })
  await page.route('**/parity.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  )
  await page.goto('/parity.html', { waitUntil: 'domcontentloaded' })
}

for (const config of PARITY_CONFIGS) {
  test(`capture ${config.id}`, async ({ page }) => {
    test.setTimeout(240_000)
    await open(page, await buildParityPage(config, ORIGIN))
    const stages = await captureStages({
      evaluate: <T>(expr: string) => page.evaluate<T>(expr),
    })
    runs.push({ theme: config.id, stages })
  })
}

test('stages agree across every configuration (modulo the allow-list)', () => {
  expect(runs.length, 'every configuration was captured').toBe(
    PARITY_CONFIGS.length,
  )
  const result = judgeRuns(runs, 'harness')
  console.log(result.report)
  expect(result.ok, result.report).toBe(true)
})
