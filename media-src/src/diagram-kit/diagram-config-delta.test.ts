import { describe, expect, test } from 'vitest'
import type { VmarkdConfigOptions } from '../../../src/shared/protocol'
import { DIAGRAM_CONFIG_KEYS } from './engine-registry'
import {
  diagramConfigDelta,
  engineCacheKeyFragment,
  rethemeFlagsFor,
} from './diagram-config-delta'

// Task 408 — replaces message-router.ts's 9 hand-written `xxxChanged` comparisons
// (handleConfigChanged) with a pure function driven by the registry's per-engine
// `configKeys`, and gives render-cache-client.ts a per-engine cache-key fragment so a
// D2-only setting no longer invalidates every other engine's cached SVGs.

const base: VmarkdConfigOptions = {
  contentTheme: 'auto',
  codeTheme: 'github',
  mermaidTheme: 'default',
  mermaidLayout: 'dagre',
  echartsTheme: 'default',
  d2Layout: 'dagre',
  d2Theme: '0',
  d2Sketch: false,
  geoBasemap: 'auto',
  fontSize: '14px',
}

describe('diagramConfigDelta', () => {
  test('identical prev/next → empty changed set', () => {
    expect(diagramConfigDelta(base, { ...base }).changed.size).toBe(0)
  })

  test('a lone d2Layout change is the ONLY tracked key reported', () => {
    const delta = diagramConfigDelta(base, { ...base, d2Layout: 'elk' })
    expect([...delta.changed]).toEqual(['d2Layout'])
  })

  test('a lone mermaidLayout change is the only tracked key reported', () => {
    const delta = diagramConfigDelta(base, { ...base, mermaidLayout: 'elk' })
    expect([...delta.changed]).toEqual(['mermaidLayout'])
  })

  test('contentTheme and codeTheme are tracked even though neither is a diagram configKey', () => {
    const delta = diagramConfigDelta(base, {
      ...base,
      contentTheme: 'github-dark',
      codeTheme: 'monokai',
    })
    expect([...delta.changed].sort()).toEqual(['codeTheme', 'contentTheme'])
  })

  test('an untracked option (e.g. imageFormat) never appears in the delta', () => {
    const delta = diagramConfigDelta(base, {
      ...base,
      imageFormat: 'webp',
    } as VmarkdConfigOptions)
    expect(delta.changed.size).toBe(0)
  })

  test('undefined prev/next compare as no-op when both absent', () => {
    expect(diagramConfigDelta(undefined, undefined).changed.size).toBe(0)
  })
})

describe('rethemeFlagsFor', () => {
  test('no change at all → every flag false', () => {
    const flags = rethemeFlagsFor(diagramConfigDelta(base, { ...base }))
    expect(Object.values(flags).every((v) => v === false)).toBe(true)
  })

  test('a contentTheme-only change flips every diagram flag (global)', () => {
    const delta = diagramConfigDelta(base, {
      ...base,
      contentTheme: 'github-dark',
    })
    const flags = rethemeFlagsFor(delta)
    expect(flags).toEqual({
      mermaid: true,
      echarts: true,
      flowchart: true,
      vega: true,
      smiles: true,
      monoGroup: true,
      geo: true,
      d2: true,
    })
  })

  test('a lone d2Sketch change flips ONLY d2', () => {
    const delta = diagramConfigDelta(base, { ...base, d2Sketch: true })
    const flags = rethemeFlagsFor(delta)
    expect(flags.d2).toBe(true)
    expect(flags.mermaid).toBe(false)
    expect(flags.echarts).toBe(false)
    expect(flags.flowchart).toBe(false)
    expect(flags.vega).toBe(false)
    expect(flags.smiles).toBe(false)
    expect(flags.monoGroup).toBe(false)
    expect(flags.geo).toBe(false)
  })

  test('a lone geoBasemap change flips ONLY geo', () => {
    const delta = diagramConfigDelta(base, { ...base, geoBasemap: 'none' })
    expect(rethemeFlagsFor(delta)).toEqual({
      mermaid: false,
      echarts: false,
      flowchart: false,
      vega: false,
      smiles: false,
      monoGroup: false,
      geo: true,
      d2: false,
    })
  })

  test('a lone echartsTheme change flips ONLY echarts (covers mindmap too, no separate flag)', () => {
    const delta = diagramConfigDelta(base, { ...base, echartsTheme: 'dark' })
    expect(rethemeFlagsFor(delta)).toEqual({
      mermaid: false,
      echarts: true,
      flowchart: false,
      vega: false,
      smiles: false,
      monoGroup: false,
      geo: false,
      d2: false,
    })
  })

  test('a codeTheme-only change flips no diagram flag (code is handled separately by the caller)', () => {
    const delta = diagramConfigDelta(base, { ...base, codeTheme: 'monokai' })
    expect(
      Object.values(rethemeFlagsFor(delta)).every((v) => v === false),
    ).toBe(true)
  })
})

describe('engineCacheKeyFragment', () => {
  test("d2's fragment folds its own 3 keys, in order", () => {
    expect(engineCacheKeyFragment('d2', base)).toBe('dagre|0|false')
  })

  test("mermaid's fragment folds its own 2 keys", () => {
    expect(engineCacheKeyFragment('mermaid', base)).toBe('default|dagre')
  })

  test("a d2-only options change never changes another engine's fragment", () => {
    const changed = { ...base, d2Layout: 'elk', d2Theme: '3', d2Sketch: true }
    expect(engineCacheKeyFragment('mermaid', changed)).toBe(
      engineCacheKeyFragment('mermaid', base),
    )
    expect(engineCacheKeyFragment('vega', changed)).toBe(
      engineCacheKeyFragment('vega', base),
    )
  })

  test('an engine with no own configKeys (vega) always returns the empty fragment', () => {
    expect(engineCacheKeyFragment('vega', base)).toBe('')
    expect(engineCacheKeyFragment('vega', { ...base, d2Layout: 'elk' })).toBe(
      '',
    )
  })

  test('an unknown lang returns the empty fragment', () => {
    expect(engineCacheKeyFragment('not-a-real-lang', base)).toBe('')
  })

  test('undefined options → empty-string parts (not "undefined")', () => {
    expect(engineCacheKeyFragment('d2', undefined)).toBe('||')
  })
})

// Exhaustiveness net (task 408, per advisor review): DIAGRAM_CONFIG_KEYS only catches an engine
// declaring a key that isn't in the union / vice-versa (engine-registry.test.ts). It does NOT
// catch the birth of a brand-new VmarkdConfigOptions field that nobody classified at all. This
// forcing literal closes that gap: it must list EVERY key of VmarkdConfigOptions (TS errors on a
// missing key) and only real keys (TS errors on an extra one) — so adding a field to protocol.ts
// breaks this file's compile until the new key is consciously filed under DIAGRAM_CONFIG_KEYS or
// KNOWN_NON_DIAGRAM_KEYS below.
const ALL_OPTION_KEYS: Required<{ [K in keyof VmarkdConfigOptions]: true }> = {
  contentTheme: true,
  useVscodeThemeColor: true,
  markdownPreviewFontFamily: true,
  enableFullWidth: true,
  codeBlockLineNumbers: true,
  mermaidTheme: true,
  mermaidLayout: true,
  echartsTheme: true,
  d2Layout: true,
  d2Theme: true,
  d2Sketch: true,
  geoBasemap: true,
  assetsVersion: true,
  showToolbar: true,
  highlightHeadings: true,
  showHeadingMarkers: true,
  fontSize: true,
  outlinePosition: true,
  showOutlineByDefault: true,
  outlineHighlight: true,
  codeTheme: true,
  streamLargeFiles: true,
  contentVisibility: true,
  linkOpenWithModifier: true,
  pasteUrlAsLink: true,
  imageFormat: true,
  imageQuality: true,
  imageMaxWidth: true,
  allowRemoteImages: true,
  wikiEnabled: true,
  pasteCsvAsTable: true,
  defaultMode: true,
  outlineWidth: true,
  slugifyMode: true,
  hardBreakStyle: true,
  reflowLineBreaks: true,
}

// Every option NOT a diagram-engine configKey, deliberately classified as "affects something
// other than a diagram render" (global chrome/editor/image/outline settings, or — contentTheme/
// codeTheme/fontSize/assetsVersion — options that DO feed the render cache/retheme path but as a
// GLOBAL fragment, not one engine's own key; see renderCacheThemeKey + diagramConfigDelta).
const KNOWN_NON_DIAGRAM_KEYS = [
  'contentTheme',
  'useVscodeThemeColor',
  'markdownPreviewFontFamily',
  'enableFullWidth',
  'codeBlockLineNumbers',
  'assetsVersion',
  'showToolbar',
  'highlightHeadings',
  'showHeadingMarkers',
  'fontSize',
  'outlinePosition',
  'showOutlineByDefault',
  'outlineHighlight',
  'codeTheme',
  'streamLargeFiles',
  'contentVisibility',
  'linkOpenWithModifier',
  'pasteUrlAsLink',
  'imageFormat',
  'imageQuality',
  'imageMaxWidth',
  'allowRemoteImages',
  'wikiEnabled',
  'pasteCsvAsTable',
  // Task 282 — the resolved open mode. Read ONCE at init (buildVditorOptions' last merge); it
  // never re-keys a diagram render, so it belongs here rather than in DIAGRAM_CONFIG_KEYS.
  'defaultMode',
  'outlineWidth',
  // Task 243 — never keys a diagram render; only resolves `#fragment` anchor-link clicks.
  'slugifyMode',
  // Task 530 — only picks the written form of a new hard break; never keys a diagram render.
  'hardBreakStyle',
  // Task 83 — soft line breaks in the Preview; never keys a diagram render.
  'reflowLineBreaks',
] as const

describe('VmarkdConfigOptions classification is exhaustive (task 408)', () => {
  test('DIAGRAM_CONFIG_KEYS ∪ KNOWN_NON_DIAGRAM_KEYS == every VmarkdConfigOptions key, no gaps/overlap', () => {
    const all = Object.keys(ALL_OPTION_KEYS).sort()
    const classified = [
      ...DIAGRAM_CONFIG_KEYS,
      ...KNOWN_NON_DIAGRAM_KEYS,
    ].sort()
    expect(classified).toEqual(all)
  })
})
