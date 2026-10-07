// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// Task 83 (increment 3) — the DOM half of the editor's soft-line-break reflow.
import {
  SOFTBREAK_SELECTOR,
  createChunkScheduler,
  unwrapSoftBreaks,
  withSelectionKept,
  wrapProseBlock,
  wrapTopBlock,
} from './soft-break'

function root(html: string): HTMLElement {
  document.body.innerHTML = `<pre class="vditor-reset" contenteditable="true">${html}</pre>`
  return document.body.firstElementChild as HTMLElement
}
const spans = (el: Element) => el.querySelectorAll(SOFTBREAK_SELECTOR).length

afterEach(() => {
  document.body.innerHTML = ''
  getSelection()?.removeAllRanges()
})

describe('wrapProseBlock', () => {
  it('wraps each non-trailing newline in a non-editable span and keeps the text', () => {
    const r = root('<p>one\ntwo\nthree</p>')
    expect(wrapTopBlock(r.firstElementChild as Element)).toBe(2)
    const p = r.firstElementChild as HTMLElement
    expect(spans(p)).toBe(2)
    const sp = p.querySelector(SOFTBREAK_SELECTOR) as HTMLElement
    expect(sp.getAttribute('contenteditable')).toBe('false')
    expect(sp.textContent).toBe('\n')
    expect(p.textContent).toBe('one\ntwo\nthree')
  })

  it('is idempotent', () => {
    const r = root('<p>a\nb</p>')
    wrapTopBlock(r.firstElementChild as Element)
    expect(wrapTopBlock(r.firstElementChild as Element)).toBe(0)
    expect(spans(r)).toBe(1)
  })

  it('skips a trailing newline (nothing but whitespace follows)', () => {
    const r = root('<p>one\n</p><p>two\n\n</p>')
    expect(wrapTopBlock(r.children[0])).toBe(0)
    expect(wrapTopBlock(r.children[1])).toBe(0)
  })

  it('wraps a newline that is followed only by a later inline element with text', () => {
    const r = root('<p>one\n<em>two</em></p>')
    expect(wrapTopBlock(r.firstElementChild as Element)).toBe(1)
  })

  it('counts an image after the newline as content', () => {
    const r = root('<p>one\n<img src="x.png"></p>')
    expect(wrapTopBlock(r.firstElementChild as Element)).toBe(1)
  })

  it('skips code, pre, math, html, markers, previews and data-render subtrees', () => {
    const r = root(
      [
        '<p>a <code>x\ny</code> b</p>',
        '<pre><code>l1\nl2</code></pre>',
        '<p><span data-type="math-inline">m\nn</span> t</p>',
        '<p><span class="vditor-ir__marker">`\n`</span>z</p>',
        '<div class="vditor-ir__preview"><p>p\nq</p></div>',
        '<p><span data-render="1">r\ns</span>z</p>',
      ].join(''),
    )
    for (const c of Array.from(r.children)) wrapTopBlock(c)
    expect(spans(r)).toBe(0)
  })

  it('leaves headings and table cells alone', () => {
    const r = root(
      '<h1>a\nb</h1><table><tbody><tr><td>c\nd</td></tr></tbody></table>',
    )
    for (const c of Array.from(r.children)) wrapTopBlock(c)
    expect(spans(r)).toBe(0)
  })

  it('does not treat the editable root <pre> as a skipped code zone', () => {
    const r = root('<p>a\nb</p>')
    expect(wrapProseBlock(r.firstElementChild as Element)).toBe(1)
  })

  it('does not flow content across a nested list: the parent item and the nested item are separate blocks', () => {
    const r = root('<ul><li>item\ncont<ul><li>nest\ned</li></ul></li></ul>')
    wrapTopBlock(r.firstElementChild as Element)
    expect(spans(r)).toBe(2)
    // the newline before the nested <ul> would be trailing: item text itself ends at the <ul>
    const r2 = root('<ul><li>item\n<ul><li>nested</li></ul></li></ul>')
    wrapTopBlock(r2.firstElementChild as Element)
    expect(spans(r2)).toBe(0)
  })

  it('does not wrap the newline of a callout title line, but wraps the body lines', () => {
    const r = root(
      '<blockquote><p>[!NOTE]\nbody one\nbody two</p></blockquote>',
    )
    wrapTopBlock(r.firstElementChild as Element)
    expect(spans(r)).toBe(1)
    expect((r.firstElementChild as HTMLElement).textContent).toBe(
      '[!NOTE]\nbody one\nbody two',
    )
  })

  it('does not wrap the newline that belongs to a hard break', () => {
    const r = root('<p>one<br data-marker="\\">\ntwo\nthree</p>')
    wrapTopBlock(r.firstElementChild as Element)
    expect(spans(r)).toBe(1)
  })

  it('leaves read-only (contenteditable=false) subtrees alone', () => {
    const r = root('<p><span contenteditable="false">a\nb</span> c</p>')
    wrapTopBlock(r.firstElementChild as Element)
    expect(spans(r)).toBe(0)
  })
})

describe('unwrapSoftBreaks', () => {
  it('restores the original text nodes', () => {
    const r = root('<p>one\ntwo\nthree</p>')
    wrapTopBlock(r.firstElementChild as Element)
    expect(unwrapSoftBreaks(r)).toBe(2)
    expect(spans(r)).toBe(0)
    const p = r.firstElementChild as HTMLElement
    expect(p.childNodes.length).toBe(1)
    expect(p.textContent).toBe('one\ntwo\nthree')
  })

  it('returns 0 and touches nothing when there are no spans', () => {
    const r = root('<p>a</p>')
    const before = r.innerHTML
    expect(unwrapSoftBreaks(r)).toBe(0)
    expect(r.innerHTML).toBe(before)
  })
})

describe('withSelectionKept', () => {
  function caretAt(r: HTMLElement, needle: string, delta: number) {
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const i = (w.currentNode as Text).data.indexOf(needle)
      if (i >= 0) {
        getSelection()?.collapse(w.currentNode, i + delta)
        return
      }
    }
    throw new Error('needle')
  }
  const charsBefore = (r: HTMLElement) => {
    const s = getSelection() as Selection
    const rg = document.createRange()
    rg.setStart(r, 0)
    rg.setEnd(s.anchorNode as Node, s.anchorOffset)
    return rg.toString().length
  }

  it('keeps a caret at the end of line 1 before the span, and after the break after it', () => {
    for (const delta of [3, 4, 6]) {
      const r = root('<p>one\ntwo\nthree</p>')
      caretAt(r, 'one', delta)
      const expected = delta
      withSelectionKept(r, () => wrapTopBlock(r.firstElementChild as Element))
      expect(charsBefore(r)).toBe(expected)
      const s = getSelection() as Selection
      expect(
        (s.anchorNode as Node).parentElement?.closest(SOFTBREAK_SELECTOR),
      ).toBeNull()
    }
  })

  it('puts a caret that was right after a break into the following text, not into the span', () => {
    const r = root('<p>one\ntwo</p>')
    caretAt(r, 'one', 4) // between "\n" and "two"
    wrapTopBlock(r.firstElementChild as Element)
    const s = getSelection() as Selection
    expect(s.anchorNode?.textContent).toBe('two')
    expect(s.anchorOffset).toBe(0)
  })

  it('survives an unwrap + normalize', () => {
    const r = root('<p>one\ntwo</p>')
    wrapTopBlock(r.firstElementChild as Element)
    caretAt(r, 'two', 2)
    withSelectionKept(r, () => {
      unwrapSoftBreaks(r)
      r.normalize()
    })
    const s = getSelection() as Selection
    expect(s.anchorNode?.textContent).toBe('one\ntwo')
    expect(s.anchorOffset).toBe(6)
  })

  it('keeps a ranged selection', () => {
    const r = root('<p>one\ntwo\nthree</p>')
    const t = (r.firstElementChild as HTMLElement).firstChild as Text
    getSelection()?.setBaseAndExtent(t, 1, t, 12)
    wrapTopBlock(r.firstElementChild as Element)
    expect(getSelection()?.toString()).toBe('ne\ntwo\nthre')
  })

  it('keeps an element endpoint in front of the same child (a caret between two <br>)', () => {
    const r = root('<p>one\ntwo<br data-marker="\\"><br></p>')
    const p = r.firstElementChild as HTMLElement
    getSelection()?.collapse(p, 2) // between the two <br>
    wrapTopBlock(p)
    const s = getSelection() as Selection
    expect(s.anchorNode).toBe(p)
    expect(s.anchorNode?.childNodes[s.anchorOffset]).toBe(p.lastChild)
    expect((p.lastChild as Element).tagName).toBe('BR')
    expect(s.anchorOffset).toBe(p.childNodes.length - 1)
  })

  it('re-writes the selection when the DOM was mutated even if the point is unchanged', () => {
    const r = root('<p>one\ntwo<br><br></p>')
    const p = r.firstElementChild as HTMLElement
    getSelection()?.collapse(p, p.childNodes.length) // end of the block: stays valid, may go stale
    const spy = vi.spyOn(Selection.prototype, 'setBaseAndExtent')
    try {
      wrapTopBlock(p)
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockClear()
      wrapTopBlock(p) // nothing left to wrap: no needless selection write
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('is a no-op when the selection is elsewhere', () => {
    const r = root('<p>a\nb</p>')
    expect(withSelectionKept(r, () => 42)).toBe(42)
  })
})

describe('createChunkScheduler', () => {
  function fakeClock() {
    let t = 0
    const queue: (() => void)[] = []
    return {
      now: () => t,
      advance: (ms: number) => (t += ms),
      schedule: (cb: () => void) => {
        queue.push(cb)
        return () => {
          const i = queue.indexOf(cb)
          if (i >= 0) queue.splice(i, 1)
        }
      },
      flush1: () => queue.shift()?.(),
      pending: () => queue.length,
    }
  }
  const els = (n: number) =>
    Array.from({ length: n }, () => {
      const e = document.createElement('p')
      document.body.append(e)
      return e
    })

  it('yields between chunks once the budget is spent and finishes in order', () => {
    const c = fakeClock()
    const seen: Element[] = []
    const s = createChunkScheduler(
      (b) => {
        seen.push(b)
        c.advance(2) // 2 ms per block, 5 ms budget -> 3 blocks per chunk
      },
      { budgetMs: 5, now: c.now, schedule: c.schedule },
    )
    const blocks = els(7)
    s.enqueue(blocks)
    expect(s.size()).toBe(7)
    c.flush1()
    expect(seen.length).toBe(3)
    expect(c.pending()).toBe(1)
    c.flush1()
    c.flush1()
    expect(seen).toEqual(blocks)
    expect(c.pending()).toBe(0)
    expect(s.size()).toBe(0)
  })

  it('always makes progress, even when one block exceeds the budget', () => {
    const c = fakeClock()
    let n = 0
    const s = createChunkScheduler(
      () => {
        n++
        c.advance(50)
      },
      { budgetMs: 5, now: c.now, schedule: c.schedule },
    )
    s.enqueue(els(3))
    c.flush1()
    expect(n).toBe(1)
  })

  it('skips blocks that were detached while queued', () => {
    const c = fakeClock()
    const seen: Element[] = []
    const s = createChunkScheduler((b) => seen.push(b), {
      now: c.now,
      schedule: c.schedule,
    })
    const [a, b2, d] = els(3)
    s.enqueue([a, b2, d])
    b2.remove()
    c.flush1()
    expect(seen).toEqual([a, d])
  })

  it('runNow runs one chunk synchronously and keeps the rest scheduled', () => {
    const c = fakeClock()
    const seen: Element[] = []
    const s = createChunkScheduler(
      (b) => {
        seen.push(b)
        c.advance(3)
      },
      { budgetMs: 5, now: c.now, schedule: c.schedule },
    )
    s.enqueue(els(5))
    s.runNow()
    expect(seen.length).toBe(2)
    expect(c.pending()).toBe(1)
  })

  it('cancel drops the queue and the pending callback', () => {
    const c = fakeClock()
    const seen: Element[] = []
    const s = createChunkScheduler((b) => seen.push(b), {
      now: c.now,
      schedule: c.schedule,
    })
    s.enqueue(els(3))
    s.cancel()
    expect(c.pending()).toBe(0)
    expect(s.size()).toBe(0)
    c.flush1()
    expect(seen).toEqual([])
  })
})
