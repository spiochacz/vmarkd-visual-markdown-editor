// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// Task 83 (increment 2) — the preview half of vmarkd.editor.reflowLineBreaks.
import {
  applyReflowLineBreaks,
  getReflowLineBreaks,
  previewMd2Html,
  rerenderOpenPreview,
  resetReflowLineBreaksForTest,
} from './reflow-line-breaks'

// A fake Lute that renders `a\nb` the way the real one does: <br> while SoftBreak2HardBreak is on.
function fakeLute() {
  let hard = true
  return {
    calls: [] as boolean[],
    SetSoftBreak2HardBreak(v: boolean) {
      hard = v
      this.calls.push(v)
    },
    Md2HTML(md: string) {
      return `<p>${md.replace('\n', hard ? '<br />\n' : '\n')}</p>`
    },
  }
}

afterEach(() => {
  resetReflowLineBreaksForTest()
  document.body.innerHTML = ''
  delete (window as any).vditor
})

describe('applyReflowLineBreaks', () => {
  it('is unset until the first apply (harnesses keep stock Lute)', () => {
    expect(getReflowLineBreaks()).toBeUndefined()
  })

  it('treats undefined as the default (true) and false as off', () => {
    applyReflowLineBreaks(undefined)
    expect(getReflowLineBreaks()).toBe(true)
    applyReflowLineBreaks(false)
    expect(getReflowLineBreaks()).toBe(false)
    applyReflowLineBreaks(true)
    expect(getReflowLineBreaks()).toBe(true)
  })

  it('returns whether the value changed', () => {
    expect(applyReflowLineBreaks(true)).toBe(true)
    expect(applyReflowLineBreaks(true)).toBe(false)
    expect(applyReflowLineBreaks(false)).toBe(true)
  })
})

describe('previewMd2Html', () => {
  it('is stock Lute while the setting was never applied', () => {
    const lute = fakeLute()
    expect(previewMd2Html(lute, 'a\nb')).toBe('<p>a<br />\nb</p>')
    expect(lute.calls).toEqual([])
  })

  it('reflows (no <br>) when on, then restores the Lute default', () => {
    const lute = fakeLute()
    applyReflowLineBreaks(true)
    expect(previewMd2Html(lute, 'a\nb')).toBe('<p>a\nb</p>')
    expect(lute.calls).toEqual([false, true])
  })

  it('keeps every source line on its own line (<br>) when off', () => {
    const lute = fakeLute()
    applyReflowLineBreaks(false)
    expect(previewMd2Html(lute, 'a\nb')).toBe('<p>a<br />\nb</p>')
  })

  it('restores the default even when Md2HTML throws', () => {
    const lute = fakeLute()
    lute.Md2HTML = () => {
      throw new Error('boom')
    }
    applyReflowLineBreaks(true)
    expect(() => previewMd2Html(lute, 'x')).toThrow('boom')
    expect(lute.calls).toEqual([false, true])
  })
})

describe('rerenderOpenPreview', () => {
  function mount(display: string) {
    const render = vi.fn()
    const inner = {
      preview: { element: document.createElement('div'), render },
    }
    inner.preview.element.style.display = display
    ;(window as any).vditor = { vditor: inner }
    return { render, inner }
  }

  it('re-renders a visible preview with the inner instance', () => {
    const { render, inner } = mount('block')
    rerenderOpenPreview()
    expect(render).toHaveBeenCalledWith(inner)
  })

  it('leaves a hidden preview alone', () => {
    const { render } = mount('none')
    rerenderOpenPreview()
    expect(render).not.toHaveBeenCalled()
  })

  it('is a no-op before the editor exists', () => {
    expect(() => rerenderOpenPreview()).not.toThrow()
  })
})
