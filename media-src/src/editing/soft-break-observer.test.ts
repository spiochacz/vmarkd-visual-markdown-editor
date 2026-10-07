// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Task 83 (increment 3) — the observer / structural-key / live-toggle wiring around soft-break.ts.
import {
  applyReflowLineBreaks,
  resetReflowLineBreaksForTest,
} from './reflow-line-breaks'
import { SOFTBREAK_SELECTOR } from './soft-break'
import { observeSoftBreaks, orderViewportFirst } from './soft-break-observer'

let app: HTMLElement
let root: HTMLElement
let dispose: (() => void) | null = null

const flush = () => new Promise<void>((r) => setTimeout(r, 0))
const spans = () => root.querySelectorAll(SOFTBREAK_SELECTOR).length

function mount(html: string, reflow: boolean | null = true) {
  document.body.innerHTML = `<div id="app"><div class="vditor-ir"><pre class="vditor-reset" contenteditable="true">${html}</pre></div></div>`
  app = document.getElementById('app') as HTMLElement
  root = app.querySelector('.vditor-reset') as HTMLElement
  if (reflow !== null) applyReflowLineBreaks(reflow)
  dispose = observeSoftBreaks(app, () => root)
}

function caretIn(needle: string, delta: number) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const i = (w.currentNode as Text).data.indexOf(needle)
    if (i >= 0) {
      getSelection()?.collapse(w.currentNode, i + delta)
      return
    }
  }
  throw new Error('needle')
}

function key(k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  root.dispatchEvent(e)
  return e
}

beforeEach(() => {
  resetReflowLineBreaksForTest()
})
afterEach(async () => {
  dispose?.()
  dispose = null
  await flush()
  document.body.innerHTML = ''
  getSelection()?.removeAllRanges()
  resetReflowLineBreaksForTest()
})

describe('observeSoftBreaks', () => {
  it('decorates the initial document (first chunk synchronously, the rest on idle)', async () => {
    mount('<p>a\nb</p><p>c\nd</p>')
    expect(spans()).toBeGreaterThanOrEqual(1)
    await vi.waitFor(() => expect(spans()).toBe(2))
  })

  it('does nothing until the setting has been applied (unset = stock behaviour)', async () => {
    mount('<p>a\nb</p>', null)
    await flush()
    expect(spans()).toBe(0)
  })

  it('re-wraps a block the editor replaced (the per-keystroke spin)', async () => {
    mount('<p>a\nb</p>')
    await flush()
    root.firstElementChild?.remove()
    root.insertAdjacentHTML('afterbegin', '<p>x\ny\nz</p>')
    await flush()
    expect(spans()).toBe(2)
  })

  it('re-wraps after text typed into a block', async () => {
    mount('<p>a\nb</p>')
    await flush()
    const p = root.firstElementChild as HTMLElement
    p.insertBefore(document.createTextNode('new\nline'), p.firstChild)
    await flush()
    expect(spans()).toBe(2)
  })

  it('only touches the mutated block (a new unrelated block elsewhere stays as the editor left it)', async () => {
    mount('<p>a\nb</p><p>c</p>')
    await flush()
    const before = root.children[0].innerHTML
    ;(root.children[1] as HTMLElement).append('!')
    await flush()
    expect(root.children[0].innerHTML).toBe(before)
  })

  it('decorates a bulk replacement in idle chunks', async () => {
    mount('<p>x</p>')
    await flush()
    root.innerHTML = Array.from(
      { length: 20 },
      (_, i) => `<p>l${i}\nm${i}</p>`,
    ).join('')
    await vi.waitFor(() => expect(spans()).toBe(20))
  })

  it('a live flip off unwraps every span and keeps the text; on re-wraps', async () => {
    mount('<p>a\nb</p><p>c\nd</p>')
    await flush()
    await flush()
    applyReflowLineBreaks(false)
    expect(spans()).toBe(0)
    expect(root.textContent).toBe('a\nbc\nd')
    applyReflowLineBreaks(true)
    await flush()
    await flush()
    expect(spans()).toBe(2)
  })

  it('ignores mutations while the setting is off', async () => {
    mount('<p>a</p>', false)
    root.firstElementChild?.append('\nb')
    await flush()
    expect(spans()).toBe(0)
  })

  it('moves a caret that landed inside a span to just after it', async () => {
    mount('<p>one\ntwo</p>')
    await flush()
    const span = root.querySelector(SOFTBREAK_SELECTOR) as HTMLElement
    getSelection()?.collapse(span.firstChild, 1)
    document.dispatchEvent(new Event('selectionchange'))
    const s = getSelection() as Selection
    expect(s.anchorNode?.textContent).toBe('two')
    expect(s.anchorOffset).toBe(0)
  })

  describe('structural keys', () => {
    it('Enter unwraps the caret block before the editor sees the key, then re-wraps on a macrotask', async () => {
      mount('<p>one\ntwo</p><p>x\ny</p>')
      await flush()
      await flush()
      caretIn('two', 0)
      const seen: number[] = []
      root.addEventListener('keydown', () => seen.push(spans()))
      key('Enter')
      // window capture ran first: the caret block is plain, the other block untouched
      expect(seen).toEqual([1])
      expect((getSelection() as Selection).anchorNode?.textContent).toBe(
        'one\ntwo',
      )
      expect((getSelection() as Selection).anchorOffset).toBe(4)
      await flush()
      await flush()
      expect(spans()).toBe(2)
    })

    it('holds the observer off until the macrotask (no re-wrap between our listener and the editor)', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('two', 0)
      key('Enter')
      // the editor splits the paragraph in its own keydown handler
      root.firstElementChild?.insertAdjacentHTML(
        'afterend',
        '<p>third\nline</p>',
      )
      await Promise.resolve()
      expect(spans()).toBe(0)
      await flush()
      await flush()
      expect(spans()).toBe(2)
    })

    it('Shift+Enter unwraps too (hard-break-key runs after window capture)', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('one', 3)
      key('Enter', { shiftKey: true })
      expect(spans()).toBe(0)
      await flush()
    })

    it('Ctrl/Cmd+Enter is not a structural key', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('two', 0)
      key('Enter', { ctrlKey: true })
      expect(spans()).toBe(1)
    })

    it('Backspace at the start of a line unwraps; mid-word Backspace does not', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('two', 1)
      key('Backspace')
      expect(spans()).toBe(1)
      caretIn('two', 0)
      key('Backspace')
      expect(spans()).toBe(0)
      await flush()
    })

    it('Delete at the end of a line unwraps; mid-word Delete does not', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('one', 1)
      key('Delete')
      expect(spans()).toBe(1)
      caretIn('one', 3)
      key('Delete')
      expect(spans()).toBe(0)
      await flush()
    })

    it('Backspace over a selection unwraps', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      const t = root.querySelector('p')?.firstChild as Text
      getSelection()?.setBaseAndExtent(t, 1, t, 2)
      key('Backspace')
      expect(spans()).toBe(0)
      await flush()
    })

    it('ignores other keys and keys while the setting is off', async () => {
      mount('<p>one\ntwo</p>')
      await flush()
      caretIn('two', 0)
      key('a')
      expect(spans()).toBe(1)
      applyReflowLineBreaks(false)
      key('Enter')
      expect(spans()).toBe(0)
      await flush()
    })

    it('two structural keys before the release re-decorate both blocks', async () => {
      mount('<p>one\ntwo</p><p>x\ny</p>')
      await flush()
      await flush()
      caretIn('two', 0)
      key('Backspace')
      caretIn('y', 0)
      key('Backspace')
      expect(spans()).toBe(0)
      await flush()
      expect(spans()).toBe(2)
    })

    it('keeps the selection endpoints across a multi-block unwrap', async () => {
      mount('<p>one\ntwo</p><p>x\ny</p>')
      await flush()
      await flush()
      const first = root.children[0].lastChild as Text // "two"
      const last = root.children[1].lastChild as Text // "y"
      getSelection()?.setBaseAndExtent(first, 1, last, 1)
      key('Backspace')
      expect(spans()).toBe(0)
      expect(getSelection()?.toString()).toBe('wox\ny')
      await flush()
    })
  })

  describe('IME composition', () => {
    it('a chunk run during composition defers the caret block until compositionend', async () => {
      mount('<p>one\ntwo</p><p>x\ny</p>')
      await flush()
      applyReflowLineBreaks(false)
      root.tabIndex = 0 // the caret block is only read while the editor is focused
      root.focus()
      caretIn('two', 1)
      document.dispatchEvent(new Event('compositionstart'))
      applyReflowLineBreaks(true) // re-decorates the whole surface in chunks
      await vi.waitFor(() =>
        expect(
          root.children[1].querySelectorAll(SOFTBREAK_SELECTOR).length,
        ).toBe(1),
      )
      expect(root.children[0].querySelectorAll(SOFTBREAK_SELECTOR).length).toBe(
        0,
      )
      document.dispatchEvent(new Event('compositionend'))
      await flush()
      expect(spans()).toBe(2)
    })

    it('does not split nodes while composing; decorates after compositionend', async () => {
      mount('<p>a</p>')
      await flush()
      document.dispatchEvent(new Event('compositionstart'))
      root.firstElementChild?.append('\nb')
      await flush()
      expect(spans()).toBe(0)
      document.dispatchEvent(new Event('compositionend'))
      await flush()
      await flush()
      expect(spans()).toBe(1)
    })
  })

  it('dispose detaches the key handler and the observer', async () => {
    mount('<p>one\ntwo</p>')
    await flush()
    caretIn('two', 0)
    dispose?.()
    dispose = null
    key('Enter')
    expect(spans()).toBe(1)
    root.firstElementChild?.append('\nq')
    await flush()
    expect(root.querySelectorAll(SOFTBREAK_SELECTOR).length).toBe(1)
  })

  it('ignores mutations outside the IR / WYSIWYG roots', async () => {
    mount('<p>a</p>')
    const other = document.createElement('div')
    other.className = 'vditor-preview'
    other.innerHTML = '<div class="vditor-reset"><p>x\ny</p></div>'
    app.append(other)
    await flush()
    await flush()
    expect(other.querySelectorAll(SOFTBREAK_SELECTOR).length).toBe(0)
  })
})

describe('orderViewportFirst', () => {
  function blocks(tops: number[]) {
    return tops.map((top) => {
      const el = document.createElement('p')
      el.getBoundingClientRect = () =>
        ({ top, bottom: top + 20, height: 20 }) as DOMRect
      return el
    })
  }

  it('puts the on-screen blocks first, then below, then above', () => {
    // viewport 0..100 (scrolled): blocks 3,4,5 are visible
    const b = blocks([-60, -40, -20, 0, 30, 60, 100, 140, 180])
    const names = new Map<Element, number>(b.map((e, i) => [e, i]))
    const order = orderViewportFirst(b, 100).map((e) => names.get(e))
    expect(order).toEqual([3, 4, 5, 6, 7, 8, 0, 1, 2])
  })

  it('keeps document order when everything is below the fold', () => {
    const b = blocks([200, 220, 240])
    expect(orderViewportFirst(b, 100)).toEqual(b)
  })

  it('returns tiny inputs untouched', () => {
    const b = blocks([0])
    expect(orderViewportFirst(b, 100)).toBe(b)
  })
})

vi.setConfig({ testTimeout: 10_000 })
