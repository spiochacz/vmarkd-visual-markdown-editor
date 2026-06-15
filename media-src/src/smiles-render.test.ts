// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairSmiles } from './smiles-render'

// Stub smiles-drawer: record what code it's asked to draw, and drop a child into the target svg so
// the "rendered" check (svg has content) reflects a successful draw.
function stubDrawer(): { drawn: Array<{ code: string; theme?: string }> } {
  const drawn: Array<{ code: string; theme?: string }> = []
  class SmiDrawer {
    draw(code: string, selector: string, theme?: string) {
      drawn.push({ code, theme })
      const svg = document.querySelector(selector)
      if (svg)
        svg.appendChild(
          document.createElementNS('http://www.w3.org/2000/svg', 'g'),
        )
    }
  }
  ;(window as unknown as { SmiDrawer: unknown }).SmiDrawer = SmiDrawer
  return { drawn }
}

afterEach(() => {
  document.body.innerHTML = ''
  ;(window as unknown as { SmiDrawer?: unknown }).SmiDrawer = undefined
})

// A WYSIWYG smiles block whose preview SVG was flattened to its <style> text (the bug), with the
// editable source still holding the real SMILES.
function brokenWysiwygBlock(smiles: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'vditor-wysiwyg'
  root.innerHTML = `
    <div class="vditor-wysiwyg__block" data-type="code-block">
      <pre class="vditor-wysiwyg__pre" style="display:none"><code class="language-smiles">${smiles}</code></pre>
      <pre class="vditor-wysiwyg__preview" data-render="1"><code class="language-smiles" data-processed="true">.element { font: 11pt Arial; } .sub { font: 3pt Arial; }</code></pre>
    </div>`
  document.body.appendChild(root)
  return root
}

describe('repairSmiles', () => {
  it('re-draws a flattened preview from the editable source SMILES', () => {
    const { drawn } = stubDrawer()
    const root = brokenWysiwygBlock('CN1C=NC2=C1C(=O)N(C(=O)N2C)C')
    repairSmiles(root, false)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].code).toBe('CN1C=NC2=C1C(=O)N(C(=O)N2C)C') // source, NOT the style-text
    expect(
      root.querySelector('.vditor-wysiwyg__preview > code.language-smiles svg'),
    ).not.toBeNull()
  })

  it('passes the dark theme through', () => {
    const { drawn } = stubDrawer()
    repairSmiles(brokenWysiwygBlock('CCO'), true)
    expect(drawn[0].theme).toBe('dark')
  })

  it('skips a preview that already holds an svg (idempotent — no loop)', () => {
    const { drawn } = stubDrawer()
    const root = document.createElement('div')
    root.innerHTML = `<pre class="vditor-wysiwyg__preview"><code class="language-smiles"><svg></svg></code></pre>`
    repairSmiles(root, false)
    expect(drawn).toHaveLength(0)
  })

  it('is a no-op when smiles-drawer has not loaded yet (no throw)', () => {
    const root = brokenWysiwygBlock('CCO')
    expect(() => repairSmiles(root, false)).not.toThrow()
    expect(
      root.querySelector('.vditor-wysiwyg__preview > code.language-smiles svg'),
    ).toBeNull()
  })

  it('does not redraw using flattened style-text when there is no source', () => {
    const { drawn } = stubDrawer()
    const root = document.createElement('div')
    // a preview with flattened style-text and NO source sibling → nothing safe to draw
    root.innerHTML = `<pre class="vditor-ir__preview"><code class="language-smiles">.element { font: 11pt Arial; }</code></pre>`
    repairSmiles(root, false)
    expect(drawn).toHaveLength(0)
  })
})
