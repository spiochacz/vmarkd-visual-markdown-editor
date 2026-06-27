// Vega/Vega-Lite offline data stripping (stripRemoteData, custom-diagrams.ts). Remote `data.url`
// loads are blocked for offline rendering + security (a remote fetch leaks that the file was opened).
// Only inline `data.values` works. The strip must be RECURSIVE — a `url` can hide in `data: [...]`
// arrays or nested layers/transforms, not just at the top level (the old top-level-only check leaked).
import { describe, expect, it } from 'vitest'
import { stripRemoteData } from './custom-diagrams'

describe('stripRemoteData (vega offline guard)', () => {
  it('removes a top-level data.url', () => {
    const spec = stripRemoteData({
      data: { url: 'https://evil.example/x.json' },
    })
    expect(spec.data.url).toBeUndefined()
  })

  it('keeps inline data.values', () => {
    const spec = stripRemoteData({
      data: { values: [{ a: 1 }], url: 'https://evil.example/x.json' },
    })
    expect((spec.data as any).url).toBeUndefined()
    expect(spec.data.values).toEqual([{ a: 1 }])
  })

  it('removes urls nested in layers / transforms / lookups (recursive)', () => {
    const spec = stripRemoteData({
      layer: [
        { data: { url: 'https://evil.example/a.csv' }, mark: 'line' },
        {
          transform: [
            {
              lookup: 'k',
              from: { data: { url: 'https://evil.example/b.json' } },
            },
          ],
        },
      ],
    })
    expect((spec.layer[0].data as any).url).toBeUndefined()
    expect((spec.layer[1].transform[0].from.data as any).url).toBeUndefined()
  })

  it('removes urls inside a data:[...] array (full Vega multi-source)', () => {
    const spec = stripRemoteData({
      data: [
        { name: 'a', url: 'https://evil.example/a.json' },
        { name: 'b', values: [1, 2, 3] },
      ],
    })
    expect(spec.data[0].url).toBeUndefined()
    expect(spec.data[1].values).toEqual([1, 2, 3])
  })

  it('does not touch a url-like value under a non-url key ($schema)', () => {
    const spec = stripRemoteData({
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [] },
    })
    expect(spec.$schema).toBe('https://vega.github.io/schema/vega-lite/v5.json')
  })

  it('leaves a fully-inline spec unchanged', () => {
    const input = {
      mark: 'bar',
      data: { values: [{ x: 1, y: 2 }] },
      encoding: { x: { field: 'x' }, y: { field: 'y' } },
    }
    expect(stripRemoteData(structuredClone(input))).toEqual(input)
  })
})
