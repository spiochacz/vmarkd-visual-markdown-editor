import { wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { applySettings, useSettingsRestore } from './settings-helpers'

// Task 532 step 3 (supersedes task 110's "Preview-only rhythm", ADR-0009) — pins the content
// GEOMETRY PROFILE a theme selects, on EVERY stage that renders the document: the instant-paint
// overlay, IR, WYSIWYG and the full Preview. The same --vmarkd-geo-* tokens drive all of them, so a
// stage that disagrees with its siblings (or with the profile) fails here with the stage named.
//
//   vscode profile  (vscode-*-2026 — and the default for NO content theme, material, high contrast):
//                   VS Code's native preview rhythm — 1.6 leading, 0.7em block gap, 40px list indent,
//                   1.25 headings, 1.5 code.
//   github profile  (github-*): GitHub's — 1.5 leading, 16px gap, 2em list indent, 1.25 headings, 1.5 code.
//
// The exhaustive per-element, per-theme comparison is the parity gate (parity-matrix.spec.ts); this
// spec is the cheap, readable statement of the PROFILE VALUES themselves. Real VS Code only:
// getComputedStyle needs the genuine cascade (main.css link order, VS Code's injected defaults).
//
// One test() per profile — each pays a full VS Code boot (cost comment atop playwright.config.ts).

const FIXTURE = path.join(__dirname, 'fixtures', 'preview-spacing.md')

interface Metrics {
  found: boolean
  pFontSize: number
  pLineHeight: number
  pMarginBottom: number
  ulFontSize: number
  ulMarginBottom: number
  ulPaddingLeft: number
  bqMarginBottom: number
  h2FontSize: number
  h2LineHeight: number
  codeFound: boolean
  codeFontSize: number
  codeLineHeight: number
}

// Runs in the webview page context — no closures over node-side values. NaN (not undefined/null)
// when an element is missing, so the assertions never need a non-null assertion.
const READ_METRICS = `(rootSel) => {
  const root = document.querySelector(rootSel)
  const num = (v) => (v ? Number.parseFloat(v) : NaN)
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const p = root && root.querySelector('p')
  const ul = root && root.querySelector('ul')
  const bq = root && root.querySelector('blockquote')
  const h2 = root && root.querySelector('h2')
  // The RENDERED code block: IR keeps its editable source (marker) pre beside it, invisible while
  // collapsed and not what the reader sees.
  const code = root && Array.from(root.querySelectorAll('pre:not(.vditor-ir__marker--pre) > code')).find(
    (c) => c.getBoundingClientRect().height > 0)
  const cp = cs(p), cu = cs(ul), cb = cs(bq), ch = cs(h2), cc = cs(code)
  return {
    found: !!p && !!ul && !!bq && !!h2,
    pFontSize: num(cp && cp.fontSize),
    pLineHeight: num(cp && cp.lineHeight),
    pMarginBottom: num(cp && cp.marginBottom),
    ulFontSize: num(cu && cu.fontSize),
    ulMarginBottom: num(cu && cu.marginBottom),
    ulPaddingLeft: num(cu && cu.paddingLeft),
    bqMarginBottom: num(cb && cb.marginBottom),
    h2FontSize: num(ch && ch.fontSize),
    h2LineHeight: num(ch && ch.lineHeight),
    codeFound: !!code,
    codeFontSize: num(cc && cc.fontSize),
    codeLineHeight: num(cc && cc.lineHeight),
  }
}`

const STAGES = {
  overlay: '#vmarkd-prerender pre.vditor-reset',
  ir: '#app .vditor-ir pre.vditor-reset',
  wysiwyg: '#app .vditor-wysiwyg pre.vditor-reset',
  preview: '#app .vditor-preview .vditor-reset',
} as const
type Stage = keyof typeof STAGES

const PREVIEW_ON = `(() => {
  const inst = window.vditor, v = inst.vditor
  v.preview.element.style.display = 'block'
  v[inst.getCurrentMode()].element.parentElement.style.display = 'none'
  v.preview.render(v)
})()`
const CLICK_WYSIWYG = `(() => {
  const b = document.querySelector('.vditor-toolbar button[data-mode="wysiwyg"]')
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})()`

interface Profile {
  name: string
  settings: Record<string, unknown>
  /** Expected values: ratios are unitless, gaps/indent are in `em` of the measured element. */
  lineHeight: number
  blockGapEm?: number
  blockGapPx?: number
  listIndentPx?: number
  listIndentEm?: number
}

const VSCODE_PROFILE = {
  lineHeight: 1.6,
  blockGapEm: 0.7,
  listIndentPx: 40,
} as const

const PROFILES: Profile[] = [
  {
    name: 'vscode profile (vscode-dark-2026 via auto under Default Dark Modern)',
    settings: {
      'workbench.colorTheme': 'Default Dark Modern',
      'vmarkd.theme.content': 'auto',
    },
    ...VSCODE_PROFILE,
  },
  {
    // 'Monokai' pairs with no named content theme, so `auto` stays unthemed: the DEFAULT profile,
    // which is the VS Code rhythm too (main.css `body { --vmarkd-geo-* }`).
    name: 'default profile (no content theme: auto under Monokai)',
    settings: {
      'workbench.colorTheme': 'Monokai',
      'vmarkd.theme.content': 'auto',
    },
    ...VSCODE_PROFILE,
  },
  {
    name: 'github profile (github-dark)',
    settings: {
      'workbench.colorTheme': 'Default Dark Modern',
      'vmarkd.theme.content': 'github-dark',
    },
    lineHeight: 1.5,
    blockGapPx: 16,
    listIndentEm: 2,
  },
]

useSettingsRestore(test, [
  ...new Set(PROFILES.flatMap((p) => Object.keys(p.settings))),
  'vmarkd.editor.defaultMode',
])

// The overlay is ephemeral; the hold keeps it after boot so it can be measured (same hook as
// parity-matrix.spec.ts). `delete`, never `= undefined` (that stores the string "undefined").
test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})

for (const profile of PROFILES) {
  test(`${profile.name}: one rhythm on overlay, IR, WYSIWYG and Preview`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    test.setTimeout(180_000)
    await applySettings(evaluateInVSCode, {
      ...profile.settings,
      'vmarkd.editor.defaultMode': 'ir',
      // Pinned so a leaked setting from an earlier spec cannot move the measurement.
      'vmarkd.editor.fullWidth': true,
      'vmarkd.editor.fontSize': 'editor',
      'vmarkd.theme.code': 'auto',
    })
    await evaluateInVSCode(async (vscode, uri) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    }, FIXTURE)

    const frame = wf(workbox)
    const body = frame.locator('body')
    const read = (stage: Stage) =>
      body.evaluate(
        `(${READ_METRICS})(${JSON.stringify(STAGES[stage])})`,
      ) as Promise<Metrics>
    const settled = async (stage: Stage) => {
      await expect
        .poll(
          async () =>
            (await read(stage)).found && (await read(stage)).codeFound,
          {
            timeout: 60_000,
            message: `${stage} never rendered the fixture`,
          },
        )
        .toBe(true)
      return read(stage)
    }

    await frame
      .locator('.vditor-ir')
      .first()
      .waitFor({ state: 'attached', timeout: 90_000 })
    const measured = {} as Record<Stage, Metrics>
    measured.overlay = await settled('overlay')
    measured.ir = await settled('ir')
    await body.evaluate(PREVIEW_ON)
    measured.preview = await settled('preview')
    await body.evaluate(
      `(() => { const inst = window.vditor, v = inst.vditor
        v.preview.element.style.display = 'none'
        v[inst.getCurrentMode()].element.parentElement.style.display = 'block' })()`,
    )
    await body.evaluate(CLICK_WYSIWYG)
    measured.wysiwyg = await settled('wysiwyg')

    console.log(
      '[532-spacing]',
      profile.name,
      JSON.stringify(measured, null, 2),
    )

    for (const stage of Object.keys(STAGES) as Stage[]) {
      const m = measured[stage]
      const at = `[${profile.name} / ${stage}]`
      // Leading: unitless ratio of the paragraph's own font.
      expect(m.pLineHeight / m.pFontSize, `${at} prose leading`).toBeCloseTo(
        profile.lineHeight,
        1,
      )
      // Block gap on p, ul and blockquote alike.
      const gap = (fontSize: number) =>
        profile.blockGapEm !== undefined
          ? fontSize * profile.blockGapEm
          : (profile.blockGapPx as number)
      expect(m.pMarginBottom, `${at} p gap`).toBeCloseTo(gap(m.pFontSize), 0)
      expect(m.ulMarginBottom, `${at} ul gap`).toBeCloseTo(gap(m.ulFontSize), 0)
      expect(m.bqMarginBottom, `${at} blockquote gap`).toBeCloseTo(
        gap(m.pFontSize),
        0,
      )
      // List indent.
      const indent =
        profile.listIndentPx !== undefined
          ? profile.listIndentPx
          : m.ulFontSize * (profile.listIndentEm as number)
      expect(m.ulPaddingLeft, `${at} list indent`).toBeCloseTo(indent, 0)
      // Headings 1.25 everywhere, code 1.5 of its OWN font (never inline code).
      expect(
        m.h2LineHeight / m.h2FontSize,
        `${at} heading leading`,
      ).toBeCloseTo(1.25, 1)
      expect(m.codeFound, `${at} has a code block`).toBe(true)
      expect(
        m.codeLineHeight / m.codeFontSize,
        `${at} code leading`,
      ).toBeCloseTo(1.5, 1)
    }
  })
}
