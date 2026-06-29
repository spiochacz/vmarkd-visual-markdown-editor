// @vitest-environment jsdom
import { test, expect, beforeEach, describe } from 'vitest'
import { basemapFor, findBlocks } from './custom-diagrams'

beforeEach(() => {
  document.body.innerHTML = ''
})

// The `theme.geoBasemap` setting → Leaflet tile source (initLeafletMap reads this). `auto` (default)
// is themed monochrome CARTO (Positron light / Dark Matter dark); `voyager`/`osm` are colored; `none`
// disables the basemap. Keep in sync with the package.json enum.
describe('basemapFor (theme.geoBasemap → tile source)', () => {
  test('auto (default) is themed monochrome CARTO, flipping light/dark by mode', () => {
    const light = basemapFor('auto', false)
    const dark = basemapFor('auto', true)
    expect(light?.url).toContain('cartocdn.com/light_all/')
    expect(dark?.url).toContain('cartocdn.com/dark_all/')
    expect(light?.subdomains).toBe('abcd')
  })

  test('an unknown value falls back to auto (themed monochrome), NOT none', () => {
    expect(basemapFor(undefined, false)?.url).toContain(
      'cartocdn.com/light_all/',
    )
    expect(basemapFor('bogus', true)?.url).toContain('cartocdn.com/dark_all/')
  })

  test('voyager is the colored CARTO Voyager basemap (mode-independent)', () => {
    expect(basemapFor('voyager', false)?.url).toContain(
      'cartocdn.com/rastertiles/voyager/',
    )
    expect(basemapFor('voyager', true)?.url).toContain(
      'cartocdn.com/rastertiles/voyager/',
    )
  })

  test('osm is the OpenStreetMap basemap (abc subdomains, no retina token)', () => {
    const osm = basemapFor('osm', false)
    expect(osm?.url).toContain('tile.openstreetmap.org/')
    expect(osm?.url).not.toContain('{r}') // OSM has no retina tiles
    expect(osm?.subdomains).toBe('abc')
  })

  test('none disables the basemap (null → geometry only)', () => {
    expect(basemapFor('none', false)).toBeNull()
    expect(basemapFor('none', true)).toBeNull()
  })
})

// Regression for the "diagram sits on a code-PANEL background" bug: Vditor highlights these unknown
// languages as code first (adds `.hljs` to the <code>); findBlocks swaps <code>→<div> and MUST NOT
// carry `.hljs` over, else the highlight.js theme paints the code-panel bg behind the diagram svg.
// (e2e counterpart: test/vscode-e2e/diagram-bg.spec.ts.)

test('code→div swap drops the hljs class (keeps language-X)', () => {
  document.body.innerHTML =
    '<pre class="vditor-ir__preview"><code class="language-d2 hljs">a -> b</code></pre>'
  const blocks = findBlocks(document, 'd2')
  expect(blocks).toHaveLength(1)
  const w = blocks[0].wrapper
  expect(w.tagName).toBe('DIV')
  expect(w.classList.contains('hljs')).toBe(false)
  expect(w.classList.contains('language-d2')).toBe(true)
  expect(w.className).toBe('language-d2')
  expect(blocks[0].code).toBe('a -> b')
})

test('preserves OTHER classes while stripping only hljs', () => {
  document.body.innerHTML =
    '<pre class="vditor-ir__preview"><code class="language-wavedrom hljs extra-x">{}</code></pre>'
  const blocks = findBlocks(document, 'wavedrom')
  expect(blocks).toHaveLength(1)
  const w = blocks[0].wrapper
  expect(w.classList.contains('hljs')).toBe(false)
  expect(w.classList.contains('language-wavedrom')).toBe(true)
  expect(w.classList.contains('extra-x')).toBe(true)
})

test('a code block without hljs swaps cleanly to a language-only div', () => {
  document.body.innerHTML =
    '<pre class="vditor-ir__preview"><code class="language-stl">solid x</code></pre>'
  const blocks = findBlocks(document, 'stl')
  expect(blocks).toHaveLength(1)
  expect(blocks[0].wrapper.className).toBe('language-stl')
})

test('skips the editable IR source marker (only renders in the preview)', () => {
  document.body.innerHTML =
    '<pre class="vditor-ir__marker--pre"><code class="language-d2 hljs">a -> b</code></pre>'
  expect(findBlocks(document, 'd2')).toHaveLength(0)
})

test('an existing rendered div is reused as the wrapper (idempotent, no hljs)', () => {
  document.body.innerHTML =
    '<pre class="vditor-ir__preview"><div class="language-d2" data-code="a -> b"></div></pre>'
  const blocks = findBlocks(document, 'd2')
  expect(blocks).toHaveLength(1)
  expect(blocks[0].wrapper.tagName).toBe('DIV')
  expect(blocks[0].wrapper.classList.contains('hljs')).toBe(false)
})
