import path from 'node:path'
import { test } from 'vscode-test-playwright'
import { captureStages } from '../parity/capture'
import type { ParityRun } from '../parity/compare'
import { PARITY_CONFIGS } from '../parity/configs'
import { judgeRuns } from '../parity/gate'
import { applySettings, useSettingsRestore } from './settings-helpers'
import { wf } from './webview-helpers'

// Task 532 — the cross-stage parity gate, REAL VS Code layer. One canonical fixture holding every
// element kind (generated from test/parity/elements.ts), captured in five stages — the
// instant-paint overlay (held), IR, the full Preview overlay, WYSIWYG, the split-view pane — and
// compared stage-pair by stage-pair under test/parity/policy.ts, modulo the checked-in allow-list of
// INTENDED differences (test/parity/allowed-differences.json; a stale entry fails the run). The
// chromium twin (media-src/e2e/parity.spec.ts) shares the capture sequence, comparator and
// allow-list; this layer adds what only real VS Code has — its injected CSS and the custom-editor
// pipeline.
//
// TIERS (one boot per configuration — see the cost model atop playwright.config.ts):
//   VMARKD_FAST   the routine tier runs ONE configuration: `auto` under Default Dark Modern
//                 (= vscode-dark-2026, the out-of-box and the user's setup) — one boot.
//   otherwise     the full tier runs the whole matrix (test/parity/configs.ts): every content theme
//                 + auto/Monokai + auto/High Contrast + three vscode-dark-2026 variants.
// Selecting by env keeps the tier mechanism the repo already uses (playwright.config.ts) instead of
// a second one.
//
// Env: VMARKD_PARITY_ALLOW=none judges against an EMPTY allow-list (the RED proof / baseline),
// VMARKD_PARITY_REPORT=<file> writes the verdict as JSON.
const FIXTURE = path.join(__dirname, 'fixtures', 'parity-canon.md')

const configs = process.env.VMARKD_FAST
  ? PARITY_CONFIGS.filter((c) => c.fast)
  : PARITY_CONFIGS

// Serial: the configurations fill one shared list that the LAST test judges. No retries — a failed
// worker would restart with an empty list and judge a single configuration, and on a red verdict a
// retry would re-boot the whole matrix for the same listing.
test.describe.configure({ mode: 'serial', retries: 0 })

// Every key any configuration writes, cleared after each test so nothing leaks into the next spec
// (the suite shares one profile — vmarkd-testing skill, task 524).
useSettingsRestore(test, [
  ...new Set(PARITY_CONFIGS.flatMap((c) => Object.keys(c.settings))),
])

// The overlay is ephemeral; the hold keeps it after boot so it can be snapshotted (same hook as
// prerender-style-parity.spec.ts). `delete`, never `= undefined` (that stores the string "undefined").
test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

const runs: ParityRun[] = []

// Judged ONCE, after every configuration that ran (so a red run lists every difference in every
// configuration), and in afterAll rather than in "the last test": a `-g`/`--shard` run that skips the
// last configuration must still be judged, never pass having compared nothing.
test.afterAll(() => {
  if (!runs.length) return
  const result = judgeRuns(runs, 'vscode')
  console.log(result.report)
  if (!result.ok) throw new Error(result.report)
})

configs.forEach((config) => {
  test(`parity ${config.id}`, async ({ workbox, evaluateInVSCode }) => {
    test.setTimeout(300_000)
    await applySettings(evaluateInVSCode, config.settings)
    await evaluateInVSCode(
      async (vscode, args) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame
      .locator('.vditor-ir')
      .first()
      .waitFor({ state: 'attached', timeout: 90_000 })
    const stages = await captureStages({
      evaluate: <T>(expression: string) =>
        frame.locator('body').evaluate(expression) as Promise<T>,
    })
    runs.push({ theme: config.id, stages })
  })
})
