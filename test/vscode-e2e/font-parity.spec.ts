import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings, useSettingsRestore } from './settings-helpers'

// Task 443 — the vscode-*-2026 content themes exist to REPRODUCE VS Code's own Markdown preview,
// so this asserts prose typography parity against that preview directly: same file, same VS Code
// instance, so `editor.fontSize` / `markdown.preview.*` / window zoom are identical by construction
// and any delta is genuinely ours. No golden image is involved, which is what makes it valid on any
// machine regardless of installed fonts (both sides resolve the same stack from the same system).
//
// It was a bug-hunting probe first: the user reported our blockquote text rendered LARGER than the
// preview's. Measured cause was NOT the font size (both 14px) but the LEADING — Vditor's
// `.vditor-reset { line-height: 1.5 }` → 21px against the preview's `markdown.preview.lineHeight`
// default 1.6 → 22.4px — plus a font stack that resolves to a different face off Windows.
const FIXTURE = path.join(__dirname, 'fixtures', 'font-parity.md')

const PROBE_TEXT = 'The quick brown fox jumps'

// Measured on the SHORT, marker-free, single-line probe sentence in both a blockquote and a plain
// paragraph. Two independent width measures, because the first cut of this probe measured neither:
//   - inkedWidth uses range.getClientRects() and reports rectCount — a Range spanning MORE than one
//     line box returns a UNION box whose width is the CONTAINER width, not the text's, so a
//     multi-line target silently measures the pane instead of the glyphs. Only rectCount === 1 is a
//     valid font metric, hence the short sentence and the assertion on rectCount.
//   - canvasWidth re-measures the same string through canvas measureText with the element's computed
//     font shorthand: immune to wrapping and to the element's box entirely, so it isolates
//     font-size × family metrics even though the two panes have different content widths.
// NB the signature: `locator.evaluate(fn, arg)` calls fn(ELEMENT, arg) — the argument is the SECOND
// parameter. Taking probeText first silently binds it to the <body> element (every measurement comes
// back null, nothing throws).
const MEASURE = (_body: Element, probeText: string) => {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const pick = (el: Element | null | undefined) => {
    if (!el) return null
    const cs = getComputedStyle(el as HTMLElement)
    const r = document.createRange()
    r.selectNodeContents(el)
    const rects = Array.from(r.getClientRects())
    let canvasWidth: number | null = null
    if (ctx) {
      // `font` shorthand: style weight size/line-height family
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`
      canvasWidth = Math.round(ctx.measureText(probeText).width * 100) / 100
    }
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing,
      fontFamily: cs.fontFamily,
      rectCount: rects.length,
      inkedWidth: rects.length ? Math.round(rects[0].width * 100) / 100 : null,
      canvasWidth,
    }
  }

  const startsWithProbe = (el: Element) =>
    (el.textContent ?? '').trim().startsWith(probeText)
  // Prefer the <p> INSIDE the blockquote: measuring the blockquote element itself also spans our IR
  // mode's `>` marker span, which sits on its own line box → 2 rects → a union rect (the pane width).
  const shortBq =
    Array.from(document.querySelectorAll('blockquote p')).find(
      startsWithProbe,
    ) ??
    Array.from(document.querySelectorAll('blockquote')).find(startsWithProbe)
  const shortP = Array.from(document.querySelectorAll('p')).find(
    (p) => !p.closest('blockquote') && startsWithProbe(p),
  )

  // Heading leading + the floated gutter marker's centring. The marker is a ::before, so it has no
  // box to measure — read its computed line-height instead, which IS the centring mechanism: it
  // should equal the heading's own line box (leading × the heading's font-size).
  const headings = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map(
    (tag) => {
      const h =
        document.querySelector(`.vditor-reset > ${tag}`) ??
        document.querySelector(tag)
      if (!h) return { tag, missing: true }
      const cs = getComputedStyle(h as HTMLElement)
      const before = getComputedStyle(h as HTMLElement, '::before')
      return {
        tag,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        markerLineHeight: before.lineHeight,
        markerTop: before.top,
      }
    },
  )

  return {
    blockquote: pick(shortBq),
    paragraph: pick(shortP),
    headings,
    bodyFontSize: getComputedStyle(document.body).fontSize,
  }
}

const px = (v: string | undefined) => (v ? Number.parseFloat(v) : Number.NaN)

// editor.fontSize / markdown.preview.* / headingMarkers are identical across both generated tests
// below, so they're pinned. vmarkd.theme.content varies per test (dark vs light) and can't be
// pinned to one shared value — restored only, inline write stays in the test body.
usePinnedSettings(test, {
  'editor.fontSize': 14,
  'markdown.preview.fontSize': 14,
  'markdown.preview.lineHeight': 1.6,
  'vmarkd.editor.headingMarkers': true,
})
useSettingsRestore(test, ['vmarkd.theme.content'])

for (const contentTheme of ['vscode-dark-2026', 'vscode-light-2026']) {
  test(`${contentTheme} prose typography matches VS Code's own markdown preview`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    // Every other input both sides derive from is pinned above; only the per-test content theme is
    // written here (it varies between the two generated tests, so it can't be pinned).
    await evaluateInVSCode(
      async (vscode, args) => {
        const [theme] = args as [string]
        await vscode.workspace
          .getConfiguration('vmarkd')
          .update('theme.content', theme, vscode.ConfigurationTarget.Global)
      },
      [contentTheme] as [string],
    )

    // ── our editor ──────────────────────────────────────────────────────────────
    await evaluateInVSCode(
      async (vscode, args) => {
        const [uri] = args as [string]
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const oursFrame = workbox
      .frameLocator('iframe.webview')
      .frameLocator('iframe[title="vMarkd"], #active-frame')
    await oursFrame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await oursFrame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 3000)))
    const ours = await oursFrame.locator('body').evaluate(MEASURE, PROBE_TEXT)

    // ── VS Code's own preview, same file, same window ───────────────────────────
    await evaluateInVSCode(
      async (vscode, args) => {
        const [uri] = args as [string]
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vscode.markdown.preview.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const theirsFrame = workbox
      .frameLocator('iframe.webview')
      .frameLocator('#active-frame')
    await theirsFrame.locator('blockquote').first().waitFor({ timeout: 60_000 })
    await theirsFrame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))
    const preview = await theirsFrame
      .locator('body')
      .evaluate(MEASURE, PROBE_TEXT)

    for (const key of ['blockquote', 'paragraph'] as const) {
      const a = ours[key]
      const b = preview[key]
      console.log(
        `[font-parity/${contentTheme}] ${key}: size ${a?.fontSize} vs ${b?.fontSize} | ` +
          `lh ${a?.lineHeight} vs ${b?.lineHeight} | ` +
          `inked ${a?.inkedWidth}(rects=${a?.rectCount}) vs ${b?.inkedWidth}(rects=${b?.rectCount}) | ` +
          `canvas ${a?.canvasWidth} vs ${b?.canvasWidth}`,
      )
      expect(a, `our ${key} was measured`).toBeTruthy()
      expect(b, `preview ${key} was measured`).toBeTruthy()
      // one line box on each side, else the width numbers below measure the pane, not the text
      expect(a?.rectCount, `our ${key} probe text is single-line`).toBe(1)
      expect(b?.rectCount, `preview ${key} probe text is single-line`).toBe(1)
      expect(a?.fontSize, `${key} font-size`).toBe(b?.fontSize)
      expect(px(a?.lineHeight), `${key} line-height`).toBeCloseTo(
        px(b?.lineHeight),
        1,
      )
      // the real payoff: identical glyph advance ⇒ same size AND same resolved face
      expect(
        px(String(a?.canvasWidth)),
        `${key} inked text width (font-size × resolved family)`,
      ).toBeCloseTo(px(String(b?.canvasWidth)), 0)
    }

    for (const [i, h] of ours.headings.entries()) {
      const theirs = preview.headings[i]
      console.log(
        `[font-parity/${contentTheme}] ${h.tag}: size ${h.fontSize} vs ${theirs?.fontSize} | ` +
          `lh ${h.lineHeight} vs ${theirs?.lineHeight} | marker lh ${h.markerLineHeight} top ${h.markerTop}`,
      )
      expect(h.missing, `${h.tag} present in our editor`).toBeFalsy()
      expect(theirs?.missing, `${h.tag} present in the preview`).toBeFalsy()
      expect(h.fontSize, `${h.tag} font-size`).toBe(theirs?.fontSize)
      // Headings are at 1.25 on BOTH sides — the preview does NOT inherit its 1.6 body leading here
      // (measured: h1 line box 35px = 1.25 × 28px), which is exactly what Vditor already gives us.
      // Task 443 deliberately left heading leading alone; this pins that they agree.
      expect(px(h.lineHeight), `${h.tag} line-height`).toBeCloseTo(
        px(theirs?.lineHeight),
        1,
      )
      // The floated gutter marker is centred on the heading's first text line by giving its ::before a
      // line-height equal to the heading's own line box. Both read the same --vmarkd-geo-hN +
      // --vmarkd-geo-heading-lh tokens (task 532 step 3b), so they agree at any theme / font size; this pins
      // it in the real webview (headingMarkers is pinned on above). Chromium twin: heading-marker-align.spec.ts.
      const markerDelta =
        Math.round((px(h.markerLineHeight) - px(h.lineHeight)) * 100) / 100
      console.log(
        `[font-parity/${contentTheme}] ${h.tag} gutter marker line box off by ${markerDelta}px ` +
          `(marker ${h.markerLineHeight} vs heading line box ${h.lineHeight})`,
      )
      expect(
        Math.abs(markerDelta),
        `${h.tag} gutter marker line box vs heading line box`,
      ).toBeLessThanOrEqual(0.5)
      expect(
        Math.abs(Number.parseFloat(h.markerTop) || 0),
        `${h.tag} gutter marker vertical offset`,
      ).toBeLessThanOrEqual(0.5)
    }
  })
}
