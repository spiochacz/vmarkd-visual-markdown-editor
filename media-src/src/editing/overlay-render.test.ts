// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  highlightPreviewCode,
  type HljsLike,
  type KatexLike,
  renderPreviewMath,
} from './overlay-render'

// Task 532 step 4 — the overlay's synchronous hljs / KaTeX passes, against fakes. The real builds on
// the real canonical document are exercised by content-decorators.test.ts.

const dom = (html: string): HTMLElement => {
  document.body.innerHTML = html
  return document.body
}

describe('highlightPreviewCode', () => {
  const hljs = (known: string[]): HljsLike => ({
    getLanguage: (n) => (known.includes(n) ? {} : undefined),
    highlight: vi.fn((code, { language }) => ({
      value: `<span class="hljs-x">${language}:${code}</span>`,
    })),
  })

  it('highlights a rendered fence, tags .hljs, and falls back to plaintext for an unknown language', () => {
    const root = dom(
      '<pre><code class="language-ts">a</code></pre><pre><code class="language-nope">b</code></pre>',
    )
    highlightPreviewCode(root, hljs(['ts']))
    const [a, b] = Array.from(root.querySelectorAll('code'))
    expect(a.innerHTML).toBe('<span class="hljs-x">ts:a</span>')
    expect(b.innerHTML).toBe('<span class="hljs-x">plaintext:b</span>')
    expect(a.classList.contains('hljs') && b.classList.contains('hljs')).toBe(
      true,
    )
  })

  it('leaves editable sources, diagram / math languages and finished blocks alone', () => {
    const h = hljs(['ts', 'mermaid'])
    const root = dom(
      '<pre class="vditor-ir__marker--pre"><code class="language-ts">s</code></pre>' +
        '<pre class="vditor-wysiwyg__pre"><code class="language-ts">w</code></pre>' +
        '<pre><code class="language-mermaid">m</code></pre>' +
        '<pre><code class="language-math">x</code></pre>' +
        '<pre><code class="language-ts hljs">done</code></pre>',
    )
    highlightPreviewCode(root, h)
    expect(h.highlight).not.toHaveBeenCalled()
  })

  it('is a no-op without hljs', () => {
    const root = dom('<pre><code class="language-ts">a</code></pre>')
    highlightPreviewCode(root, undefined)
    expect(root.querySelector('.hljs')).toBeNull()
  })
})

describe('renderPreviewMath', () => {
  const katex: KatexLike = {
    renderToString: vi.fn((m, { displayMode }) =>
      m === 'bad'
        ? (() => {
            throw new Error('KaTeX parse error')
          })()
        : `<k data-display="${displayMode}">${m}</k>`,
    ),
  }

  it('typesets block (display) and inline math once, recording the TeX in data-math', () => {
    const root = dom(
      '<div class="language-math">a b</div><span class="language-math">c</span>',
    )
    renderPreviewMath(root, katex)
    const [block, inline] = Array.from(root.querySelectorAll('.language-math'))
    expect(block.innerHTML).toBe('<k data-display="true">a b</k>')
    expect(block.getAttribute('data-math')).toBe('a b')
    expect(inline.innerHTML).toBe('<k data-display="false">c</k>')
    renderPreviewMath(root, katex)
    expect(katex.renderToString).toHaveBeenCalledTimes(2)
  })

  it('shows the error text like Vditor on a bad formula, and skips editable sources', () => {
    const root = dom(
      '<div class="language-math">bad</div>' +
        '<pre class="vditor-ir__marker--pre"><code class="language-math">raw</code></pre>',
    )
    renderPreviewMath(root, katex)
    const bad = root.querySelector('div.language-math') as HTMLElement
    expect(bad.textContent).toBe('KaTeX parse error')
    expect(bad.className).toBe('language-math vditor-reset--error')
    expect(root.querySelector('code')?.textContent).toBe('raw')
  })

  it('is a no-op without KaTeX', () => {
    const root = dom('<div class="language-math">x</div>')
    renderPreviewMath(root, undefined)
    expect(root.querySelector('[data-math]')).toBeNull()
  })
})
