import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// Task 412 follow-up — CONFIRMED HIGH bug: every viewport-gated retheme path resolved its scan root
// from `activeModeElement(window.vditor)`, which is ONLY the active mode's own element
// (`vditor.ir.element`/`vditor.wysiwyg.element`). Vditor appends the full/split Preview surface
// (`.vditor-preview`) as a SIBLING of that element, not a descendant — so an already-rendered
// diagram living there was never even collected as a gate candidate (not "judged offscreen", never
// enumerated) and stayed stale after a theme flip until the document was reopened. Fixed via
// `diagramRenderRoot` (diagram-surfaces.ts), which resolves the stable `#app` mount instead — an
// ancestor of every surface.
//
// This spec proves the fix in the REAL webview: switch to `sv` (split) mode, where the editable
// pane AND `.vditor-preview` are both live simultaneously, flip the theme, and confirm diagrams
// rendered in `.vditor-preview` actually got REDRAWN, not just the editable pane's copy.
// Verification is "was the rendered child REPLACED" (same tag-then-check-absence pattern
// mermaid-flip-gate.spec.ts already uses), not a colour-signature diff: echarts renders to a
// `<canvas>` (no fill/stroke DOM attributes to compare) and mermaid bakes its palette into an
// embedded `<style>` block's CSS rules (not per-element fill/stroke attributes either), so neither
// engine's redraw is visible to an attribute-based colour check even though both DID re-render.
//
// Task 454 — measured per-lang (not a shared stop-at-first-failure assertion, which is exactly what
// hid this: a single failure at the SAME source line on every loop iteration told nobody WHICH lang
// was the culprit): mermaid/plantuml/wavedrom/d2 redraw correctly here — genuine proof the 412 fix
// reaches the sv-mode `.vditor-preview` surface for those engines. echarts alone did not, because
// `reRenderEcharts` resolved each chart's JSON source via a sibling editable `<code
// class="language-echarts">` OUTSIDE the preview pane — a lookup `.vditor-preview` never satisfies
// (no 1:1 editable-block pairing there, unlike IR/WYSIWYG), so `source` was always `undefined` and
// the redraw silently `continue`d. Fixed by stamping `data-code` on the live node as chartRender.ts
// first renders it (esbuild patch `patchEchartsDataCode`, media-src/esbuild-shared.mjs) and having
// `reRenderEcharts` read that off each `live` node directly (media-src/src/echarts-retheme.ts) —
// echarts now asserts normally alongside the other four engines below.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const LANGS = ['mermaid', 'echarts', 'plantuml', 'wavedrom', 'd2'] as const
// Passed as a literal into every page.evaluate() below (not referenced via closure — Playwright's
// evaluate serializes only its explicit args, not outer JS scope) so the tag/check pair can't drift.
const TAG_ATTR = 'data-preflip-412'
// Task 466 — `all-renderers.md` §3 has TWO mermaid diagrams (a flowchart, then a sequence diagram):
// `document.querySelector('.vditor-preview .language-mermaid')` above only ever reaches the FIRST.
// This second tag targets the SECOND one specifically, to prove (or disprove) that a multi-diagram
// `.vditor-preview` pane redraws every same-lang diagram on a flip, not just the first.
const TAG_ATTR_2 = 'data-preflip-466-second'

// `vmarkd.theme.content` is set once up front and never changed again (see the precondition
// comment inside `openFlipAndTag`) — pinned. `workbench.colorTheme` is flipped mid-test (light ->
// dark is the behaviour under test), so it can't be pinned — just declared for cleanup.
usePinnedSettings(test, {
  'vmarkd.theme.content': 'auto',
})
useSettingsRestore(test, ['workbench.colorTheme'])

// Shared setup for both tests below: open the fixture, switch to sv (split) mode, wait for every
// engine's first render, tag each lang's CURRENT rendered child (a redraw replaces the whole
// child — innerHTML='' + fresh render — so the tag vanishes with it; an untouched/stale node keeps
// the SAME tagged child forever), flip the theme, then scroll every lang's `.vditor-preview` node
// into view (`all-renderers.md` is long enough that most sit outside the sv-mode Preview pane's OWN
// independent initial scroll position, so the gate correctly defers them — confirmed via
// `data-vmarkd-retheme-defer="1"` observed on plantuml during triage — exactly like an offscreen
// diagram in the editable pane; this is the gate working as designed, not a regression). Returns the
// webview frame so each caller does its own polling/assertions against whichever lang(s) it owns.
async function openFlipAndTag(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: (fn: unknown, args?: unknown) => Promise<unknown>,
): Promise<import('@playwright/test').FrameLocator> {
  // Same preconditions as retheme-flip-matrix.spec.ts / mermaid-flip-gate.spec.ts, same reasons:
  // `theme.content` must FOLLOW the editor ('auto') or a workbench flip never reaches the webview
  // foreground (pinned above); set `colorTheme` BEFORE opening (a content-theme switch landing
  // mid-first-render can permanently empty a block — task 363).
  await evaluateInVSCode(async (vscode: typeof import('vscode')) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        'Default Light Modern',
        vscode.ConfigurationTarget.Global,
      )
  })
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
    .locator('.vditor-ir__preview .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  // Let every engine's first render settle before switching modes.
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  // Switch to sv (split) mode: opens the edit-mode dropdown, then clicks the sv option — same
  // two-step toolbar interaction content-visibility-modes.spec.ts uses for wysiwyg.
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="sv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-preview').first().waitFor({ timeout: 60_000 })
  // Let sv-mode's own render pass (a fresh Preview build) finish for every engine.
  await expect
    .poll(
      async () =>
        frame.locator('body').evaluate(
          (_b, langs: string[]) => {
            return langs.every((lang) => {
              const live = document.querySelector(
                `.vditor-preview .language-${lang}`,
              )
              return !!live?.querySelector(
                'svg, canvas, .leaflet-container, object',
              )
            })
          },
          LANGS as unknown as string[],
        ),
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(true)

  const preTag = await frame.locator('body').evaluate(
    (_b, args) => {
      const { langs, tagAttr } = args as { langs: string[]; tagAttr: string }
      const tagged: Record<string, boolean> = {}
      for (const lang of langs) {
        const live = document.querySelector(`.vditor-preview .language-${lang}`)
        const child = live?.querySelector(
          'svg, canvas, .leaflet-container, object',
        )
        if (child) {
          child.setAttribute(tagAttr, '1')
          tagged[lang] = true
        } else {
          tagged[lang] = false
        }
      }
      return tagged
    },
    { langs: LANGS as unknown as string[], tagAttr: TAG_ATTR },
  )
  for (const lang of LANGS) {
    expect(
      preTag[lang],
      `${lang} has a rendered child to tag in .vditor-preview`,
    ).toBe(true)
  }

  // Task 466 — tag the SECOND mermaid diagram's rendered svg too (see TAG_ATTR_2's own comment).
  const preTag2 = await frame
    .locator('body')
    .evaluate((_b, tagAttr: string) => {
      const nodes = Array.from(
        document.querySelectorAll('.vditor-preview .language-mermaid'),
      )
      const second = nodes[1] as HTMLElement | undefined
      const svg = second?.querySelector('svg')
      if (svg) svg.setAttribute(tagAttr, '1')
      return { count: nodes.length, tagged: !!svg }
    }, TAG_ATTR_2)
  expect(
    preTag2.count,
    'fixture has TWO mermaid diagrams in .vditor-preview',
  ).toBe(2)
  expect(
    preTag2.tagged,
    'the second mermaid diagram has a rendered svg to tag',
  ).toBe(true)

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

  for (const lang of LANGS) {
    await frame.locator('body').evaluate((_b, l: string) => {
      document
        .querySelector(`.vditor-preview .language-${l}`)
        ?.scrollIntoView({ block: 'center' })
    }, lang)
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 200)))
  }
  // Task 466 — scroll the SECOND mermaid diagram into view too (the loop above only ever targets
  // the first `.language-mermaid` match per lang, same limitation as `wasRedrawn` below).
  await frame.locator('body').evaluate(() => {
    const nodes = document.querySelectorAll('.vditor-preview .language-mermaid')
    ;(nodes[1] as HTMLElement | undefined)?.scrollIntoView({ block: 'center' })
  })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 200)))

  return frame
}

async function wasRedrawn(
  frame: import('@playwright/test').FrameLocator,
  lang: string,
): Promise<boolean> {
  return frame.locator('body').evaluate(
    (_b, args) => {
      const { lang, tagAttr } = args as { lang: string; tagAttr: string }
      const live = document.querySelector(`.vditor-preview .language-${lang}`)
      const child = live?.querySelector(
        'svg, canvas, .leaflet-container, object',
      )
      return child ? !child.hasAttribute(tagAttr) : false
    },
    { lang, tagAttr: TAG_ATTR },
  )
}

test('a theme flip redraws diagrams rendered in the sv-mode .vditor-preview surface (mermaid/echarts/plantuml/wavedrom/d2)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(180_000)
  const frame = await openFlipAndTag(workbox, evaluateInVSCode)

  // Task 454 pins the MECHANISM, not just the outcome: the preview's echarts node must carry a
  // non-empty `data-code` stamp (patchEchartsDataCode, media-src/esbuild-shared.mjs) — the thing
  // `reRenderEcharts` actually reads to find its source in `.vditor-preview`. Asserting only the
  // redraw below would still pass if some OTHER mechanism happened to produce it; this catches a
  // regression that silently drops the stamp even if a redraw still occurs some other way.
  const echartsDataCode = await frame
    .locator('body')
    .evaluate(() =>
      document
        .querySelector('.vditor-preview .language-echarts')
        ?.getAttribute('data-code'),
    )
  expect(
    echartsDataCode,
    'preview .language-echarts carries a non-empty data-code stamp',
  ).toBeTruthy()

  // Poll each lang INDEPENDENTLY (try/catch, not a single shared assertion) — the different engines
  // settle on very different schedules (mermaid: offscreen swap; mono: foreground poll + settle; D2:
  // deferred 400ms + WASM compile), so one shared fixed sleep would either under-wait the slowest or
  // over-wait needlessly past the fastest. Independence also matters for diagnosis: a single
  // stop-at-first-failure assertion is what hid the echarts gap (task 454) for so long — every
  // failure pointed at the SAME source line regardless of which lang actually hung.
  const outcomes: Record<string, 'redrawn' | 'TIMED OUT'> = {}
  for (const lang of LANGS) {
    try {
      await expect
        .poll(() => wasRedrawn(frame, lang), {
          timeout: 60_000,
          intervals: [500, 1000, 2000],
        })
        .toBe(true)
      outcomes[lang] = 'redrawn'
    } catch {
      outcomes[lang] = 'TIMED OUT'
    }
  }
  console.log('[412-preview] outcomes', JSON.stringify(outcomes))

  // Task 466 — the SECOND mermaid diagram in `.vditor-preview` (all-renderers.md §3's sequence
  // diagram) must ALSO redraw, not just the first (flowchart). `nativeSourceForPane`/mermaid-retheme's
  // pane loop used `pane.querySelector('.language-mermaid')` — a FIRST-match read — against
  // `.vditor-preview`, which holds every diagram in the whole document as ONE pane, so only the first
  // mermaid was ever collected as a re-render candidate; the second stayed in the pre-flip theme.
  let secondRedrawn = false
  try {
    await expect
      .poll(
        () =>
          frame.locator('body').evaluate((_b, tagAttr: string) => {
            const nodes = document.querySelectorAll(
              '.vditor-preview .language-mermaid',
            )
            const svg = nodes[1]?.querySelector('svg')
            return svg ? !svg.hasAttribute(tagAttr) : false
          }, TAG_ATTR_2),
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true)
    secondRedrawn = true
  } catch {
    /* recorded below */
  }
  console.log('[466] second mermaid redrawn =', secondRedrawn)
  expect(
    secondRedrawn,
    'the SECOND mermaid diagram in .vditor-preview also redrew after the flip',
  ).toBe(true)

  // Each diagram also keeps its OWN content post-flip — a source mix-up (first diagram's source
  // drawn into the second) would still flip the tag above but produce the WRONG shape. The
  // flowchart's node labels ("Start"/"Decision") must not leak into the sequence diagram's redraw,
  // and vice versa (its actor labels are "User"/"Editor").
  const shapes = await frame.locator('body').evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('.vditor-preview .language-mermaid'),
    )
    return nodes.map((n) => n.querySelector('svg')?.textContent ?? '')
  })
  expect(shapes[0], 'first mermaid keeps its flowchart content').toMatch(
    /Start|Decision/,
  )
  expect(
    shapes[0],
    'first mermaid did NOT pick up the sequence content',
  ).not.toMatch(/participant|Editor/i)
  expect(
    shapes[1],
    'second mermaid keeps its sequence-diagram content',
  ).toMatch(/User|Editor/)

  // 412's own per-lang assertion — kept last so a genuine 466 regression (asserted independently
  // above) is never masked by an unrelated lang's failure here.
  for (const lang of LANGS) {
    expect(outcomes[lang], `${lang} redrew after the flip`).toBe('redrawn')
  }
})
