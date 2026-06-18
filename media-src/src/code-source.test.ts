// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { tagCodeSource, CUSTOM_LANGS } from './code-source'

function markerPre(lang: string): HTMLElement {
  const pre = document.createElement('pre')
  pre.className = 'vditor-ir__marker--pre'
  const code = document.createElement('code')
  code.className = `language-${lang}`
  pre.appendChild(code)
  return pre
}

describe('tagCodeSource', () => {
  it('tags real code-block source with .hljs (theme-driven edit == render)', () => {
    const root = document.createElement('div')
    root.append(markerPre('js'), markerPre('python'))
    tagCodeSource(root)
    for (const code of Array.from(root.querySelectorAll('code'))) {
      expect(code.classList.contains('hljs')).toBe(true)
    }
  })

  it('leaves diagram-language source alone (no .hljs code panel — sits on the page bg)', () => {
    // Every custom-diagram renderer must be excluded, or its editable source gets the dark
    // code panel instead of the page background (the bug behind "te nowe trzeba poprawic").
    for (const lang of [
      'd2',
      'wavedrom',
      'nomnoml',
      'geojson',
      'topojson',
      'vega',
      'vega-lite',
      'stl',
      'smiles',
      'mermaid',
    ]) {
      const root = document.createElement('div')
      root.append(markerPre(lang))
      tagCodeSource(root)
      const code = root.querySelector('code')!
      expect(code.classList.contains('hljs')).toBe(false)
    }
  })

  it('CUSTOM_LANGS covers every custom-diagram renderer', () => {
    for (const lang of [
      'wavedrom',
      'nomnoml',
      'geojson',
      'topojson',
      'vega',
      'vega-lite',
      'stl',
      'd2',
    ]) {
      expect(CUSTOM_LANGS.has(lang)).toBe(true)
    }
  })
})
