import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`
// (task 449).
// Task 148 item 3 — the origin-check half, and the reason it has stayed open all session: getting
// the expected `e.origin` string wrong for VS Code's actual webview IPC channel would silently drop
// EVERY legitimate host→webview message, a far worse outcome than the low-risk gap an origin check
// closes. So this spec does NOT assert what `e.origin` equals — we don't know yet, and hardcoding a
// guess (e.g. a `vscode-webview://` pattern that "looks right") is exactly the mistake this task
// exists to avoid. It is a MEASUREMENT, not a feature test.
//
// What it captures, deliberately chosen to surface instability rather than sample one message and
// generalise:
//   (a) multiple distinct messages within ONE webview session,
//   (b) a freshly re-created webview for the SAME document — closing the visual editor (swap to the
//       text editor, proven safe by commands-lifecycle.spec.ts's own openTextEditor/openEditor
//       round-trip) and reopening it, which disposes the old panel/EditorSession and builds a new one,
//   (c) a second, independent panel — a different document open at the same time.
// The only thing asserted is STABILITY: every captured origin is identical, and every captured
// `e.source` shape is identical, across all three. Instability in EITHER is itself the finding — the
// honest conclusion becomes "not safely implementable here" (see tasks/148-webview-security-hardening.md),
// not a workaround. The captured values are also printed (not just asserted-and-discarded) so whoever
// reads this run's output can see the actual origin string when deciding what to do with it.
//
// Deliberately non-invasive: installs a SECOND `window.addEventListener('message', …)` inside the
// webview purely to observe. `media-src/src/message-router.ts`'s own production listener is
// completely untouched — multiple listeners on the same target for the same event type each fire
// independently (standard EventTarget semantics), so this cannot interfere with real dispatch.
//
// Trigger mechanism: flipping `vmarkd.editor.fullWidth` fires `onDidChangeConfiguration` →
// `EditorSession.installListeners`'s config listener → `panelConfig.postLiveConfig()` → a real
// `config-changed` host→webview `postMessage` — an already-shipping code path, not new instrumentation.
//
// NOT YET RUN. Written for review/queueing per the assigned process (draft while the e2e runner is
// busy; run only once explicitly cleared). Structural assumptions below (the config-flip actually
// reaches the webview as a message; swapping away and back actually disposes/recreates the panel
// rather than merely refocusing it) are believed correct from reading the source but UNVERIFIED by
// execution — flagged in the handoff report, not silently assumed.

const SRC = path.join(__dirname, 'fixtures', 'torture.md')

// vmarkd.editor.fullWidth is the trigger mechanism (flipped to fire a config-changed message) and
// already restores itself to undefined within flipFullWidthSetting — this is a safety net in case
// a run fails between the two writes.
useSettingsRestore(test, ['vmarkd.editor.fullWidth'])

type Observation = {
  origin: string
  sourceIsWindow: boolean
  sourceIsNull: boolean
  sourceType: string
  command: string | null
}

// `:visible` disambiguates once more than one custom-editor tab is open at once (phase (c)
// deliberately keeps a second panel open alongside the first) — VS Code keeps an inactive
// webview's iframe alive in the DOM (for fast tab-switching) but hides it, so only the ACTIVE
// tab's iframe is visible. Every other spec in this suite only ever has one panel open, so this
// ambiguity has never been hit before; first-run failure here (`strict mode violation: … resolved
// to 2 elements`) is what surfaced it. Frame-selection fix only — no change to the measurement.
function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview:visible')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

// Installs the diagnostic listener in the webview's own window (the same window
// installMessageRouter binds to) and resets its capture buffer.
async function installProbe(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    ;(window as any).__originProbe = []
    window.addEventListener('message', (e: MessageEvent) => {
      ;(window as any).__originProbe.push({
        origin: e.origin,
        sourceIsWindow: e.source === window,
        sourceIsNull: e.source === null,
        sourceType: e.source === null ? 'null' : typeof e.source,
        command:
          (e.data && typeof e.data === 'object' && (e.data as any).command) ||
          null,
      })
    })
  })
}

// Drains whatever the probe has captured since install (or the last drain) — call after triggering
// an action known to post at least one message.
async function drainProbe(
  frame: ReturnType<typeof wf>,
): Promise<Observation[]> {
  return frame.locator('body').evaluate(() => {
    const captured = (window as any).__originProbe || []
    ;(window as any).__originProbe = []
    return captured
  })
}

async function flipFullWidthSetting(
  evaluateInVSCode: (fn: any, args: any[]) => Promise<unknown>,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await cfg.update(
        'editor.fullWidth',
        true,
        vscode.ConfigurationTarget.Global,
      )
      await new Promise((r) => setTimeout(r, 300))
      await cfg.update(
        'editor.fullWidth',
        undefined,
        vscode.ConfigurationTarget.Global,
      )
    },
    [] as [],
  )
}

test('measures e.origin/e.source stability across messages, a webview recreate, and a second panel @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const tmp1 = path.join(tmpdir(), 'vmarkd-origin-probe-1.md')
  const tmp2 = path.join(tmpdir(), 'vmarkd-origin-probe-2.md')
  writeFileSync(tmp1, readFileSync(SRC, 'utf8'))
  writeFileSync(tmp2, readFileSync(SRC, 'utf8'))

  const openVisual = (fsPath: string) =>
    evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(args[0]),
          'vmarkd.editor',
        )
      },
      [fsPath] as [string],
    )

  const waitReady = async () => {
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 500)))
    return frame
  }

  const phases: Array<{ phase: string; messages: Observation[] }> = []

  // (a) Multiple distinct messages within ONE webview session.
  await openVisual(tmp1)
  let frame = await waitReady()
  await installProbe(frame)
  await flipFullWidthSetting(evaluateInVSCode as any)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))
  phases.push({ phase: 'session-1', messages: await drainProbe(frame) })

  // (b) A freshly re-created webview for the SAME document. Swap away to the text editor (disposes
  // this panel — see EditorSession's onDidDispose teardown) and back to the visual editor (a new
  // resolveCustomTextEditor() call, a brand-new EditorSession/webview).
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.commands.executeCommand(
        'vmarkd.openTextEditor',
        vscode.Uri.file(args[0]),
      )
    },
    [tmp1] as [string],
  )
  await new Promise((r) => setTimeout(r, 300))
  await openVisual(tmp1)
  frame = await waitReady()
  await installProbe(frame)
  await flipFullWidthSetting(evaluateInVSCode as any)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))
  phases.push({ phase: 'reopened-panel', messages: await drainProbe(frame) })

  // (c) A second, independent panel — a different document, open alongside.
  await openVisual(tmp2)
  const frame2 = await waitReady()
  await installProbe(frame2)
  await flipFullWidthSetting(evaluateInVSCode as any)
  await frame2
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))
  phases.push({ phase: 'second-panel', messages: await drainProbe(frame2) })

  // Print everything captured — the actual values are the point of this spec; don't just
  // assert-and-discard them.
  console.log('[origin-probe] captured:', JSON.stringify(phases, null, 2))

  const allMessages = phases.flatMap((p) => p.messages)
  expect(
    allMessages.length,
    'expected at least one captured message per phase — if this is 0, the trigger mechanism ' +
      '(flipping vmarkd.editor.fullWidth) did not reach the webview as a message; fix the trigger ' +
      'before drawing any conclusion about origin stability',
  ).toBeGreaterThan(0)

  const origins = new Set(allMessages.map((m) => m.origin))
  const sourceShapes = new Set(
    allMessages.map(
      (m) => `${m.sourceIsWindow}/${m.sourceIsNull}/${m.sourceType}`,
    ),
  )

  // THE measurement this whole task hinges on. If either set has more than one member, the honest
  // conclusion is "not safely implementable here" — do not average/pick-one instead.
  expect(
    origins.size,
    `expected ONE stable origin across all phases, observed ${origins.size}: ${[...origins].join(', ')}`,
  ).toBe(1)
  expect(
    sourceShapes.size,
    `expected ONE stable e.source shape across all phases, observed ${sourceShapes.size}: ${[...sourceShapes].join(', ')}`,
  ).toBe(1)
  // Sanity floor only — not a guess at the value, just that SOMETHING real came through.
  expect(typeof [...origins][0]).toBe('string')
  expect([...origins][0].length).toBeGreaterThan(0)

  rmSync(tmp1, { force: true })
  rmSync(tmp2, { force: true })
})
