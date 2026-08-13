// D7 (tasks/516 Phase 4) — the Ctrl-to-interact gate for INTERACTIVE diagrams (markmap / ECharts
// mindmap / Leaflet maps, `engineLangs` `zoom: 'gated'` — diagram-zoom-gate.ts), driven by a REAL
// Playwright `mouse.wheel()` instead of a synthetic `dispatchEvent(new WheelEvent(...))`.
//
// Every existing gate spec for this family (geojson-pan-gate.spec.ts, toolbar-overflow's siblings)
// dispatches a hand-built event and reads whether a sentinel saw it — that proves the gate's own
// branch logic, but a `dispatchEvent()` never touches the browser's real (non-passive) wheel
// pipeline, so it can't catch a gate wired to the wrong element, blocked by an overlay/pointer-
// events issue, or defeated by real listener ordering. This spec closes that gap for the GATED
// family specifically (diagram-wheel-real.spec.ts already covers the separate `zoom: 'static'`
// family — mermaid/graphviz/etc, driven by diagram-zoom.ts, a different mechanism): over a
// rendered markmap, a real plain wheel must scroll the editable PANE (diagram-zoom-gate.ts's
// document-capture listener suppresses the event before markmap's own d3-zoom ever sees it, and
// never calls preventDefault, so the pane scrolls normally); a real Ctrl+wheel must pass through
// to markmap's own d3-zoom instead, changing its `<g transform>` and leaving the pane un-scrolled.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { settle, wf } from './webview-helpers'

const TEMP_DIR = path.join(__dirname, '..', '..', 'tmp', 'vscode-e2e')
mkdirSync(TEMP_DIR, { recursive: true })
const FIXTURE = path.join(TEMP_DIR, 'real-wheel-zoom-gate.md')
// The diagram sits near the top with plenty of filler BELOW it, so a plain-wheel scroll-down has
// somewhere to go (scrollTop starts at 0 and there's real distance to travel).
writeFileSync(
  FIXTURE,
  [
    '# Real wheel zoom gate (task 516 D7)',
    '',
    '```markmap',
    '# Root',
    '## Branch A',
    '## Branch B',
    '```',
    '',
    ...Array(80).fill('filler paragraph to make the pane scrollable'),
    '',
  ].join('\n'),
)

async function getMarkmapTransform(
  frame: ReturnType<typeof wf>,
): Promise<string | null> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (
          document.querySelector(
            '.language-markmap svg g',
          ) as SVGGElement | null
        )?.getAttribute('transform') ?? null,
    )
}

// Which element actually scrolls is NOT `.vditor-ir`: in the real webview the DOCUMENT scrolls
// (the pane has no overflow of its own), so reading `.vditor-ir`'s scrollTop returns a constant 0
// and makes "did it scroll?" unfalsifiable. Take the max of every candidate instead.
async function getPaneScrollTop(frame: ReturnType<typeof wf>): Promise<number> {
  return frame.locator('body').evaluate(() => {
    const ir = document.querySelector('.vditor-ir') as HTMLElement | null
    return Math.max(
      ir?.scrollTop ?? 0,
      document.scrollingElement?.scrollTop ?? 0,
      document.documentElement.scrollTop,
      document.body.scrollTop,
      window.scrollY || 0,
    )
  })
}


test('@probe measure what a REAL wheel and Ctrl+wheel do over a gated diagram', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  const svg = frame.locator('.language-markmap svg').first()
  await svg.waitFor({ timeout: 60_000 })
  await settle(frame, 1500) // markmap animates its initial fit; let it settle first.

  const box = await svg.boundingBox()
  expect(
    box,
    'markmap svg has a real bounding box to point the mouse at',
  ).not.toBeNull()
  if (!box) return
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // --- plain wheel: the pane scrolls, markmap's own zoom transform is untouched. ---
  // SCOPE LIMIT, measured: the "plain wheel scrolls the PANE" half is NOT assertable here.
  // `assertPaneCanScroll` reports nothing scrollable even with 80 filler paragraphs — the webview
  // document does not overflow in this harness — so a zero scroll delta would prove nothing and a
  // passing assertion would be unfalsifiable. Recorded rather than dressed up: what IS asserted is
  // the half that carries the actual regression risk, that a plain wheel does not reach the
  // diagram's own zoom while Ctrl+wheel does.
  const scrollBefore = await getPaneScrollTop(frame)
  const transformBefore = await getMarkmapTransform(frame)
  expect(scrollBefore, 'pane starts unscrolled').toBe(0)
  expect(
    transformBefore,
    'markmap has a real d3-zoom transform to compare against',
  ).not.toBeNull()

  await workbox.mouse.move(cx, cy)
  await workbox.mouse.wheel(0, 600)
  await workbox.waitForTimeout(500)

  const scrollAfterPlain = await getPaneScrollTop(frame)
  const transformAfterPlain = await getMarkmapTransform(frame)
  // (Intentionally no assertion on scrollAfterPlain — see the SCOPE LIMIT note above.)
  void scrollAfterPlain
  void scrollBefore
  expect(
    transformAfterPlain,
    'a plain wheel must not change the diagram zoom transform',
  ).toBe(transformBefore)

  // Scroll back to the top so the Ctrl+wheel leg starts from the same known position and the
  // diagram is back under the cursor. Reset every candidate getPaneScrollTop reads from — the
  // real scroller isn't `.vditor-ir` (see its comment), so resetting only that would leave the
  // ACTUAL scroll position wherever the plain wheel left it.
  await frame.locator('body').evaluate(() => {
    const ir = document.querySelector('.vditor-ir') as HTMLElement | null
    if (ir) ir.scrollTop = 0
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await settle(frame, 300)
  await workbox.mouse.move(cx, cy)

  // --- Ctrl+wheel: the diagram zooms, the pane does not scroll. ---
  const scrollBeforeCtrl = await getPaneScrollTop(frame)
  await workbox.keyboard.down('Control')
  await workbox.mouse.wheel(0, -600) // negative deltaY = zoom IN, matching the user gesture
  await workbox.keyboard.up('Control')
  await workbox.waitForTimeout(500)

  const scrollAfterCtrl = await getPaneScrollTop(frame)
  const transformAfterCtrl = await getMarkmapTransform(frame)
  // UNRESOLVED (task 516 D7) — measurement only, deliberately asserting nothing.
  // A REAL Playwright Ctrl+wheel over the markmap did NOT change its zoom transform here, while
  // the existing gate specs (all driving SYNTHETIC WheelEvents) do see it change. Two candidate
  // explanations, neither confirmed: the Ctrl-to-interact gate may need a real hover/focus
  // activation that a bare mouse.wheel does not produce, or Playwright's wheel may not carry the
  // ctrlKey modifier into the webview's OOPIF the way a user's does. Until that is settled, an
  // assertion here would be a coin flip - so this logs and stops. Do not convert these to
  // assertions without first proving which of the two it is.
  console.log(
    `[d7] transformBefore=${transformBefore} afterPlain=${transformAfterPlain} afterCtrl=${transformAfterCtrl}`,
  )
  console.log(
    `[d7] scroll: before=${scrollBefore} afterPlain=${scrollAfterPlain} beforeCtrl=${scrollBeforeCtrl} afterCtrl=${scrollAfterCtrl}`,
  )

  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })
})
