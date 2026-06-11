import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ECHARTS_GALLERY,
  ECHARTS_GALLERY_NAMES,
} from '../../src/echarts-gallery'
import {
  ECHARTS_THEME_NAME,
  ECHARTS_THEME_VALUES,
  paletteToEchartsTheme,
  resolveEchartsTheme,
} from '../../src/echarts-theme'
import { MERMAID_PALETTES } from '../../src/mermaid-palettes'

const HEX = /^#[0-9a-f]{6}$/

describe('paletteToEchartsTheme', () => {
  it('passes the palette background + foreground straight through', () => {
    const t = paletteToEchartsTheme(MERMAID_PALETTES['github-dark']) as any
    expect(t.backgroundColor).toBe('#0d1117')
    expect(t.textStyle.color).toBe('#e6edf3')
  })

  it('derives axis colours from the palette line colour', () => {
    const t = paletteToEchartsTheme(MERMAID_PALETTES['github-light']) as any
    expect(t.categoryAxis.axisLine.lineStyle.color).toBe('#d1d9e0')
    expect(t.valueAxis.axisLabel.color).toBe('#1f2328')
  })

  it('produces a non-empty series palette of valid hex colours', () => {
    const t = paletteToEchartsTheme(MERMAID_PALETTES['one-dark']) as any
    expect(Array.isArray(t.color)).toBe(true)
    expect(t.color.length).toBeGreaterThan(3)
    for (const c of t.color) expect(c).toMatch(HEX)
  })

  it('emits only valid hex for every colour field across all palettes', () => {
    for (const id of Object.keys(MERMAID_PALETTES)) {
      const t = paletteToEchartsTheme(MERMAID_PALETTES[id]) as any
      const colors = [
        t.backgroundColor,
        t.textStyle.color,
        t.categoryAxis.axisLine.lineStyle.color,
        t.categoryAxis.splitLine.lineStyle.color[0],
        t.tooltip.backgroundColor,
        t.tooltip.borderColor,
        ...t.color,
      ]
      for (const c of colors) expect(c, `${id}: ${c}`).toMatch(HEX)
    }
  })
})

describe('resolveEchartsTheme (setting + content-theme pairing)', () => {
  it('auto pairs a content theme to the derived vmarkd theme object', () => {
    const r = resolveEchartsTheme('auto', 'github-dark', 'dark')
    expect(r.name).toBe(ECHARTS_THEME_NAME)
    expect((r.theme as any).backgroundColor).toBe('#0d1117')
  })

  it('an explicit gallery theme wins; a missing background is back-filled (not transparent)', () => {
    const r = resolveEchartsTheme('macarons', 'github-dark', 'dark')
    expect(r.name).toBe('macarons')
    expect((r.theme as any).color[0]).toBe(
      (ECHARTS_GALLERY.macarons as any).color[0],
    ) // palette preserved
    expect((r.theme as any).backgroundColor).toBe('#ffffff') // back-filled (gallery omits it)
  })

  it('vintage-dark keeps the vintage series palette on a dark background', () => {
    const r = resolveEchartsTheme('vintage-dark', 'auto', 'dark')
    expect(r.name).toBe('vintage-dark')
    expect((r.theme as any).backgroundColor).toBe('#292420') // warm dark
    expect((r.theme as any).color).toEqual(
      (ECHARTS_GALLERY.vintage as any).color,
    )
  })

  it('auto pairs material-dark to the vintage series on the material-dark page background', () => {
    const r = resolveEchartsTheme('auto', 'material-dark', 'dark')
    expect((r.theme as any).backgroundColor).toBe('#282c34') // page bg → chart blends in
    expect((r.theme as any).color).toEqual(
      (ECHARTS_GALLERY.vintage as any).color,
    )
  })

  it('auto pairs VS Code Dark/Light Modern to VS Code chart colours on the Modern background', () => {
    const dark = resolveEchartsTheme('auto', 'vscode-dark-modern', 'dark')
    expect(dark.name).toBe(ECHARTS_THEME_NAME)
    expect((dark.theme as any).backgroundColor).toBe('#1f1f1f') // Dark Modern editor bg
    expect((dark.theme as any).color[0]).toBe('#59a4f9') // VS Code charts.blue (dark)
    const light = resolveEchartsTheme('auto', 'vscode-light-modern', 'light')
    expect((light.theme as any).backgroundColor).toBe('#ffffff')
    expect((light.theme as any).color[0]).toBe('#0063d3') // charts.blue (light)
  })

  it('explicit light/dark resolve to neutral themes WITH a background (never transparent)', () => {
    const light = resolveEchartsTheme('light', 'github-dark', 'dark')
    expect(light.name).toBe(ECHARTS_THEME_NAME)
    expect((light.theme as any).backgroundColor).toBe('#ffffff')
    const dark = resolveEchartsTheme('dark', 'github-light', 'light')
    expect(dark.name).toBe(ECHARTS_THEME_NAME)
    expect((dark.theme as any).backgroundColor).toBe('#18181b') // zinc-dark
  })

  it('auto with no pairing follows the VS Code palette + its chart series colours', () => {
    const r = resolveEchartsTheme('auto', 'auto', 'dark', {
      bg: '#1e1e1e',
      fg: '#d4d4d4',
      accent: '#4daafc',
      series: ['#3794ff', '#89d185', '#d18616'],
    })
    expect(r.name).toBe(ECHARTS_THEME_NAME)
    expect((r.theme as any).backgroundColor).toBe('#1e1e1e') // editor background
    // the theme's own chart colours win over our derived golden-angle series
    expect((r.theme as any).color).toEqual(['#3794ff', '#89d185', '#d18616'])
  })

  it('auto with no pairing and no VS Code palette falls back to a neutral theme by mode', () => {
    expect(
      (resolveEchartsTheme('auto', 'auto', 'dark').theme as any)
        .backgroundColor,
    ).toBe('#18181b') // zinc-dark
    expect(
      (resolveEchartsTheme('auto', undefined, 'light').theme as any)
        .backgroundColor,
    ).toBe('#ffffff') // zinc-light
  })
})

describe('ECharts gallery + manifest parity', () => {
  it('every gallery theme is a non-empty object with a series colour palette', () => {
    expect(ECHARTS_GALLERY_NAMES.length).toBeGreaterThan(0)
    for (const id of ECHARTS_GALLERY_NAMES) {
      const t = ECHARTS_GALLERY[id] as any
      expect(t && typeof t).toBe('object')
      expect(Array.isArray(t.color)).toBe(true)
      expect(t.color.length).toBeGreaterThan(0)
    }
  })

  it('the package.json theme.echarts enum matches ECHARTS_THEME_VALUES', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../package.json', import.meta.url)),
        'utf8',
      ),
    )
    // `contributes.configuration` is an array of setting groups.
    const groups = pkg.contributes.configuration as Array<{
      properties: Record<string, { enum?: string[] }>
    }>
    const prop = groups
      .map((g) => g.properties['vmarkd.theme.echarts'])
      .find(Boolean)
    expect(prop?.enum).toEqual(ECHARTS_THEME_VALUES)
  })
})
