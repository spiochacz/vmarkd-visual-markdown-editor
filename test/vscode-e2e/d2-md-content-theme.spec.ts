import { wf } from './webview-helpers'
// NET — a named content theme must not restyle the INSIDE of a d2 `|md|` label.
//
// Reported: "na diagramie w stylu github sa zle rozlozone boxy, na vscode light jest ok" — on the
// github content theme the "Release checklist" node was enormous and narrow, its heading wrapped
// onto two lines and the "Ship it" box below it was placed against a wildly oversized box.
//
// Cause (task 422): `.vmarkd-d2-md` normalises the typography inside the label BECAUSE that
// typography is the node's layout box — `measureMdHtml` measures the same class offscreen and
// d2-render sizes the node from the result. Every named theme styles `.markdown-body h1` at
// specificity (0,1,1) and loads AFTER main.css, so it won inside the label: h1 went 1.4em -> 2em
// plus a 0.3em padded border, overflowed the 420px measure cap and wrapped.
//
// This is real-webview-only: it needs the custom-editor's actual <link> order and the
// markdown-body class the host puts on <body>, neither of which the chromium harness reproduces.
// (The harness DOES pin the cascade rule itself — content-theme.spec.ts — but not the pipeline.)
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

// Set once, up front, before opening, and never changed again mid-test.
usePinnedSettings(test, { 'vmarkd.theme.content': 'github-light' })

interface DiagDiag {
  d2Blocks: number
  d2Svgs: number
  d2ForeignObjects: number
  d2MdLabels: number
  bodyClasses: string
}

const DIAG = `(() => {
  const root = window.vditor.vditor.ir.element
  return {
    d2Blocks: root.querySelectorAll('.language-d2').length,
    d2Svgs: root.querySelectorAll('.language-d2 svg').length,
    d2ForeignObjects: root.querySelectorAll('.language-d2 foreignObject').length,
    d2MdLabels: root.querySelectorAll('.language-d2 .vmarkd-d2-md').length,
    bodyClasses: document.body.className,
  }
})()`

const READ = `(() => {
  const root = window.vditor.vditor.ir.element
  const labels = Array.from(root.querySelectorAll('.language-d2 foreignObject .vmarkd-d2-md'))
  const h1 = labels.map((l) => l.querySelector('h1')).filter(Boolean)[0]
  if (!h1) return { found: false }
  const cs = getComputedStyle(h1)
  return {
    found: true,
    labels: labels.length,
    // The theme is only a threat when the body actually carries its class — assert we are really
    // testing the themed case and not a silently-unthemed page.
    themed: document.body.classList.contains('markdown-body'),
    fontSize: cs.fontSize,
    borderBottom: cs.borderBottomWidth,
    paddingBottom: cs.paddingBottom,
    // One line of a 22.4px heading is ~30px at line-height 1.35; a wrapped one is ~60px. This is
    // the actual user-visible symptom, so assert it directly rather than only its cause.
    h1Height: h1.getBoundingClientRect().height,
  }
})()`

test('a github-themed page does not restyle the inside of a d2 |md| label', async ({
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
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 90_000 })
  // Poll for the |md| label instead of a fixed sleep — the fixture renders a dozen diagrams
  // concurrently and this specific block is not the first one to settle.
  let diag: DiagDiag = {
    d2Blocks: 0,
    d2Svgs: 0,
    d2ForeignObjects: 0,
    d2MdLabels: 0,
    bodyClasses: '',
  }
  await expect
    .poll(
      async () => {
        diag = (await frame.locator('body').evaluate(DIAG)) as DiagDiag
        return diag.d2MdLabels
      },
      { timeout: 60_000, message: 'no d2 |md| label ever appeared' },
    )
    .toBeGreaterThan(0)

  const r = (await frame.locator('body').evaluate(READ)) as {
    found: boolean
    labels?: number
    themed?: boolean
    fontSize?: string
    borderBottom?: string
    paddingBottom?: string
    h1Height?: number
  }

  // Never let an unrendered fixture pass as "the label is fine".
  expect(r.found, 'no d2 |md| label with a heading rendered at all').toBe(true)
  expect(
    r.themed,
    'the page was not actually running a named content theme',
  ).toBe(true)
  expect(
    r.fontSize,
    'the content theme rewrote the label heading size — the node box is no longer ours',
  ).toBe('22.4px')
  expect(r.borderBottom, 'the theme drew a rule across the label heading').toBe(
    '0px',
  )
  expect(r.paddingBottom, 'the theme padded the label heading').toBe('0px')
  expect(
    r.h1Height,
    '"Release checklist" wrapped onto a second line — the node is oversized again',
  ).toBeLessThan(45)
})
