import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// Task 166 — viewport-gate the mermaid theme-flip re-render, real VS Code, headless. On a tall 12-mermaid
// doc, a genuine dark<->light flip used to re-render ALL 12 in one main-thread burst (~90% offscreen). Now
// only the VISIBLE diagram(s) re-render immediately; the offscreen ones are marked `data-vmarkd-mermaid-defer`
// and re-render+swap on scroll-in via a single IntersectionObserver. Asserts: (1) after a flip only a
// SUBSET re-renders immediately (not all 12) and the rest carry the defer marker; (2) scrolling a deferred
// diagram into view re-renders it (marker cleared + fresh SVG).
const FIXTURE = path.join(__dirname, 'fixtures', 'mermaid-flip-gate.md')
const N = 12

// PRECONDITION: the content theme must FOLLOW the editor ('auto'). This spec asserts that flipping
// the workbench theme re-renders mermaid — which is only true when the flip actually moves the
// webview foreground. With `theme.content` PINNED to a fixed theme, a workbench flip changes nothing
// in the webview and the (correctly) foreground-gated re-theme does nothing: 0 re-renders, and this
// spec fails through no fault of the product. Several sibling specs (echarts-theme, d2-theme, …) pin
// `theme.content` GLOBALLY and never restore it, so in a full-suite run this spec inherits their
// setting — the real mechanism behind its "passes solo, fails in the suite" reputation (reproduced:
// `echarts-theme.spec.ts mermaid-flip-gate.spec.ts` fails, alone it passes). Pinning it here makes the
// spec self-defending instead of dependent on predecessors. Applied before each test (and hence before
// the document opens below), matching the original inline write's timing — a content-theme switch
// fires the mono re-theme, which clears a block (innerHTML='') before re-rendering it, and landing that
// on a block whose first render is still in flight discards the only copy of its source.
usePinnedSettings(test, { 'vmarkd.theme.content': 'auto' })
// `workbench.colorTheme` is flipped TWICE mid-test (light baseline, then the light->dark flip that is
// the actual behaviour under test), so it can't be pinned — only cleaned up after.
useSettingsRestore(test, ['workbench.colorTheme'])

test('theme flip re-renders only visible mermaid; offscreen defer + render on scroll-in (task 166)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(150_000)
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  // Establish a known LIGHT theme so the measured flip below (light->dark) is a genuine palette change
  // that task 164 does NOT skip.
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Light Modern',
        vscode.ConfigurationTarget.Global,
      )
  })
  await expect
    .poll(
      () => frame.locator('.vditor-ir__preview .language-mermaid svg').count(),
      { timeout: 90_000 },
    )
    .toBeGreaterThanOrEqual(N)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1200)))

  // Tag every current mermaid SVG so we can tell which get re-rendered (a re-render replaces innerHTML →
  // the new SVG lacks the tag). Also record how many are visible-ish at flip time.
  const pre = await frame.locator('body').evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-mermaid'),
    ) as HTMLElement[]
    const vh = window.innerHeight
    let visible = 0
    for (const n of nodes) {
      const s = n.querySelector('svg')
      if (s) s.setAttribute('data-preflip', '1')
      const r = n.getBoundingClientRect()
      if (r.bottom > -200 && r.top < vh + 200) visible++
    }
    return { total: nodes.length, visible }
  })

  // Genuine light -> dark flip.
  await evaluateInVSCode(async (vscode) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Dark Modern',
        vscode.ConfigurationTarget.Global,
      )
  })

  // Wait for the immediate (visible-only) re-render to settle, then snapshot. POLL for the first
  // re-rendered svg rather than sleeping a fixed 1500ms: the re-render is only "immediate" relative to
  // the deferred ones, and under full-suite load it lands later than a fixed wait allows — that timing
  // gap, not a gating bug, is what made this spec fail in the suite while passing solo. The gating
  // assertions below are unchanged, so a genuinely absent re-render still fails (on timeout).
  await expect
    .poll(
      () =>
        frame
          .locator(
            '.vditor-ir__preview .language-mermaid svg:not([data-preflip])',
          )
          .count(),
      { timeout: 30_000, intervals: [200, 400, 800] },
    )
    .toBeGreaterThanOrEqual(1)
  // Let the rest of the immediate batch settle before counting (the gate asserts NOT all re-rendered).
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const afterFlip = await frame.locator('body').evaluate(() => {
    const svgs = Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-mermaid svg'),
    )
    const reRendered = svgs.filter(
      (s) => !s.hasAttribute('data-preflip'),
    ).length
    const deferred = document.querySelectorAll(
      '.vditor-ir__preview .language-mermaid[data-vmarkd-mermaid-defer]',
    ).length
    return { reRendered, deferred }
  })

  // (1) Gating: only a subset re-rendered immediately (NOT all N), and the rest are deferred.
  expect(
    afterFlip.reRendered,
    'some visible mermaid re-rendered immediately',
  ).toBeGreaterThanOrEqual(1)
  expect(
    afterFlip.reRendered,
    'NOT all mermaid re-rendered immediately (viewport-gated)',
  ).toBeLessThan(N)
  expect(afterFlip.deferred, 'offscreen mermaid are deferred').toBeGreaterThan(
    0,
  )

  // (2) Scroll the LAST (deferred) mermaid into view → it should re-render + clear its defer marker.
  await frame.locator('body').evaluate(() => {
    const nodes = document.querySelectorAll(
      '.vditor-ir__preview .language-mermaid[data-vmarkd-mermaid-defer]',
    )
    const last = nodes[nodes.length - 1] as HTMLElement | undefined
    last?.scrollIntoView({ block: 'center' })
  })
  await expect
    .poll(
      async () =>
        frame.locator('body').evaluate(() => {
          // the scrolled-in diagram cleared its marker AND has a fresh (untagged) svg
          const nodes = Array.from(
            document.querySelectorAll('.vditor-ir__preview .language-mermaid'),
          ) as HTMLElement[]
          const freshOnScreen = nodes.filter((n) => {
            const r = n.getBoundingClientRect()
            const onScreen = r.bottom > 0 && r.top < window.innerHeight
            return (
              onScreen &&
              !n.hasAttribute('data-vmarkd-mermaid-defer') &&
              !n.querySelector('svg[data-preflip]')
            )
          }).length
          return freshOnScreen
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1)

  // eslint-disable-next-line no-console
  console.log(
    `[166] total=${pre.total} visibleAtFlip=${pre.visible} reRenderedImmediately=${afterFlip.reRendered} deferred=${afterFlip.deferred}`,
  )
})
