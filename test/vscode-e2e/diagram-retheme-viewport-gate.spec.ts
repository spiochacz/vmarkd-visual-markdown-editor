import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// Task 412 — generalizes task 166's mermaid-only viewport gate (mermaid-flip-gate.spec.ts) to the
// OTHER retheme paths: the mono SVG group (plantuml/graphviz/abc/wavedrom/nomnoml) and D2. On a doc
// with several plantuml/D2 blocks below the fold, a theme flip used to re-render EVERY one
// unconditionally — plantuml/D2 are the MOST expensive engines a flip can trigger (plantuml ~2.2s/
// render on a stdlib-heavy doc, D2 ~365ms/compile — tasks 349/352/436), worse than the dagre
// relayout task 166 already fixed. Now only the visible block(s) redraw immediately; the rest defer
// to individual scroll-in, through the SAME shared observer diagramGate (diagram-retheme.ts).
//
// Measured via the counters diagram-retheme.ts already exposes on `window` for exactly this purpose
// (not wall-clock timing, which is noisy under xvfb): `__vmarkdPumlRethemeStats.panesReRendered`
// (task 436) and `__vmarkdD2RenderStats.compiles` (task 411) — "how many expensive engine renders
// did one flip cause". The fixture has 4 plantuml blocks and 3 D2 blocks; only the FIRST plantuml
// (section 0) sits in the initial viewport, so a gated flip must redraw far fewer than the total —
// and scrolling through the rest must eventually redraw every one of them (no regression: every
// engine covered by this task still re-themes correctly once visible).
const FIXTURE = path.join(
  __dirname,
  'fixtures',
  'diagram-retheme-viewport-gate.md',
)
const PLANTUML_BLOCKS = 4
const D2_BLOCKS = 3

// `theme.content` is set once up front and never touched again → pinned. `workbench.colorTheme` is
// flipped twice mid-test (that flip is the behaviour under test) → restore-only, kept inline.
usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })
useSettingsRestore(test, ['workbench.colorTheme'])

test('theme flip re-renders only visible plantuml/D2; offscreen defer + render on scroll-in (task 412)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
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
  // Known starting theme so the flip below is a genuine light->dark change.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Light Modern',
        vscode.ConfigurationTarget.Global,
      )
  })

  // Every block must have finished its FIRST render before the baseline, or a still-rendering block
  // reads as gated/deferred for the wrong reason. Poll (plantuml/D2 cold engine load varies).
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-plantuml svg').count(),
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toBeGreaterThanOrEqual(PLANTUML_BLOCKS)
  await expect
    .poll(() => frame.locator('.vditor-ir__preview .language-d2 svg').count(), {
      timeout: 60_000,
      intervals: [1000, 2000, 3000],
    })
    .toBeGreaterThanOrEqual(D2_BLOCKS)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 500)))

  // Per-element colour signature (fill/stroke of every descendant) — the DIRECT, per-block proof
  // that a re-theme actually landed, independent of the aggregate counters below (which are
  // CUMULATIVE across every flip this spec triggers, including the light-mode one right above, so
  // they're the right tool for the GATING assertions — "fewer redraws than total blocks" — but a
  // noisier one for "did EVERY block end up correctly dark-themed").
  const colourSignature = () =>
    frame.locator('body').evaluate(() => {
      const sig = (sel: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) => {
          let s = ''
          for (const n of el.querySelectorAll('[fill],[stroke]'))
            s += `${n.getAttribute('fill') ?? ''}${n.getAttribute('stroke') ?? ''};`
          return s
        })
      return {
        puml: sig('.vditor-ir__preview .language-plantuml'),
        d2: sig('.vditor-ir__preview .language-d2'),
      }
    })
  const lightColours = await colourSignature()

  const stats = () =>
    frame.locator('body').evaluate(() => {
      const w = window as unknown as {
        __vmarkdPumlRethemeStats?: { calls: number; panesReRendered: number }
        __vmarkdD2RenderStats?: { compiles: number }
      }
      return {
        puml: w.__vmarkdPumlRethemeStats?.panesReRendered ?? -1,
        d2: w.__vmarkdD2RenderStats?.compiles ?? -1,
      }
    })

  const before = await stats()
  expect(
    before.puml,
    'plantuml stats counter is exposed',
  ).toBeGreaterThanOrEqual(0)
  expect(before.d2, 'D2 stats counter is exposed').toBeGreaterThanOrEqual(0)

  // Genuine light -> dark flip.
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Dark Modern',
        vscode.ConfigurationTarget.Global,
      )
  })
  // reThemeMono: foreground poll + 250ms settle (up to ~2s). reThemeGeoAndD2: deferred 400ms. Give
  // both a generous margin under load, then poll for the counters to stop moving rather than betting
  // on one fixed sleep — a slow settle under full-suite load is the known false-flake shape here.
  await expect
    .poll(async () => (await stats()).puml, {
      timeout: 15_000,
      intervals: [500, 1000, 1500],
    })
    .toBeGreaterThan(before.puml)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000))) // let the rest of the immediate batch settle
  const afterFlip = await stats()

  // eslint-disable-next-line no-console
  console.log(
    `[412] before=${JSON.stringify(before)} afterFlip=${JSON.stringify(afterFlip)} plantumlBlocks=${PLANTUML_BLOCKS} d2Blocks=${D2_BLOCKS}`,
  )

  // GATING: the flip must NOT have redrawn every plantuml/D2 block immediately — only section 0's
  // plantuml sits in the initial viewport, and no D2 block does (they're all below section 0).
  const pumlDelta = afterFlip.puml - before.puml
  const d2Delta = afterFlip.d2 - before.d2
  expect(
    pumlDelta,
    'at least the visible plantuml block re-rendered',
  ).toBeGreaterThanOrEqual(1)
  expect(
    pumlDelta,
    'NOT every plantuml block re-rendered immediately (viewport-gated)',
  ).toBeLessThan(PLANTUML_BLOCKS)
  expect(
    d2Delta,
    'no D2 block was visible at flip time, so none re-rendered immediately (viewport-gated)',
  ).toBeLessThan(D2_BLOCKS)

  // NO REGRESSION: visit every plantuml/D2 block individually (scrollIntoView, one at a time, like
  // mermaid-flip-gate.spec.ts's own scroll-in check — a single big window.scrollBy/scrollTo jump does
  // NOT reliably cross every intermediate element's viewport-margin threshold, only the final resting
  // position's neighbourhood, so a naive "scroll to the bottom" under-visits the middle sections) and
  // confirm every one EVENTUALLY re-renders under the current (dark) theme — the gate defers, it must
  // never permanently skip.
  await frame.locator('body').evaluate(async () => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.vditor-ir__preview .language-plantuml, .vditor-ir__preview .language-d2',
      ),
    )
    for (const n of nodes) {
      n.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 600))
    }
  })
  // Let the last scroll-in's redraw actually land (mono foreground poll can take up to ~2s).
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2500)))

  const darkColours = await colourSignature()
  const finalStats = await stats()

  // eslint-disable-next-line no-console
  console.log(
    `[412] afterScroll=${JSON.stringify(finalStats)} lightColours=${JSON.stringify(
      lightColours,
    )} darkColours=${JSON.stringify(darkColours)}`,
  )

  // Every plantuml/D2 block's colour signature must have CHANGED from its light-mode snapshot —
  // direct, per-block proof every one is now correctly dark-themed, not just the one(s) visible at
  // flip time. (A cumulative event-count assertion here would be noisier: the counters also include
  // the earlier light-mode establishment flip, so "reached >= N events" doesn't cleanly mean "every
  // block is NOW dark" — colour is the ground truth.)
  expect(
    lightColours.puml.length,
    'fixture has the expected plantuml block count',
  ).toBe(PLANTUML_BLOCKS)
  expect(
    lightColours.d2.length,
    'fixture has the expected D2 block count',
  ).toBe(D2_BLOCKS)
  expect(darkColours.puml.length).toBe(PLANTUML_BLOCKS)
  expect(darkColours.d2.length).toBe(D2_BLOCKS)
  for (let i = 0; i < PLANTUML_BLOCKS; i++) {
    expect(darkColours.puml[i], `plantuml block ${i} re-themed`).not.toBe(
      lightColours.puml[i],
    )
  }
  for (let i = 0; i < D2_BLOCKS; i++) {
    expect(darkColours.d2[i], `D2 block ${i} re-themed`).not.toBe(
      lightColours.d2[i],
    )
  }
})
