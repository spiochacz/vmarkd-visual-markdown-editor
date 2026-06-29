// @vitest-environment jsdom
import { expect, test } from 'vitest'
import {
  diagramErrorHtml,
  diagramErrorTitle,
  renderDiagramError,
} from './diagram-error'

test('diagramErrorTitle maps slugs to human titles, falls back to the slug', () => {
  expect(diagramErrorTitle('vega-lite')).toBe('Vega-Lite')
  expect(diagramErrorTitle('plantuml')).toBe('PlantUML')
  expect(diagramErrorTitle('nomnoml')).toBe('nomnoml')
  expect(diagramErrorTitle('something-unknown')).toBe('something-unknown')
})

test('diagramErrorHtml builds the themed box: title + <pre> message', () => {
  const html = diagramErrorHtml('graphviz', 'syntax error in line 2')
  expect(html).toContain('class="vmarkd-diagram-error"')
  expect(html).toContain('data-render="1"') // Lute-invisible insurance
  expect(html).toContain(
    '<div class="vmarkd-diagram-error__title">Graphviz</div>',
  )
  expect(html).toContain(
    '<pre class="vmarkd-diagram-error__msg">syntax error in line 2</pre>',
  )
})

test('diagramErrorHtml escapes &/</> so an echoed source token cannot inject HTML', () => {
  const html = diagramErrorHtml(
    'echarts',
    'bad token <img src=x onerror=1> & "y"',
  )
  // the raw tag must not survive as HTML
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img src=x onerror=1&gt;')
  expect(html).toContain('&amp;')
})

test('diagramErrorHtml reads message from an Error instance', () => {
  const html = diagramErrorHtml('mermaid', new Error('Parse error on line 1'))
  expect(html).toContain('Parse error on line 1')
})

test('diagramErrorHtml preserves newlines in the <pre> (multi-line parser errors / caret diagram)', () => {
  const html = diagramErrorHtml('mermaid', 'line one\n----^\nExpecting X')
  expect(html).toContain('line one\n----^\nExpecting X')
})

test('renderDiagramError replaces the element content with the box', () => {
  const el = document.createElement('div')
  el.innerHTML = '<svg>stale render</svg>'
  renderDiagramError(el, 'nomnoml', 'parse failed')
  expect(el.querySelector('svg')).toBeNull()
  const box = el.querySelector('.vmarkd-diagram-error')
  expect(box).not.toBeNull()
  expect(box?.querySelector('.vmarkd-diagram-error__title')?.textContent).toBe(
    'nomnoml',
  )
  expect(box?.querySelector('.vmarkd-diagram-error__msg')?.tagName).toBe('PRE')
})
