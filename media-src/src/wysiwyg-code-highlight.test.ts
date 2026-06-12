// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flattenSourceHtml, positionAtOffset } from './wysiwyg-code-highlight'

describe('flattenSourceHtml', () => {
  it('unwraps token spans in a wysiwyg code source, leaving raw text', () => {
    const html =
      '<pre class="vditor-wysiwyg__pre"><code class="language-js hljs">' +
      '<span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>' +
      '</code></pre>'
    const out = flattenSourceHtml(html)
    expect(out).not.toContain('<span')
    expect(out).toContain('const a = 1')
  })

  it('strips the hljs class off the source code (Lute reads it as the fence info-string)', () => {
    const html =
      '<pre class="vditor-wysiwyg__pre"><code class="language-js hljs">const a = 1</code></pre>'
    const out = flattenSourceHtml(html)
    expect(out).toContain('class="language-js"')
    expect(out).not.toContain('hljs')
  })

  it('preserves the <wbr> caret marker while unwrapping', () => {
    const html =
      '<pre class="vditor-wysiwyg__pre"><code class="language-js hljs">' +
      '<span class="hljs-keyword">con<wbr>st</span> a' +
      '</code></pre>'
    const out = flattenSourceHtml(html)
    expect(out).toContain('<wbr>')
    expect(out).not.toContain('<span')
    // wbr stays at its caret position inside the (now unwrapped) text.
    expect(out).toContain('con<wbr>st a')
  })

  it('returns the input untouched when there is no wysiwyg code source (fast path)', () => {
    const html = '<p>just a <strong>paragraph</strong></p>'
    expect(flattenSourceHtml(html)).toBe(html)
  })

  it('does not touch the rendered preview, only the editable source', () => {
    // The preview keeps its spans (Lute ignores it); only the source `pre.vditor-wysiwyg__pre` is flattened.
    const html =
      '<pre class="vditor-wysiwyg__preview"><code class="language-js hljs"><span class="hljs-keyword">const</span></code></pre>'
    expect(flattenSourceHtml(html)).toBe(html)
  })
})

describe('positionAtOffset', () => {
  it('locates an offset within a single text node', () => {
    expect(positionAtOffset([11], 5)).toEqual([0, 5])
  })

  it('locates an offset in a later node after a boundary', () => {
    // nodes of length 5 and 6 (total 11); offset 8 → node 1, local offset 3.
    expect(positionAtOffset([5, 6], 8)).toEqual([1, 3])
    expect(positionAtOffset([5, 6], 5)).toEqual([1, 0])
  })

  it('clamps past-the-end offsets to the last node', () => {
    expect(positionAtOffset([4], 99)).toEqual([0, 4])
  })

  it('clamps negatives to the start and handles no nodes', () => {
    expect(positionAtOffset([4], -3)).toEqual([0, 0])
    expect(positionAtOffset([], 5)).toEqual([0, 0])
  })
})
