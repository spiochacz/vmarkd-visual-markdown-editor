import { wf } from './webview-helpers'
// Task 164 §1/§2 — a theme flip must SKIP the mermaid/echarts re-render when the resolved theme is
// mode-INDEPENDENT (an explicit/paired palette yields a byte-identical SVG across dark↔light). The
// re-render (mermaid full dagre relayout; echarts dispose+reinit of every chart) is pure waste then.
//
// This is the flip-matrix's blind spot: retheme-flip-matrix.spec.ts flips a content=auto doc, where
// the resolved theme DOES change with the mode, so it always re-renders. Here we pin an explicit
// engine theme so the resolved init/spec is constant, and prove the render node is left untouched.
//
// Detector = a marker attribute on the live render node. It's validated in-test: the FIRST flip has
// no stored signature so it always re-renders → replaces the node → the marker is LOST (proving the
// marker is a sensitive detector), then the SECOND flip (same signature) must SKIP → the marker
// SURVIVES.
//
// Both targets must be scrolled into view before either flip (task 480 fix — this spec predates task
// 412's viewport gate, which postdates it and defers a re-render for any diagram outside the
// viewport regardless of the signature). all-renderers.md has grown considerably since this spec was
// written (more renderer sections added above §3/§4), so at the harness's default window size BOTH
// the mermaid and echarts targets now sit below the fold — deferred, not "skipped because the
// signature matched", which defeats the CONTROL assertion (the offscreen diagram never gets a first
// unconditional render, so its marker is never lost) and would have silently passed THE ASSERTION for
// the wrong reason too. Scrolling both into view removes the confound so this test isolates the
// content-based skip (task 164) it exists to prove, independent of the (separately covered)
// visibility-based one.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

test('mermaid + echarts SKIP re-render on a mode-independent flip (task 164 §1/§2)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)

  // Explicit engine themes → resolveMermaidInit/resolveEchartsTheme ignore the mode, so a dark↔light
  // flip resolves to the SAME init/spec. Start from a known dark theme so the first flip is a real
  // change. Set before opening so the initial render happens in dark with no stored signature yet.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await cfg.update(
        'diagram.mermaid.theme',
        'dracula',
        vscode.ConfigurationTarget.Global,
      )
      await cfg.update(
        'diagram.echarts.theme',
        'dark',
        vscode.ConfigurationTarget.Global,
      )
      await vscode.workspace
        .getConfiguration('workbench')
        .update(
          'colorTheme',
          'Default Dark Modern',
          vscode.ConfigurationTarget.Global,
        )
      // …and `theme.content` MUST be 'auto', or the control below is not a control at all. The
      // first flip is only "a real change" if flipping the workbench theme also moves the CONTENT
      // theme; with an explicit content theme pinned, a dark→light workbench flip changes nothing
      // the renderers care about, nothing re-renders, the marker survives, and the control fails
      // with "first flip re-renders mermaid (marker lost → detector is sensitive)".
      //
      // This is not hypothetical: `echarts-theme.spec.ts` sets `theme.content` four times and never
      // resets it, and it runs immediately before this spec in the suite's own order. Reproduced
      // deterministically — `echarts-theme.spec.ts flip-skip.spec.ts` in one command fails on the
      // first attempt, and this spec passes 20/20 alone. (General hygiene problem: task 524.)
      await cfg.update(
        'theme.content',
        'auto',
        vscode.ConfigurationTarget.Global,
      )
    },
    [] as [],
  )

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
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('.language-echarts canvas')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame.locator('.language-mermaid').first().scrollIntoViewIfNeeded()
  await frame.locator('.language-echarts').first().scrollIntoViewIfNeeded()
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const setTheme = async (name: string) => {
    await evaluateInVSCode(
      async (vscode: typeof import('vscode'), args: string[]) => {
        await vscode.workspace
          .getConfiguration('workbench')
          .update('colorTheme', args[0], vscode.ConfigurationTarget.Global)
      },
      [name] as [string],
    )
    // rAF + foreground poll (~2s) + any engine re-render.
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 4000)))
  }

  // Tag the live mermaid <svg> + echarts <canvas>; a re-render REPLACES those nodes → tag lost.
  const mark = (tag: string) =>
    frame.locator('body').evaluate((_b, t) => {
      const svg = document.querySelector('.language-mermaid svg')
      const canvas = document.querySelector('.language-echarts canvas')
      if (svg) svg.setAttribute(t, '1')
      if (canvas) canvas.setAttribute(t, '1')
      return { svg: !!svg, canvas: !!canvas }
    }, tag)
  const survives = (tag: string) =>
    frame.locator('body').evaluate(
      (_b, t) => ({
        svg: !!document.querySelector(`.language-mermaid svg[${t}]`),
        canvas: !!document.querySelector(`.language-echarts canvas[${t}]`),
      }),
      tag,
    )

  // CONTROL — the first flip has no stored signature, so it re-renders unconditionally. The marker is
  // lost, proving it's a sensitive detector (a re-render really does replace the node).
  const marked0 = await mark('data-t164a')
  expect(
    marked0.svg && marked0.canvas,
    'both engines rendered before flip',
  ).toBe(true)
  await setTheme('Default Light Modern')
  const afterFirst = await survives('data-t164a')
  expect(
    afterFirst.svg,
    'first flip re-renders mermaid (marker lost → detector is sensitive)',
  ).toBe(false)
  expect(
    afterFirst.canvas,
    'first flip re-renders echarts (marker lost → detector is sensitive)',
  ).toBe(false)

  // THE ASSERTION — the signature is now stored. Flipping to the OTHER mode resolves to the SAME
  // init/spec (dracula / explicit dark are mode-independent) → the re-render is skipped → the freshly
  // tagged nodes survive untouched.
  await mark('data-t164b')
  await setTheme('Default Dark Modern')
  const afterSecond = await survives('data-t164b')
  expect(
    afterSecond.svg,
    'mermaid re-render SKIPPED on the mode-independent flip (marker survives)',
  ).toBe(true)
  expect(
    afterSecond.canvas,
    'echarts re-render SKIPPED on the mode-independent flip (marker survives)',
  ).toBe(true)

  // Restore global config so we don't leak settings into other specs.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const cfg = vscode.workspace.getConfiguration('vmarkd')
      await cfg.update(
        'diagram.mermaid.theme',
        undefined,
        vscode.ConfigurationTarget.Global,
      )
      await cfg.update(
        'diagram.echarts.theme',
        undefined,
        vscode.ConfigurationTarget.Global,
      )
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', undefined, vscode.ConfigurationTarget.Global)
    },
    [] as [],
  )
})
