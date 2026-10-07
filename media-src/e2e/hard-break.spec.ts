import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 530 — a hard line break (`␣␣` / `\` at a line end) keeps its source form through the patched
 * Lute (scripts/lute-blob-patch.mjs) when its paragraph is edited, and Shift+Enter in prose makes a
 * real one (editing/hard-break-key.ts). This spec drives real typing and the real handler through the
 * real Vditor in both modes. The real-VS-Code twin is test/vscode-e2e/hard-break-roundtrip.spec.ts.
 */

type Mode = 'ir' | 'wysiwyg'
const surface = (mode: Mode) =>
  mode === 'ir' ? '.vditor-ir' : '.vditor-wysiwyg'

// `\\` in this template literal is ONE backslash in the markdown.
const DOC = `# hard breaks

Before quote one  
before quote two\\
before quote three

> a quote

Before list one  
before list two\\
before list three

- an item

Before para one   
before para two\\
before para three

Soft one
soft two\\
hard three

A closing paragraph.
`

async function load(page: Page, mode: Mode, md: string) {
  await page.goto(`/list.html?mode=${mode}&md=${encodeURIComponent(md)}`)
  await page.waitForFunction(() => (window as any).__ready === true)
}

const getValue = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)

for (const mode of ['ir', 'wysiwyg'] as const) {
  test.describe(`hard breaks (${mode})`, () => {
    test('whole-document getValue() equals the source on load', async ({
      page,
    }) => {
      await load(page, mode, DOC)
      expect(await getValue(page)).toBe(DOC)
    })

    test('typing into each hard-broken paragraph keeps its breaks', async ({
      page,
    }) => {
      await load(page, mode, DOC)
      for (const lead of [
        'Before quote',
        'Before list',
        'Before para',
        'Soft one',
      ]) {
        const p = page.locator(`${surface(mode)} p`, { hasText: lead }).first()
        // End of the paragraph's LAST line: click, then Ctrl+End within the block is unreliable, so
        // click the end of the text and press End.
        await p.click({ position: { x: 4, y: 4 } })
        await page.evaluate((l) => {
          const el = Array.from(document.querySelectorAll('p')).find((e) =>
            e.textContent?.startsWith(l),
          )!
          const r = document.createRange()
          r.selectNodeContents(el)
          r.collapse(false)
          const s = window.getSelection()!
          s.removeAllRanges()
          s.addRange(r)
        }, lead)
        await page.keyboard.type('Q', { delay: 30 })
        await page.waitForTimeout(150)
      }
      const md = await getValue(page)
      expect(md).toBe(
        DOC.replace('before quote three', 'before quote threeQ')
          .replace('before list three', 'before list threeQ')
          .replace('before para three', 'before para threeQ')
          .replace('hard three\n', 'hard threeQ\n'),
      )
      // On screen the break stays a <br> in each edited paragraph: no literal backslash, no text newline.
      const shown = await page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(`${sel} p`))
          .filter((p) =>
            /^(Before (quote|list|para)|Soft one)/.test(p.textContent ?? ''),
          )
          .map((p) => ({
            brs: p.querySelectorAll('br').length,
            text: p.textContent ?? '',
          }))
      }, surface(mode))
      expect(shown).toHaveLength(4)
      for (const s of shown) {
        expect(s.brs).toBeGreaterThanOrEqual(1)
        expect(s.text).not.toContain('\\')
      }
    })

    test('a table cell <br> and a fenced block with trailing spaces are untouched', async ({
      page,
    }) => {
      const md =
        '| h        | i |\n| -------- | - |\n| x<br />y | z |\n\nTail  \nend\\\nmore\n\n```\ncode  \nx\\\n```\n'
      await load(page, mode, md)
      expect(await getValue(page)).toBe(md)
    })

    test('a CRLF document and an HTML block do not lose the breaks', async ({
      page,
    }) => {
      await load(page, mode, 'a  \r\nb\\\r\nc')
      expect((await getValue(page)).replace(/\r/g, '')).toBe('a  \nb\\\nc\n')
      const md = '<div>\nx<br>y\n</div>\n\nh  \ni\n'
      await load(page, mode, md)
      expect(await getValue(page)).toContain('h  \ni')
    })

    // Task 530 — the REAL Shift+Enter handler (hard-break-key.ts) on the real editors.
    const caretAfter = (page: Page, needle: string) =>
      page.evaluate(
        ([sel, needle]) => {
          const root = document.querySelector(sel) as HTMLElement
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let t: Text | null = null
          for (let n = w.nextNode(); n; n = w.nextNode())
            if ((n as Text).data.includes(needle)) {
              t = n as Text
              break
            }
          if (!t) throw new Error(`no text ${needle}`)
          const r = document.createRange()
          r.setStart(t, t.data.indexOf(needle) + needle.length)
          r.collapse(true)
          const s = getSelection() as Selection
          s.removeAllRanges()
          s.addRange(r)
          root.focus()
        },
        [`${surface(mode)} .vditor-reset`, needle] as const,
      )
    const shiftEnterDoc = async (
      md: string,
      needle: string,
      presses: number,
      typed: string,
      style: 'backslash' | 'spaces' = 'backslash',
    ) => {
      await load(page0, mode, md)
      await page0.evaluate(
        (st) => (window as any).__applyHardBreakStyle(st),
        style,
      )
      await caretAfter(page0, needle)
      for (let i = 0; i < presses; i++) {
        await page0.keyboard.press('Shift+Enter')
        await page0.waitForTimeout(80)
      }
      if (typed) await page0.keyboard.type(typed, { delay: 30 })
      await page0.waitForTimeout(200)
      return getValue(page0)
    }
    // The editor's own canonical value of `md` with no edit at all (Lute normalises e.g. loose lists).
    const baseline = async (md: string) => {
      await load(page0, mode, md)
      return getValue(page0)
    }
    let page0: Page
    test.beforeEach(async ({ page }) => {
      page0 = page
    })

    test('Shift+Enter at a paragraph end, then typing: a backslash break by default', async () => {
      expect(await shiftEnterDoc('first\n\nsecond\n', 'first', 1, 'more')).toBe(
        'first\\\nmore\n\nsecond\n',
      )
      // On screen it is a <br>: no literal backslash, no text newline.
      const shown = await page0.evaluate((sel) => {
        const p = Array.from(document.querySelectorAll(`${sel} p`)).find((e) =>
          e.textContent?.startsWith('first'),
        )
        return {
          brs: p?.querySelectorAll('br').length ?? -1,
          text: p?.textContent ?? '',
        }
      }, surface(mode))
      expect(shown.text).not.toContain('\\')
      expect(shown.brs).toBeGreaterThanOrEqual(1)
    })

    test('the spaces setting writes two trailing spaces', async () => {
      expect(
        await shiftEnterDoc('first\n\nsecond\n', 'first', 1, 'more', 'spaces'),
      ).toBe('first  \nmore\n\nsecond\n')
    })

    test('Shift+Enter in the middle of a paragraph', async () => {
      expect(await shiftEnterDoc('abcd\n', 'ab', 1, '')).toBe('ab\\\ncd\n')
    })

    test('saving right after Shift+Enter writes the paragraph unchanged (no backslash, no ZWSP)', async () => {
      const v = await shiftEnterDoc('first\n\nsecond\n', 'first', 1, '')
      // The WHOLE-document value is the original, byte for byte (an unfilled break adds nothing).
      expect(v).toBe('first\n\nsecond\n')
      expect(v).not.toContain('\\')
      expect(v).not.toContain('​')
    })

    test('two presses before typing: both breaks survive', async () => {
      expect(await shiftEnterDoc('first\n', 'first', 2, 'm')).toBe(
        'first\\\n\\\nm\n',
      )
      expect(await shiftEnterDoc('first\n', 'first', 2, 'm', 'spaces')).toBe(
        'first  \n\\\nm\n',
      )
    })

    test('in a list item and a blockquote', async () => {
      expect(await shiftEnterDoc('- item\n', 'item', 1, 'm')).toBe(
        '- item\\\n  m\n',
      )
      expect(await shiftEnterDoc('> quoted\n', 'quoted', 1, 'm')).toBe(
        '> quoted\\\n> m\n',
      )
    })

    test('inside **bold**', async () => {
      const v = await shiftEnterDoc('**bold**\n', 'bold', 1, 'm')
      expect(v).toContain('\\\nm')
      expect(v).toContain('**')
    })

    test('at the END of formatting the break goes after it: immediate save and typing after', async () => {
      for (const [md, needle, saved] of [
        ['**bold**\n', 'bold', '**bold**'],
        ['*it*\n', 'it', '*it*'],
        ['~~gone~~\n', 'gone', '~~gone~~'],
        ['***x***\n', 'x', '***x***'],
        ['[label](u)\n', 'label', '[label](u)'],
      ] as const) {
        for (const style of ['backslash', 'spaces'] as const) {
          const form = style === 'backslash' ? '\\' : '  '
          const bare = await shiftEnterDoc(md, needle, 1, '', style)
          expect(bare, `${md} ${style} bare`).toBe(`${saved}\n`)
          const typed = await shiftEnterDoc(md, needle, 1, 'm', style)
          expect(typed, `${md} ${style} typed`).toBe(`${saved}${form}\nm\n`)
        }
      }
    })

    test('a loose WYSIWYG/IR list item: immediate save has no literal backslash', async () => {
      for (const md of [
        '- item\n\n  other\n\n- last\n',
        '1. item\n\n   other\n\n2. last\n',
        '- item\n\n  other\n',
      ]) {
        const want = await baseline(md)
        expect(await shiftEnterDoc(md, 'item', 1, ''), md).toBe(want)
      }
    })

    test('immediate save after Shift+Enter is byte-identical: tight list, quote, two presses, both forms', async () => {
      for (const [md, needle, presses] of [
        ['- item\n- last\n', 'item', 1],
        ['> quoted\n\nafter\n', 'quoted', 1],
        ['first\n\nsecond\n', 'first', 2],
        ['- item\n\n  other\n\n- last\n', 'item', 2],
      ] as const) {
        for (const style of ['backslash', 'spaces'] as const) {
          const v = await shiftEnterDoc(md, needle, presses, '', style)
          expect(v, `${JSON.stringify(md)} x${presses} ${style}`).toBe(
            await baseline(md),
          )
        }
      }
    })

    test('a selection across two paragraphs is left to the editor (no marked break)', async () => {
      await load(page0, mode, 'abc\n\ndef\n')
      await page0.evaluate(
        ([sel]) => {
          const ps = document.querySelectorAll(`${sel} p`)
          const r = document.createRange()
          r.setStart(ps[0].firstChild as Text, 1)
          r.setEnd(ps[1].firstChild as Text, 2)
          const s = getSelection() as Selection
          s.removeAllRanges()
          s.addRange(r)
          ;(document.querySelector(`${sel}`) as HTMLElement).focus()
        },
        [`${surface(mode)} .vditor-reset`] as const,
      )
      await page0.keyboard.press('Shift+Enter')
      await page0.waitForTimeout(200)
      expect(
        await page0.evaluate(
          () => document.querySelectorAll('br[data-marker]').length,
        ),
      ).toBe(0)
      expect(await getValue(page0)).not.toContain('\\')
    })

    test('the first edit being Shift+Enter: undo restores the caret there, redo repeats it', async () => {
      await load(page0, mode, 'abcd\n')
      // Seed the undo stack the way a freshly opened document has it: ONE state, caret at the start.
      await caretAfter(page0, '')
      await page0.evaluate(() => (window as any).vditor.clearStack())
      await caretAfter(page0, 'ab')
      await page0.keyboard.press('Shift+Enter')
      await page0.waitForTimeout(1500) // Vditor's undo stack is debounced (undoDelay)
      expect(await getValue(page0)).toBe('ab\\\ncd\n')
      await page0.evaluate(() => {
        const inner = (window as any).vditor.vditor
        inner.undo.undo(inner)
      })
      await page0.waitForTimeout(300)
      expect(await getValue(page0)).toBe('abcd\n')
      // redo repeats the break…
      await page0.evaluate(() => {
        const inner = (window as any).vditor.vditor
        inner.undo.redo(inner)
      })
      await page0.waitForTimeout(300)
      expect(await getValue(page0)).toBe('ab\\\ncd\n')
      // …and undoing it again leaves the caret at the insertion point
      await page0.evaluate(() => {
        const inner = (window as any).vditor.vditor
        inner.undo.undo(inner)
      })
      await page0.waitForTimeout(300)
      expect(await getValue(page0)).toBe('abcd\n')
      await page0.keyboard.type('X', { delay: 30 })
      await page0.waitForTimeout(200)
      // typed at the INSERTION caret (the recorded first position), not at the document start
      expect(await getValue(page0)).toBe('abXcd\n')
    })

    test('a heading and inline code keep the stock Shift+Enter (no marked break)', async () => {
      for (const [md, needle] of [
        ['# head\n', 'head'],
        ['`code`\n', 'code'],
      ] as const) {
        await shiftEnterDoc(md, needle, 1, '')
        const marked = await page0.evaluate(
          () => document.querySelectorAll('br[data-marker]').length,
        )
        expect(marked, md).toBe(0)
      }
    })
  })
}
