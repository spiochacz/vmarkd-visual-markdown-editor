import { wf } from './webview-helpers'
// REGRESSION — a live theme flip must re-render PlantUML ONCE, not twice. Real VS Code.
//
// User report: switching the theme on a PlantUML-heavy doc left the diagrams spinning "forever" and
// blank. Measured cause (tmp/all-diagrams-demo.md, 13 blocks): the reThemeMono foreground poll fired
// reRenderPlantuml TWICE per flip — once per intermediate foreground value during the content-theme
// settle (`vditor--dark` class first, then the content `<link>`). Each pass clears + re-renders every
// block, and the second pass clearing blocks MID-render thrashed the TeaVM engine (each stdlib block
// re-preprocesses its ~2000-line library): ~57s of spinner-then-blank, `calls:2 panesReRendered:26`.
// The fix debounces the poll to the SETTLED colour (diagram-retheme.ts reThemeOnForegroundChange) →
// one pass, ~5s, `calls:1 panesReRendered:<blocks>`.
//
// This asserts the contract on a small fixture: after a workbench light→dark flip, every plantuml
// block is re-rendered in the new theme's colour, and reRenderPlantuml fired EXACTLY ONCE.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

// Flipping the workbench theme is the behaviour under test, so this spec cannot stop writing —
// but it left `colorTheme` on 'Default Dark Modern', and `theme.content: 'auto'` RESOLVES to a real
// theme under any VS Code default. `preview-spacing.spec.ts` then measured an edit surface that had
// inherited `markdown-body`'s line-height and failed on the first attempt (task 516 triage / 524).
useSettingsRestore(test, ['vmarkd.theme.content', 'workbench.colorTheme'])

const FIXTURE = path.join(__dirname, 'fixtures', 'plantuml-theme-flip.md')

// The expected fill is DERIVED from the live content foreground, not hardcoded. PlantUML bakes
// `getComputedStyle(body).color` — the CONTENT theme's foreground — into its `<text fill>`, which is
// NOT `--vscode-editor-foreground`: measured with a throwaway probe, Light Modern gives editor fg
// `#3b3b3b` but content fg `#202020`, Dark Modern `#cccccc` vs `#bbbebf`. This file used to assert
// the editor-foreground constants and failed on both ends of the flip for that reason alone —
// including on a clean `main`, so it was a stale expectation, not a product regression (task 516
// full-suite triage). Deriving it also survives the next upstream palette tweak — but derivation
// ALONE would let a renderer that bakes the wrong colour pass whenever the body foreground happens
// to move with it, so the palette itself is pinned separately below.
//
// The CONTENT foreground of each VS Code default theme — see the assertion at the end of the test
// for why these are pinned alongside the derived check, and what to do if one of them fails.
const LIGHT_CONTENT_FG = '#202020'
const DARK_CONTENT_FG = '#bbbebf'

const rgbToHex = (rgb: string): string => {
  const m = rgb.match(/\d+/g)
  if (!m || m.length < 3) return rgb.toLowerCase()
  return `#${m
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`
}

async function pumlState(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    )
    const rendered = els.filter((el) => el.querySelector('svg')).length
    const firstText = els[0]?.querySelector('svg text')
    return {
      total: els.length,
      rendered,
      textFill: (firstText?.getAttribute('fill') ?? 'NONE').toLowerCase(),
      contentFg: getComputedStyle(document.body).color,
      stats:
        (window as unknown as { __vmarkdPumlRethemeStats?: unknown })
          .__vmarkdPumlRethemeStats ?? null,
    }
  })
}

test('a theme flip re-renders every PlantUML block ONCE in the new colour', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('theme.content', 'auto', true)
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', 'Default Light Modern', true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  const frame = wf(workbox)
  await frame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .nth(2)
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const before = await pumlState(frame)
  expect(before.total, 'all three plantuml blocks present').toBe(3)
  expect(before.rendered, 'all rendered before the flip').toBe(3)
  const lightFill = rgbToHex(before.contentFg)
  expect(before.textFill, 'starts in the light theme content colour').toBe(
    lightFill,
  )

  // The workbench colour-theme flip (set-theme → reThemeMono → reRenderPlantuml).
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', 'Default Dark Modern', true)
  })

  // Poll until the diagrams have re-themed to the dark colour (the re-render is debounced ~250ms then
  // async), with a generous budget — a FAILURE is either "stuck blank" or "never recoloured".
  let after = before
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    after = await pumlState(frame)
    if (
      after.rendered === after.total &&
      after.textFill === rgbToHex(after.contentFg) &&
      after.textFill !== lightFill
    )
      break
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 500)))
  }
  // Let any late second settle land, so a double-fire (if it regressed) is counted before we assert.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))
  after = await pumlState(frame)
  // eslint-disable-next-line no-console
  console.log(`[puml-flip] ${JSON.stringify(after)} in ${Date.now() - start}ms`)

  expect(after.rendered, 'every block re-rendered (not stuck blank)').toBe(
    after.total,
  )
  // Two assertions, because either alone is weak: the fill must MATCH the new content foreground
  // (it really re-rendered in the dark theme) and must DIFFER from the light one (the flip actually
  // changed something, so a renderer that never re-themed cannot pass by accident).
  expect(after.textFill, 're-rendered in the dark theme content colour').toBe(
    rgbToHex(after.contentFg),
  )
  expect(after.textFill, 'the flip actually changed the baked colour').not.toBe(
    lightFill,
  )
  // ...and the foreground it derived from is itself pinned. Deriving the expectation from the live
  // DOM alone loses ABSOLUTE sensitivity: if the renderer ever baked a slightly different colour AND
  // the body foreground moved with it, both sides of the check above would move together and pass.
  // Splitting it in two keeps each failure legible — the checks above say "the renderer baked what
  // the content theme says", these say "the content theme is still the palette we measured".
  // Values measured with a throwaway probe (task 516 triage): the CONTENT foreground, which is what
  // PlantUML bakes, NOT `--vscode-editor-foreground` (Light Modern editor fg is #3b3b3b vs content
  // #202020, Dark Modern #cccccc vs #bbbebf) — asserting the editor values is what made this spec
  // fail on a clean `main`. If one of these fails on its own, VS Code's default palette moved:
  // re-measure and update the constant, do NOT delete the assertion.
  expect(lightFill, 'Light Modern content foreground (palette drift?)').toBe(
    LIGHT_CONTENT_FG,
  )
  expect(
    rgbToHex(after.contentFg),
    'Dark Modern content foreground (palette drift?)',
  ).toBe(DARK_CONTENT_FG)
  // The double-fire guard (task 411): no block gets cleared + redrawn TWICE in one flip — that was
  // the ~57s spinner-then-blank regression (see this file's own header comment). Task 411 originally
  // pinned this via `stats.calls === 1`, because at the time `reThemeMono` called `reRenderPlantuml`
  // exactly ONCE per flip and that one call batch-redrew every visible block internally. Task 412
  // (2026-07-30) restructured that dispatch to be GATED PER DIAGRAM — `gateAndRender`'s callback now
  // calls `reRenderPlantuml` once per un-gated candidate, so `calls` legitimately became "how many
  // blocks were visible", not "how many flips happened" (3 calls for this fixture's 3 always-visible
  // blocks, correctly, not a regression — task 475 audit, 2026-07-31). `calls === 1` stopped being
  // the right proxy for the invariant task 411 actually cares about; assert that invariant directly
  // instead: every block that got cleared was redrawn EXACTLY once, i.e. `panesReRendered` (one
  // clear+redraw per pane) equals the block count, not some multiple of it.
  const stats = after.stats as { calls: number; panesReRendered: number } | null
  expect(stats, 'plantuml re-theme stats exposed').not.toBeNull()
  expect(
    stats?.panesReRendered,
    'each block cleared + redrawn exactly once, not twice (no double-fire)',
  ).toBe(after.total)
})
