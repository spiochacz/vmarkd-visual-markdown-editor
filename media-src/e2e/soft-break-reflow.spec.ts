import type { Page } from '@playwright/test'
import { expect, test } from './coverage-fixture'

/**
 * Task 83 (increment 3) — vmarkd.editor.reflowLineBreaks in the EDITOR (IR + WYSIWYG). With the
 * setting on, every soft-break newline sits in `<span class="vmarkd-softbreak" contenteditable=false>`
 * (renders as a space + a ↵ glyph) so a soft-wrapped paragraph flows as one visual line; the saved
 * markdown is byte-identical to the setting off. The real-VS-Code twin is
 * test/vscode-e2e/soft-break-reflow.spec.ts.
 *
 * Every key case runs twice — reflow on and reflow off — and the markdown must come out the SAME: the
 * decorator is not allowed to change what an edit does to the file.
 */

type Mode = 'ir' | 'wysiwyg'

const DOC = [
  'Alpha one',
  'beta two',
  'gamma three',
  '',
  'Hard one  ',
  'hard two\\',
  'hard three',
  '',
  '> quote one',
  '> quote two',
  '',
  '- item one',
  '  item cont',
  '- item two',
  '',
  '# Heading',
  '',
  'tail',
  '',
].join('\n')

async function load(page: Page, mode: Mode, reflow: boolean, md = DOC) {
  await page.goto(
    `/list.html?mode=${mode}&reflow=${reflow ? 1 : 0}&md=${encodeURIComponent(md)}`,
  )
  await page.waitForFunction(() => (window as any).__ready === true)
  if (reflow)
    await page.waitForFunction(() =>
      document.querySelector('.vmarkd-softbreak'),
    )
}

const value = (page: Page) =>
  page.evaluate(() => (window as any).vditor.getValue() as string)
const spans = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('.vmarkd-softbreak').length)
const settle = (page: Page) => page.waitForTimeout(250)

// Caret at `needle` + delta (text-node search), editor focused.
async function caretAt(page: Page, needle: string, delta = 0) {
  await page.evaluate(
    ([needle, delta]) => {
      const v = (window as any).vditor.vditor
      const root = v[v.currentMode].element as HTMLElement
      root.focus()
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const i = (w.currentNode as Text).data.indexOf(needle as string)
        if (i >= 0) {
          getSelection()!.collapse(w.currentNode, i + (delta as number))
          return
        }
      }
      throw new Error(`needle ${needle}`)
    },
    [needle, delta] as const,
  )
  await page.waitForTimeout(60)
}

// Selection from `a`+ai to `b`+bi (text-node search), editor focused.
async function selectAcross(
  page: Page,
  a: string,
  ai: number,
  b: string,
  bi: number,
) {
  await page.evaluate(
    ([a, ai, b, bi]) => {
      const v = (window as any).vditor.vditor
      const root = v[v.currentMode].element as HTMLElement
      root.focus()
      const find = (n: string) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (w.nextNode())
          if ((w.currentNode as Text).data.includes(n))
            return w.currentNode as Text
        throw new Error(`needle ${n}`)
      }
      const A = find(a as string)
      const B = find(b as string)
      getSelection()!.setBaseAndExtent(
        A,
        A.data.indexOf(a as string) + (ai as number),
        B,
        B.data.indexOf(b as string) + (bi as number),
      )
    },
    [a, ai, b, bi] as const,
  )
  await page.waitForTimeout(60)
}

// Visual line count of the paragraph containing `needle`.
const lineCount = (page: Page, needle: string) =>
  page.evaluate((needle) => {
    const v = (window as any).vditor.vditor
    const p = [
      ...(v[v.currentMode].element as HTMLElement).querySelectorAll('p'),
    ].find((x) => x.textContent?.includes(needle))!
    const r = document.createRange()
    r.selectNodeContents(p)
    return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size
  }, needle)

const caretInfo = (page: Page) =>
  page.evaluate(() => {
    const s = getSelection()!
    const n = s.anchorNode!
    const el = n.nodeType === 3 ? n.parentElement! : (n as Element)
    const blk = el.closest('p,li,blockquote')!
    const r = document.createRange()
    r.setStart(blk, 0)
    r.setEnd(n, s.anchorOffset)
    const r2 = document.createRange()
    r2.setStart(n, s.anchorOffset)
    r2.setEndAfter(blk.lastChild!)
    return {
      at: `${JSON.stringify(r.toString().slice(-6))}|${JSON.stringify(r2.toString().slice(0, 6))}`,
      inSpan: !!el.closest('.vmarkd-softbreak'),
    }
  })

type Case = (page: Page) => Promise<void>
const CASES: Record<string, Case> = {
  'end of line 1, type X': async (p) => {
    await caretAt(p, 'Alpha one', 9)
    await p.keyboard.type('X')
  },
  'end of line 1, ArrowRight, type X': async (p) => {
    await caretAt(p, 'Alpha one', 9)
    await p.keyboard.press('ArrowRight')
    await p.keyboard.type('X')
  },
  'start of line 2, ArrowLeft, type X': async (p) => {
    await caretAt(p, 'beta', 0)
    await p.keyboard.press('ArrowLeft')
    await p.keyboard.type('X')
  },
  'start of line 2, type X': async (p) => {
    await caretAt(p, 'beta', 0)
    await p.keyboard.type('X')
  },
  'start of line 2, Backspace joins the lines': async (p) => {
    await caretAt(p, 'beta', 0)
    await p.keyboard.press('Backspace')
  },
  'end of line 1, Delete joins the lines': async (p) => {
    await caretAt(p, 'Alpha one', 9)
    await p.keyboard.press('Delete')
  },
  'start of line 2, Enter splits the paragraph': async (p) => {
    await caretAt(p, 'beta', 0)
    await p.keyboard.press('Enter')
  },
  'Ctrl+Backspace at the start of line 2 deletes the word before the break, not "one beta"':
    async (p) => {
      await caretAt(p, 'beta', 0)
      await p.keyboard.press('Control+Backspace')
    },
  'Ctrl+Delete at the end of line 1 deletes the word after the break': async (
    p,
  ) => {
    await caretAt(p, 'Alpha one', 9)
    await p.keyboard.press('Control+Delete')
  },
  'Backspace over a selection that spans a break': async (p) => {
    await selectAcross(p, 'one', 1, 'beta', 2)
    await p.keyboard.press('Backspace')
  },
  'typing over a selection that spans a break': async (p) => {
    await selectAcross(p, 'one', 1, 'beta', 2)
    await p.keyboard.type('Q')
  },
  'Enter in the middle of line 1': async (p) => {
    await caretAt(p, 'Alpha one', 3)
    await p.keyboard.press('Enter')
  },
  'Shift+Enter in the middle of line 2': async (p) => {
    await caretAt(p, 'beta two', 4)
    await p.keyboard.press('Shift+Enter')
    await p.keyboard.type('Z')
  },
  'type a word at the end of line 2': async (p) => {
    await caretAt(p, 'beta two', 8)
    await p.keyboard.type(' hello', { delay: 25 })
  },
  'blockquote: type X at the start of line 2': async (p) => {
    await caretAt(p, 'quote two', 0)
    await p.keyboard.type('X')
  },
  'list continuation: type X at its start': async (p) => {
    await caretAt(p, 'item cont', 0)
    await p.keyboard.type('X')
  },
}

for (const mode of ['ir', 'wysiwyg'] as const) {
  test.describe(`soft-break reflow (${mode})`, () => {
    test('markers + one visual line, markdown byte-identical, glyph never selectable', async ({
      page,
    }) => {
      await load(page, mode, false)
      const baseline = await value(page)
      const baselineLines = await lineCount(page, 'Alpha')
      expect(baselineLines).toBe(3)
      expect(await spans(page)).toBe(0)

      await load(page, mode, true)
      // Alpha(2) + hard three/soft? no: 'Hard one<br>hard two<br>hard three' has NO "\n";
      // quote(1) + list item(1) = 4
      expect(await spans(page)).toBe(4)
      expect(await value(page)).toBe(baseline)
      expect(await lineCount(page, 'Alpha')).toBe(1)
      // the CSS glyph is generated content: it must not reach the selection text
      const selected = await page.evaluate(() => {
        const v = (window as any).vditor.vditor
        const p = v[v.currentMode].element.querySelector('p')
        const r = document.createRange()
        r.selectNodeContents(p)
        getSelection()!.removeAllRanges()
        getSelection()!.addRange(r)
        return getSelection()!.toString()
      })
      // the span paints as a space: the selection reads like the reflowed text, never with the glyph
      expect(selected).toBe('Alpha one beta two gamma three')
      // ::before content is the arrow
      const glyph = await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('.vmarkd-softbreak')!,
            '::before',
          ).content,
      )
      expect(glyph).toContain('↵')
    })

    // IR-only: the incremental serializer does not exist for WYSIWYG
    if (mode === 'ir')
      test('the incremental serializer (per-block VditorIRDOM2Md, the fast path of serializeForHost) is byte-identical too', async ({
        page,
      }) => {
        const perBlock = () =>
          page.evaluate(() => {
            const v = (window as any).vditor.vditor
            return Array.from(v.ir.element.children as HTMLElement[]).map((b) =>
              v.lute.VditorIRDOM2Md(b.outerHTML),
            )
          })
        await load(page, mode, false)
        const off = await perBlock()
        await load(page, mode, true)
        expect(await spans(page)).toBe(4)
        expect(await perBlock()).toEqual(off)
      })

    test('copying across a marker puts the markdown newline (not the glyph, not a space) on the clipboard', async ({
      page,
    }) => {
      await load(page, mode, true)
      await page.evaluate(() => {
        ;(window as any).__copied = {} as Record<string, string>
        const orig = DataTransfer.prototype.setData
        DataTransfer.prototype.setData = function (type: string, data: string) {
          ;(window as any).__copied[type] = data
          return orig.call(this, type, data)
        }
        const v = (window as any).vditor.vditor
        const root = v[v.currentMode].element as HTMLElement
        root.focus()
        const p = root.querySelector('p') as HTMLElement
        const first = p.firstChild as Text
        const last = p.lastChild as Text
        getSelection()!.setBaseAndExtent(first, 2, last, 4)
      })
      await page.keyboard.press('Control+c')
      await page.waitForTimeout(150)
      const copied = await page.evaluate(
        () => (window as any).__copied['text/plain'],
      )
      expect(copied).toBe('pha one\nbeta two\ngamm')
      expect(copied).not.toContain('\u21B5')
    })

    test('the arrow keys cross a break in ONE press and the caret never rests inside a span', async ({
      page,
    }) => {
      await load(page, mode, true)
      await caretAt(page, 'Alpha one', 7)
      const walk: string[] = []
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowRight')
        const c = await caretInfo(page)
        expect(c.inSpan).toBe(false)
        walk.push(c.at)
      }
      // 7 -> 8 -> 9 (end of "Alpha one") -> ONE press to the start of "beta" -> "b|eta"
      expect(walk[0]).toBe('"pha on"|"e\\nbeta"')
      expect(walk[1]).toBe('"ha one"|"\\nbeta "')
      expect(walk[2]).toBe('"a one\\n"|"beta t"')
      expect(walk[3]).toBe('" one\\nb"|"eta tw"')
    })

    test('a click on the glyph puts the caret after the break, typing lands in the paragraph', async ({
      page,
    }) => {
      await load(page, mode, true)
      const box = await page.evaluate(() => {
        const r = document
          .querySelector('.vmarkd-softbreak')!
          .getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      await page.mouse.click(box.x, box.y)
      await page.waitForTimeout(100)
      expect((await caretInfo(page)).inSpan).toBe(false)
      await page.keyboard.type('X')
      await settle(page)
      expect((await value(page)).split('\n\n')[0]).toBe(
        'Alpha one\nXbeta two\ngamma three',
      )
    })

    for (const [name, fn] of Object.entries(CASES)) {
      test(`same markdown as without the decorator: ${name}`, async ({
        page,
      }) => {
        await load(page, mode, false)
        await fn(page)
        await settle(page)
        const off = await value(page)

        await load(page, mode, true)
        await fn(page)
        await settle(page)
        const on = await value(page)
        expect(on).toBe(off)
        // and the break structure survived: typing never ate a newline
        expect(on).not.toBe(DOC)
        // the decorator is back on afterwards
        expect(await spans(page)).toBeGreaterThan(0)
      })
    }

    test('large-document mode (content-visibility: auto per block) still decorates every block and reflows', async ({
      page,
    }) => {
      test.setTimeout(60_000)
      const big = Array.from(
        { length: 200 },
        (_, i) => `para ${i} line one\nline two of ${i}\nline three`,
      ).join('\n\n')
      await load(page, mode, true)
      await page.evaluate((big) => {
        document.body.classList.add('vmarkd-large-doc')
        ;(window as any).vditor.setValue(big, true)
      }, big)
      await page.waitForFunction(
        () => document.querySelectorAll('.vmarkd-softbreak').length === 400,
        undefined,
        { timeout: 20_000 },
      )
      const cv = await page.evaluate(() => {
        const v = (window as any).vditor.vditor
        return getComputedStyle(v[v.currentMode].element.firstElementChild)
          .contentVisibility
      })
      expect(cv).toBe('auto')
      expect(await lineCount(page, 'para 0 line one')).toBe(1)
    })

    test('End goes to the end of the reflowed paragraph (the visual line), not of the first source line', async ({
      page,
    }) => {
      await load(page, mode, true)
      await caretAt(page, 'Alpha', 0)
      await page.keyboard.press('End')
      await page.keyboard.type('X')
      await settle(page)
      expect((await value(page)).split('\n\n')[0]).toBe(
        'Alpha one\nbeta two\ngamma threeX',
      )
    })

    test('Shift+Enter makes a HARD break (backslash + newline) that visibly breaks the line', async ({
      page,
    }) => {
      await load(page, mode, true)
      await caretAt(page, 'Alpha one', 9)
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('NEW')
      await settle(page)
      const md = (await value(page)).split('\n\n')[0]
      expect(md).toBe('Alpha one\\\nNEW\nbeta two\ngamma three')
      // "Alpha one" / "NEW beta two gamma three": two visual lines, not one
      expect(await lineCount(page, 'Alpha')).toBe(2)
    })

    test('Shift+Enter at the very end of a soft-wrapped paragraph: the typed text lands on the new line', async ({
      page,
    }) => {
      await load(page, mode, true, 'Second one\nsecond two\n\nnext\n')
      await caretAt(page, 'second two', 'second two'.length)
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('N')
      await settle(page)
      expect(await value(page)).toBe('Second one\nsecond two\\\nN\n\nnext\n')
    })

    test('undo snapshots never contain the marker spans (decoration is not an undo step)', async ({
      page,
    }) => {
      await load(page, mode, true)
      await caretAt(page, 'Alpha one', 9)
      await page.keyboard.type('X')
      // Vditor snapshots the editor after its undo delay (800 ms)
      await page.waitForTimeout(1300)
      const snap = await page.evaluate(() => {
        const v = (window as any).vditor.vditor
        const undo = v.undo[v.currentMode]
        return {
          lastText: undo.lastText as string,
          steps: undo.undoStack.length as number,
          spansLive: document.querySelectorAll('.vmarkd-softbreak').length,
        }
      })
      expect(snap.spansLive).toBeGreaterThan(0)
      expect(snap.lastText).toContain('Alpha oneX')
      expect(snap.lastText).not.toContain('vmarkd-softbreak')
    })

    test('turning the setting off unwraps every span, on re-wraps them; markdown never changes', async ({
      page,
    }) => {
      await load(page, mode, true)
      const md = await value(page)
      await page.evaluate(() => (window as any).__applyReflowLineBreaks(false))
      await page.waitForFunction(
        () => !document.querySelector('.vmarkd-softbreak'),
      )
      expect(await value(page)).toBe(md)
      expect(await lineCount(page, 'Alpha')).toBe(3)
      await page.evaluate(() => (window as any).__applyReflowLineBreaks(true))
      await page.waitForFunction(
        () => document.querySelectorAll('.vmarkd-softbreak').length === 4,
      )
      expect(await value(page)).toBe(md)
      expect(await lineCount(page, 'Alpha')).toBe(1)
    })

    test('a big document is decorated in idle chunks (first screen first); typing during it stays correct', async ({
      page,
    }) => {
      test.setTimeout(60_000)
      const big = Array.from(
        { length: 300 },
        (_, i) => `para ${i} line one\nline two of ${i}\nline three`,
      ).join('\n\n')
      await load(page, mode, true)
      await page.evaluate(
        (big) => (window as any).vditor.setValue(big, true),
        big,
      )
      const baseline = await value(page)
      // type while the rest of the document is still being chunked
      await caretAt(page, 'para 3 line one', 'para 3 line one'.length)
      await page.keyboard.type('Q')
      await page.waitForFunction(
        () => document.querySelectorAll('.vmarkd-softbreak').length === 600,
        undefined,
        { timeout: 20_000 },
      )
      const md = await value(page)
      expect(md).toBe(baseline.replace('para 3 line one', 'para 3 line oneQ'))
      expect(md).not.toBe(baseline)
    })
  })
}
