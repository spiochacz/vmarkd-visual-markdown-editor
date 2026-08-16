import { stickySelection, wf } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// NET (task 190 P1) — the IR-mode counterpart of cross-diagram-edit.spec.ts (task 189, which
// covers the split view). Editing PROSE in the primary IR mode must not disturb any rendered
// diagram (the "editing X breaks Y" class the user originally hit). Fingerprints every family,
// types into a prose paragraph, and asserts every diagram family's render is unchanged.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')
const LANGS = [
  'mermaid',
  'echarts',
  'mindmap',
  'markmap',
  'flowchart',
  'graphviz',
  'plantuml',
  'abc',
  'smiles',
  'wavedrom',
  'nomnoml',
  'd2',
  'vega-lite',
  'geojson',
] as const

const FINGERPRINT = `(() => {
  const root = document.querySelector('.vditor-ir') || document.body
  const out = {}
  for (const lang of ${JSON.stringify(LANGS)}) {
    const els = [...root.querySelectorAll('.language-' + lang)]
    out[lang] = {
      els: els.length,
      svgs: root.querySelectorAll('.language-' + lang + ' svg').length,
      canvases: root.querySelectorAll('.language-' + lang + ' canvas').length,
      h: Math.round(els.reduce((s, el) => s + el.getBoundingClientRect().height, 0)),
      copyBtns: els.reduce((s, el) => s + (el.closest('pre')?.querySelectorAll('.vditor-copy').length ?? 0), 0),
    }
  }
  return out
})()`

test('editing prose in IR leaves every diagram family intact', async ({
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
  await frame
    .locator('.vditor-ir .language-d2 svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))

  const fp = () =>
    frame
      .locator('body')
      .evaluate(
        (_b, src) => new Function(`return ${src}`)(),
        FINGERPRINT,
      ) as Promise<
      Record<
        (typeof LANGS)[number],
        {
          els: number
          svgs: number
          canvases: number
          h: number
          copyBtns: number
        }
      >
    >

  const before = await fp()
  for (const lang of LANGS) expect(before[lang].els, lang).toBeGreaterThan(0)

  // Type into a prose paragraph (caret after a single-text-node needle).
  await stickySelection(
    frame,
    () => {
      const walker = document.createTreeWalker(
        document.querySelector('.vditor-ir') as Node,
        NodeFilter.SHOW_TEXT,
      )
      let node: Text | null = null
      while (walker.nextNode()) {
        const t = walker.currentNode as Text
        if (t.textContent?.includes('Demo file')) {
          node = t
          break
        }
      }
      if (!node) throw new Error('prose needle not found')
      const off =
        (node.textContent ?? '').indexOf('Demo file') + 'Demo file'.length
      const r = document.createRange()
      r.setStart(node, off)
      r.collapse(true)
      const sel = getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      document.execCommand('insertText', false, ' EDIT')
    },
    null,
  )
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3500)))
  const after = await fp()

  for (const lang of LANGS) {
    expect(after[lang].els, `${lang} element count`).toBe(before[lang].els)
    expect(after[lang].svgs, `${lang} svg count`).toBe(before[lang].svgs)
    expect(after[lang].canvases, `${lang} canvas count`).toBe(
      before[lang].canvases,
    )
    expect(after[lang].copyBtns, `${lang} copy buttons`).toBe(
      before[lang].copyBtns,
    )
    expect(
      Math.abs(after[lang].h - before[lang].h),
      `${lang} height drift (${before[lang].h} -> ${after[lang].h})`,
    ).toBeLessThanOrEqual(Math.max(8, before[lang].h * 0.15))
  }
})
