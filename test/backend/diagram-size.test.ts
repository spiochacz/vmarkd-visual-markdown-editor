// Task 532 step 5c — the size key and the host-side overlay tagging, shared by both trees.
import { describe, expect, it } from 'vitest'
import {
  annotateDiagramSizes,
  DIAGRAM_SIZE_ATTR,
  type DiagramSize,
  diagramSizeKey,
  isDiagramSize,
  parseDiagramSizeAttr,
} from '../../src/shared/diagram-size'

describe('diagramSizeKey', () => {
  it('is stable, 16 hex chars, and ignores surrounding whitespace and CRLF', () => {
    const k = diagramSizeKey('mermaid', 'graph TD\n  A --> B')
    expect(k).toMatch(/^[0-9a-f]{16}$/)
    expect(diagramSizeKey('mermaid', '\n graph TD\r\n  A --> B \n\n')).toBe(k)
  })

  it('separates language from source (NUL-joined, like hashOf)', () => {
    expect(diagramSizeKey('d2', 'x')).not.toBe(diagramSizeKey('dd', '2\u0000x'))
    expect(diagramSizeKey('d2', 'x')).not.toBe(diagramSizeKey('mermaid', 'x'))
    expect(diagramSizeKey('d2', 'a')).not.toBe(diagramSizeKey('d2', 'b'))
  })
})

describe('DiagramSize guards', () => {
  it('accepts a measured box and rejects the unmeasurable', () => {
    expect(isDiagramSize([120, 80, 6])).toBe(true)
    expect(isDiagramSize([120, 80, 0])).toBe(true)
    for (const bad of [
      [0, 80, 6],
      [120, 0, 6],
      [120, 80, -1],
      [Number.NaN, 80, 6],
      [120, 80],
      'x',
      null,
    ])
      expect(isDiagramSize(bad), JSON.stringify(bad)).toBe(false)
  })

  it('parses the attribute form', () => {
    expect(parseDiagramSizeAttr('120,80,6')).toEqual([120, 80, 6])
    expect(parseDiagramSizeAttr('120,80')).toBeUndefined()
    expect(parseDiagramSizeAttr('a,b,c')).toBeUndefined()
    expect(parseDiagramSizeAttr(null)).toBeUndefined()
  })
})

describe('annotateDiagramSizes', () => {
  const mermaid = 'graph TD\n  A[X] --> B["a < b & c"]\n'
  const irMermaid = `<pre class="vditor-ir__preview" data-render="2"><div class="language-mermaid">graph TD\n  A[X] --&gt; B[&quot;a &lt; b &amp; c&quot;]\n</div></pre>`
  const irD2 = `<pre class="vditor-ir__preview" data-render="2"><code class="language-d2">a -&gt; b\n</code></pre>`
  const wysiwygMermaid = irMermaid.replace(
    'vditor-ir__preview',
    'vditor-wysiwyg__preview',
  )
  const sizes = new Map<string, DiagramSize>([
    [diagramSizeKey('mermaid', mermaid), [160, 278, 6]],
    [diagramSizeKey('d2', 'a -> b'), [117, 250, 6]],
  ])
  const lookup = (key: string) => sizes.get(key)

  it('tags a div-wrapped diagram, with the entity-escaped source decoded before keying', () => {
    expect(annotateDiagramSizes(irMermaid, lookup)).toBe(
      irMermaid.replace(
        'data-render="2"',
        `data-render="2" ${DIAGRAM_SIZE_ATTR}="160,278,6"`,
      ),
    )
  })

  it('tags a code-wrapped diagram and a WYSIWYG preview', () => {
    expect(annotateDiagramSizes(irD2, lookup)).toContain(
      `${DIAGRAM_SIZE_ATTR}="117,250,6"`,
    )
    expect(annotateDiagramSizes(wysiwygMermaid, lookup)).toContain(
      `${DIAGRAM_SIZE_ATTR}="160,278,6"`,
    )
  })

  it('leaves a diagram with no recorded size and an ordinary code fence untouched', () => {
    const code = `<pre class="vditor-ir__preview" data-render="2"><code class="language-ts">const a = 1\n</code></pre>`
    const other = irMermaid.replace('A[X]', 'A[Y]')
    expect(annotateDiagramSizes(code, lookup)).toBe(code)
    expect(annotateDiagramSizes(other, lookup)).toBe(other)
  })

  it('tags several diagrams in one document and touches nothing else', () => {
    const doc = `<p>before</p>${irMermaid}<p>between</p>${irD2}<p>after</p>`
    const out = annotateDiagramSizes(doc, lookup)
    expect(out.match(new RegExp(DIAGRAM_SIZE_ATTR, 'g'))).toHaveLength(2)
    expect(
      out.replace(new RegExp(` ${DIAGRAM_SIZE_ATTR}="[^"]*"`, 'g'), ''),
    ).toBe(doc)
  })
})
