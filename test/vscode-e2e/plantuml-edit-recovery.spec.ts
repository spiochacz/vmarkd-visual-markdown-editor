// PlantUML diagram-type recovery (task 178 follow-up) — real-VS-Code only.
//
// The vendored TeaVM PlantUML engine carried STICKY diagram-type state across render() calls on one
// shared instance: once it rendered a class diagram, a later VALID sequence source was misclassified as
// a class diagram and never recovered (user repro: edit an arrow into "-"/".->" → it flips to a class
// diagram of Alice/Bob and stays there). plantuml-render.ts now gives EACH render a FRESH engine (a
// cache-busted re-import → fresh module statics), so every render classifies its source independently.
//
// Two real-webview proofs the chromium harness can't give (TeaVM engine + the custom-editor pipeline):
//   1) recovery: sequence → class → sequence on ONE block recovers to a sequence svg.
//   2) multi-type: a class block followed by a sequence block both render with the CORRECT type
//      (pre-fix the 2nd block rendered wrong/blank — the concurrency face of the same shared-engine bug).
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

const ALL = path.join(__dirname, 'fixtures', 'all-renderers.md')
const MULTI = path.join(__dirname, 'fixtures', 'plantuml-multi-type.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

const open = (
  evaluateInVSCode: (
    fn: (vscode: typeof import('vscode'), args: string[]) => Promise<void>,
    args: [string],
  ) => Promise<void>,
  uri: string,
) =>
  evaluateInVSCode(
    async (vscode, args) => {
      const [u] = args
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(u),
        'vmarkd.editor',
      )
    },
    [uri],
  )

// A diagram is a CLASS diagram when its rendered <text> includes a standalone "C" (PlantUML's class
// icon letter); a sequence diagram of Alice/Bob never does.
const looksClass = (texts: string | null) =>
  !!texts && /(^|\|)C(\||$)/.test(texts)

test('editing a plantuml arrow sequence→class→sequence recovers (fresh engine per render)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, ALL)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .first()
    .waitFor({ timeout: 60_000 })
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  // texts of the first rendered plantuml block
  const texts = () =>
    frame.locator('body').evaluate(() => {
      const el = document.querySelector(
        '.vditor-ir__preview .language-plantuml',
      )
      const svg = el?.querySelector('svg')
      return svg
        ? Array.from(svg.querySelectorAll('text'))
            .map((t) => t.textContent ?? '')
            .join('|')
        : null
    })

  // Replace the first occurrence of `find` in the editable IR source with a real keyboard edit. Maps a
  // global source-textContent offset to a (node,offset) Range — robust to highlight span-splitting.
  // NOTE: locator.evaluate passes the matched ELEMENT first, the user arg SECOND → bind (_el, arg).
  const editSource = async (find: string, replacement: string) => {
    const ok = await frame.locator('body').evaluate((_el, needle) => {
      const wrapper = document.querySelector('.language-plantuml')
      const node = wrapper?.closest('.vditor-ir__node') as HTMLElement | null
      if (!node) return false
      const seed = (node.querySelector('.vditor-ir__marker--pre') ??
        node) as HTMLElement
      const sr = document.createRange()
      sr.selectNodeContents(seed)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(sr)
      node.classList.add('vditor-ir__node--expand')
      const source = node.querySelector(
        '.vditor-ir__marker--pre',
      ) as HTMLElement | null
      if (!source) return false
      const parts: { node: Text; start: number }[] = []
      let acc = ''
      const w = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
      let tn = w.nextNode() as Text | null
      while (tn) {
        parts.push({ node: tn, start: acc.length })
        acc += tn.textContent ?? ''
        tn = w.nextNode() as Text | null
      }
      const gi = acc.indexOf(needle)
      if (gi < 0) return false
      const loc = (g: number) => {
        for (let k = parts.length - 1; k >= 0; k--)
          if (g >= parts[k].start)
            return { node: parts[k].node, offset: g - parts[k].start }
        return { node: parts[0].node, offset: 0 }
      }
      const a = loc(gi)
      const b = loc(gi + needle.length)
      const r = document.createRange()
      r.setStart(a.node, a.offset)
      r.setEnd(b.node, b.offset)
      sel?.removeAllRanges()
      sel?.addRange(r)
      source.focus()
      return true
    }, find)
    expect(ok, `could not select "${find}" in the plantuml source`).toBe(true)
    await workbox.keyboard.type(replacement, { delay: 80 })
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1800)))
  }

  expect(looksClass(await texts())).toBe(false) // open: sequence

  await editSource('->', '-') // "Alice - Bob: Hello" → class association
  expect(looksClass(await texts())).toBe(true) // now a class diagram

  await editSource('-', '->') // back to a valid sequence arrow
  const recovered = await texts()
  // eslint-disable-next-line no-console
  console.log(`[recovery] texts=${recovered}`)
  expect(looksClass(recovered)).toBe(false) // RECOVERED to sequence (the bug: stayed class)
  expect(recovered).toContain('Hello')

  // user's 2nd report: a DOTTED arrow "Alice .-> Bob" (has an arrowhead, so the no-arrowhead rule
  // misses it) flips to a class diagram; deleting the dot back to "->" must recover.
  await editSource('->', '.->') // "Alice .-> Bob: Hello" → class
  expect(looksClass(await texts())).toBe(true)
  await editSource('.->', '->') // delete the dot → valid sequence again
  const recovered2 = await texts()
  // eslint-disable-next-line no-console
  console.log(`[recovery .->] texts=${recovered2}`)
  expect(looksClass(recovered2)).toBe(false) // RECOVERED (the 2nd reported stuck case)
  expect(recovered2).toContain('Hello')
})

test('two plantuml blocks of different types both render correctly (no shared-engine poisoning)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await open(evaluateInVSCode, MULTI)
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.vditor-ir__preview .language-plantuml svg')
    .first()
    .waitFor({ timeout: 60_000 })

  // both blocks may render slightly apart (serialized fresh engines) — give the 2nd a moment
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 3000)))
  const after = await frame.locator('body').evaluate(() =>
    Array.from(
      document.querySelectorAll('.vditor-ir__preview .language-plantuml'),
    ).map((el) => {
      const svg = el.querySelector('svg')
      return {
        hasSvg: !!svg,
        texts: svg
          ? Array.from(svg.querySelectorAll('text'))
              .map((t) => t.textContent ?? '')
              .join('|')
          : null,
      }
    }),
  )
  // eslint-disable-next-line no-console
  console.log(`[multi-type] ${JSON.stringify(after)}`)

  expect(after.length).toBe(2)
  // block 0 = class (Foo/Bar with the circled-C), block 1 = sequence (Alice/Bob, no standalone C)
  expect(after[0].hasSvg).toBe(true)
  expect(looksClass(after[0].texts)).toBe(true)
  expect(after[1].hasSvg).toBe(true) // pre-fix: false (blank) — the smoking-gun fact
  expect(looksClass(after[1].texts)).toBe(false)
  expect(after[1].texts).toContain('Alice')
})
