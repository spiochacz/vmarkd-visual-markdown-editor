import { wf } from './webview-helpers'
// Task 427 (+ 431's end-state contract) — the colour timeline of an open: the frontmatter must never
// show an intermediate colour, and code must end up highlighted with its stylesheet loaded.
//
// This started as a probe and REPRODUCED the reported bug, so it is now the regression net for it.
// Measured on material-dark before the fix: frontmatter was rgb(152,195,121) — atom-one-dark's
// #98c379 green — until `.hljs` was tagged ~280 ms later, then snapped to rgb(171,178,191) grey.
// Cause and fix are documented at the assertion below; note that BOTH source-only analyses had
// predicted no green was possible, which is exactly why the symptom needed measuring rather than
// reasoning about.
//
// Method note (kept because it cost three attempts): the sampling has to be OUTSIDE the webview.
// An rAF sampler attached after waiting for `.vditor-ir` starts sampling after the window has already
// closed; the same sampler installed via addInitScript lands in the outer, hidden webview iframe whose
// rAF never advances. Round-trip polling gives ~10 ms resolution — ample for a window a human sees.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const DOC = path.join(__dirname, 'fixtures', 'frontmatter-code.md')

usePinnedSettings(test, { 'vmarkd.theme.content': 'material-dark' })

type Sample = {
  t: number
  link: boolean
  sheet: boolean
  fmTagged: boolean
  fmColour: string
  codeTagged: boolean
  codeTokens: number
  codeColour: string
}

test('code/frontmatter colour timeline on open (tasks 427 + 431 probe)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(240_000)
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      // The reported configuration: material content theme (→ paired atom-one-dark code style),
      // pinned above.
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [DOC] as [string],
  )
  // Poll from OUTSIDE, starting the instant the open command returns. Two in-webview approaches were
  // tried first and both measured nothing: an rAF sampler attached after `waitFor` starts sampling
  // after the window has closed, and the same sampler installed via addInitScript lands in a frame
  // whose rAF never advances (the outer, hidden webview iframe). Round-trip polling gives ~10 ms
  // resolution, which is ample for a window a human can perceive.
  const frame = wf(workbox)
  const t0 = Date.now()
  const timeline: Sample[] = []
  let last = ''
  while (Date.now() - t0 < 12_000) {
    let s: Sample | null = null
    try {
      s = (await frame.locator('body').evaluate(() => {
        const link = document.getElementById(
          'vditorHljsStyle',
        ) as HTMLLinkElement | null
        // Frontmatter: Lute renders it as `div[data-type=yaml-front-matter] > pre > code`.
        const fm = document.querySelector<HTMLElement>(
          '[data-type="yaml-front-matter"] code',
        )
        // The RENDER node (token spans live there), not the editable source marker — IR keeps both and
        // the source one is deliberately monochrome (`.hljs` class only, code-source.ts).
        const codes = [
          ...document.querySelectorAll<HTMLElement>('code.language-js'),
        ]
        const code =
          codes.find((c) => c.querySelector('[class*="hljs-"]')) ??
          codes[codes.length - 1] ??
          null
        return {
          t: 0,
          link: !!link,
          // `.sheet` is non-null only once the stylesheet has actually loaded + parsed.
          sheet: !!link?.sheet,
          fmTagged: !!fm?.classList.contains('hljs'),
          fmColour: fm ? getComputedStyle(fm).color : '',
          codeTagged: !!code?.classList.contains('hljs'),
          codeTokens: code
            ? code.querySelectorAll('[class*="hljs-"]').length
            : 0,
          codeColour: code ? getComputedStyle(code).color : '',
        }
      })) as Sample
    } catch {
      continue // frame not attached yet / mid-navigation
    }
    s.t = Date.now() - t0
    const key = `${s.link}|${s.sheet}|${s.fmTagged}|${s.fmColour}|${s.codeTagged}|${s.codeTokens > 0}|${s.codeColour}`
    if (key !== last) {
      last = key
      timeline.push(s)
    }
  }

  // What the DOM actually looks like, so a wrong selector can't masquerade as a product finding.
  const shape = await frame.locator('body').evaluate(() => {
    const pick = (el: Element | null) =>
      el
        ? {
            tag: el.tagName,
            cls: el.className,
            tokens: el.querySelectorAll('[class*="hljs-"]').length,
            colour: getComputedStyle(el as HTMLElement).color,
          }
        : null
    return {
      frontmatter: [
        ...document.querySelectorAll('[data-type="yaml-front-matter"] code'),
      ].map(pick),
      js: [...document.querySelectorAll('code.language-js')].map(pick),
    }
  })

  console.log(`[tasks 427/431] timeline:\n${JSON.stringify(timeline, null, 1)}`)
  console.log(`[tasks 427/431] dom:\n${JSON.stringify(shape, null, 1)}`)

  const final = timeline[timeline.length - 1]
  expect(final, 'the sampler produced a timeline').toBeTruthy()

  // ── Task 427, the actual regression ────────────────────────────────────────────────────────────
  // MEASURED before the fix (material-dark): at t≈747 ms the frontmatter was rgb(152,195,121) —
  // atom-one-dark's #98c379 GREEN — and at t≈1029 ms, when observeCodeSource tagged `.hljs`, it
  // snapped to rgb(171,178,191) grey. That IS the user's "green → final colour" report. Cause: the
  // content theme's INLINE-code rule (`.markdown-body code:not(.hljs)`, material-dark.css:34) leaking
  // onto block code; main.css already neutralised that for the PREVIEW pre, but frontmatter lives in
  // `pre.vditor-ir__marker--pre`, which the selector didn't cover. Fixed by extending it.
  // The invariant below is what "no flash" means: the frontmatter's colour never differs from the
  // colour it settles on.
  const fmColours = [
    ...new Set(timeline.map((s) => s.fmColour).filter(Boolean)),
  ]
  expect(
    fmColours,
    'the frontmatter must hold ONE colour for the whole open — a second value is the task-427 flash',
  ).toEqual([final.fmColour])
  // What we assert as the PRODUCT contract (independent of the flash question): by the end of an open
  // the code block is highlighted and its stylesheet is loaded.
  expect(
    final.link,
    'an hljs stylesheet link exists by the end of the open',
  ).toBe(true)
  expect(final.sheet, 'that stylesheet actually loaded').toBe(true)
  expect(
    final.codeTokens,
    'the js code block ends up with real hljs token spans',
  ).toBeGreaterThan(0)
})
