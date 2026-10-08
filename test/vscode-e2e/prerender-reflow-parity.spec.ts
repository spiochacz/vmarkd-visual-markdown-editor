// Task 83 (increment 5) — open parity for vmarkd.editor.reflowLineBreaks. The instant-paint
// overlay (host-rendered, painted before any script) must lay out exactly like the live editor
// that replaces it: with reflow on, soft-wrapped paragraphs are ONE line with a marker per source
// newline in BOTH, so no block moves, changes height or loses a line at the swap. WYSIWYG only — the IR
// open is a cell of the parity gate (parity-matrix.spec.ts). Same hold hook as
// parity-matrix.spec.ts (VMARKD_PRERENDER_PARITY_HOLD keeps the overlay for the compare).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { applySettings, useSettingsRestore } from './settings-helpers'
import { openInMode, wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'prerender-reflow-parity.md')

useSettingsRestore(test, [
  'vmarkd.editor.defaultMode',
  'vmarkd.editor.reflowLineBreaks',
  'vmarkd.theme.content',
])

test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  // `delete`, NOT `= undefined` (see parity-matrix.spec.ts)
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})

test.afterEach(async ({ evaluateInVSCode }) => {
  await evaluateInVSCode(async (vscode) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})

interface Block {
  tag: string
  top: number
  height: number
  markers: number
}

// Per top-level block: its box (top relative to the root, height) and its marker count. A moved block
// or a changed height is exactly the open-time jump; the markers say the glyphs are there too.
function readBlocks(
  frame: ReturnType<typeof wf>,
  rootSelector: string,
): Promise<Block[]> {
  return frame.locator('body').evaluate((_body, sel) => {
    const root = document.querySelector(sel)
    if (!root) throw new Error(`missing parity root: ${sel}`)
    const r2 = (n: number) => Math.round(n * 100) / 100
    const base = root.getBoundingClientRect().top
    return Array.from(root.children).map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        tag: el.tagName.toLowerCase(),
        top: r2(rect.top - base),
        height: r2(rect.height),
        markers: el.querySelectorAll('.vmarkd-softbreak').length,
      }
    })
  }, rootSelector)
}

// IR is covered by the cross-stage gate (parity-matrix.spec.ts, `overlay>ir`, the reflow-ON configuration:
// block heights, gaps, and the marker count compared exactly). The gate only opens in IR, so the
// WYSIWYG open stays here.
for (const mode of ['wysiwyg'] as const) {
  for (const reflow of [true, false]) {
    test(`overlay and live ${mode} editor lay out identically at open (reflow ${reflow ? 'on' : 'off'})`, async ({
      workbox,
      evaluateInVSCode,
    }) => {
      test.setTimeout(180_000)
      await applySettings(evaluateInVSCode, {
        'vmarkd.editor.reflowLineBreaks': reflow,
        'vmarkd.theme.content': 'auto',
      })
      await openInMode(evaluateInVSCode, FIXTURE, mode)
      const frame = wf(workbox)
      await frame.locator('#vmarkd-prerender').waitFor({ timeout: 45_000 })
      const before = await readBlocks(frame, '#vmarkd-prerender .vditor-reset')
      await expect
        .poll(() =>
          frame
            .locator('body')
            .evaluate(
              () =>
                typeof (window as { __vmarkdReleasePrerender?: unknown })
                  .__vmarkdReleasePrerender,
            ),
        )
        .toBe('function')
      await frame.locator('body').evaluate(() => {
        ;(
          window as unknown as { __vmarkdReleasePrerender: () => void }
        ).__vmarkdReleasePrerender()
      })
      await frame
        .locator('#vmarkd-prerender')
        .waitFor({ state: 'detached', timeout: 45_000 })
      // The editor decorates its first screen before paint; give the idle chunks a beat anyway.
      await frame
        .locator('body')
        .evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        )
      const after = await readBlocks(frame, `.vditor-${mode} .vditor-reset`)
      // eslint-disable-next-line no-console
      console.log(
        `[reflow-parity ${mode} ${reflow}] before=${JSON.stringify(before)}\n[reflow-parity] after=${JSON.stringify(after)}`,
      )
      expect(before.length).toBeGreaterThan(4)
      expect(after).toEqual(before)
      if (reflow) expect(before.some((b) => b.markers > 0)).toBe(true)
    })
  }
}
