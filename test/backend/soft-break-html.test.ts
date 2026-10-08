import { describe, expect, it } from 'vitest'
import { wrapSoftBreaksInHtml } from '../../src/shared/soft-break-html'

// Task 83 (increment 5) — the string transform behind the open-time overlay. Parity with the DOM
// wrapper over a wide corpus lives in media-src/src/editing/soft-break-html-parity.test.ts; these pin
// the exact output shape and the pass-through guarantees.
const SPAN = '<span class="vmarkd-softbreak" contenteditable="false">\n</span>'

describe('wrapSoftBreaksInHtml', () => {
  it('wraps each non-trailing newline of a paragraph in a marker span', () => {
    expect(wrapSoftBreaksInHtml('<p data-block="0">a\nb\nc</p>')).toBe(
      `<p data-block="0">a${SPAN}b${SPAN}c</p>`,
    )
  })

  it('leaves a trailing newline, code and a hard break alone', () => {
    const html = '<p>a\n</p><pre><code>x\ny</code></pre><p>a<br />\nb</p>'
    expect(wrapSoftBreaksInHtml(html)).toBe(html)
  })

  it('returns a document with no newline byte for byte (same reference-equal string)', () => {
    const html = '<p>one line</p><h1>t</h1>'
    expect(wrapSoftBreaksInHtml(html)).toBe(html)
  })

  it('is idempotent', () => {
    const once = wrapSoftBreaksInHtml(
      '<p>a\nb</p><blockquote><p>c\nd</p></blockquote>',
    )
    expect(wrapSoftBreaksInHtml(once)).toBe(once)
  })

  it('keeps the markup well formed on unbalanced input instead of throwing', () => {
    expect(() => wrapSoftBreaksInHtml('<p>a\nb</span><em>c\nd')).not.toThrow()
  })
})
