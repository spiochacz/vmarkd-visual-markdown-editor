// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyDiagramPlaceholders,
  measureDiagramSize,
  PLACEHOLDER_CLASS,
  PLACEHOLDER_SIZED_CLASS,
} from './diagram-placeholder'

// Task 532 step 5c — the overlay's stand-in for a diagram, and the measurement that feeds it.

const dom = (html: string): HTMLElement => {
  document.body.innerHTML = html
  return document.body
}
const mermaid = (attrs = '') =>
  `<pre class="vditor-ir__preview" data-render="2"${attrs}><div class="language-mermaid">graph TD\n A --&gt; B</div></pre>`

describe('applyDiagramPlaceholders', () => {
  it('empties the raw source of a diagram and marks the preview', () => {
    const root = dom(mermaid())
    applyDiagramPlaceholders(root)
    const pre = root.querySelector('pre') as HTMLElement
    expect(pre.classList.contains(PLACEHOLDER_CLASS)).toBe(true)
    expect(pre.classList.contains(PLACEHOLDER_SIZED_CLASS)).toBe(false)
    expect(pre.textContent).toBe('')
    expect((pre.firstElementChild as HTMLElement).style.cssText).toBe('')
  })

  it('reserves the recorded size: the ratio carries the wrapper pad, the width is capped at w', () => {
    const root = dom(mermaid(' data-vmarkd-dsize="159.6,278,6"'))
    applyDiagramPlaceholders(root)
    const pre = root.querySelector('pre') as HTMLElement
    const box = pre.firstElementChild as HTMLElement
    expect(pre.classList.contains(PLACEHOLDER_SIZED_CLASS)).toBe(true)
    expect(box.style.getPropertyValue('--vmarkd-dw')).toBe('159.6')
    expect(box.style.getPropertyValue('--vmarkd-dh')).toBe('284')
    expect(pre.textContent).toBe('')
  })

  it('handles a <code>-wrapped diagram and a WYSIWYG preview', () => {
    const root = dom(
      '<pre class="vditor-wysiwyg__preview" data-render="2"><code class="language-d2">a -&gt; b</code></pre>',
    )
    applyDiagramPlaceholders(root)
    expect(
      root.querySelector('pre')?.classList.contains(PLACEHOLDER_CLASS),
    ).toBe(true)
    expect(root.querySelector('code')?.textContent).toBe('')
  })

  it('leaves ordinary code, math and the editable source alone', () => {
    const html =
      '<pre class="vditor-ir__preview" data-render="2"><code class="language-ts">const a = 1</code></pre>' +
      '<pre class="vditor-ir__preview" data-render="2"><code class="language-math">x^2</code></pre>' +
      '<pre class="vditor-ir__marker--pre vditor-ir__marker"><code class="language-mermaid">graph TD</code></pre>'
    const root = dom(html)
    applyDiagramPlaceholders(root)
    expect(root.innerHTML).toBe(html)
  })

  it('is idempotent', () => {
    const root = dom(mermaid(' data-vmarkd-dsize="100,50,6"'))
    applyDiagramPlaceholders(root)
    const once = root.innerHTML
    applyDiagramPlaceholders(root)
    expect(root.innerHTML).toBe(once)
  })
})

describe('measureDiagramSize', () => {
  const rect = (width: number, height: number) => ({ width, height }) as DOMRect
  const mount = (svgBox: DOMRect, wrapperBox: DOMRect) => {
    const root = dom('<div class="language-d2"><svg></svg></div>')
    const wrapper = root.firstElementChild as HTMLElement
    wrapper.getBoundingClientRect = () => wrapperBox
    wrapper.querySelector('svg')!.getBoundingClientRect = () => svgBox
    return wrapper
  }

  it('is the svg box plus what the wrapper adds around it', () => {
    expect(
      measureDiagramSize(mount(rect(117.04, 250), rect(1176, 256))),
    ).toEqual([117, 250, 6])
  })

  it('has nothing to say while there is no svg or no layout', () => {
    expect(
      measureDiagramSize(dom('<div></div>').firstElementChild as HTMLElement),
    ).toBeUndefined()
    expect(measureDiagramSize(mount(rect(0, 0), rect(0, 0)))).toBeUndefined()
  })
})

describe('measureDiagramSize - natural size', () => {
  const rect = (width: number, height: number) => ({ width, height }) as DOMRect
  const mountSvg = (svgAttrs: string, svgBox: DOMRect, wrapperBox: DOMRect) => {
    const root = dom(`<div class="language-d2"><svg ${svgAttrs}></svg></div>`)
    const wrapper = root.firstElementChild as HTMLElement
    wrapper.getBoundingClientRect = () => wrapperBox
    wrapper.querySelector('svg')!.getBoundingClientRect = () => svgBox
    return wrapper
  }

  it('a narrow pane still stores the natural width (not the shrunk box)', () => {
    // natural 800x400 (width/height attrs), but this pane squeezed it to 300x150
    expect(
      measureDiagramSize(
        mountSvg('width="800" height="400"', rect(300, 150), rect(300, 156)),
      ),
    ).toEqual([800, 400, 6])
  })

  it('reads the viewBox when width/height are relative', () => {
    expect(
      measureDiagramSize(
        mountSvg(
          'width="100%" viewBox="0 0 640 320"',
          rect(300, 150),
          rect(300, 156),
        ),
      ),
    ).toEqual([640, 320, 6])
  })

  it('converts pt to px', () => {
    expect(
      measureDiagramSize(
        mountSvg('width="60pt" height="30pt"', rect(80, 40), rect(80, 40)),
      ),
    ).toEqual([80, 40, 0])
  })

  it('never returns a zero: a hidden block measures to nothing even with an intrinsic size', () => {
    expect(
      measureDiagramSize(
        mountSvg('width="800" height="400"', rect(0, 0), rect(0, 0)),
      ),
    ).toBeUndefined()
  })
})
