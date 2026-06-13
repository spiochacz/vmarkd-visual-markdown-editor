import { describe, it, expect } from 'vitest'
import {
  MERMAID_PALETTES,
  MERMAID_PALETTE_NAMES,
  paletteToThemeVariables,
} from '../../src/mermaid-palettes'
import { pairedPalette } from '../../src/theme-registry'

const HEX = /^#[0-9a-f]{6}$/

describe('mermaid palettes', () => {
  it('vendors all 15 Beautiful Mermaid palettes', () => {
    expect(MERMAID_PALETTE_NAMES).toHaveLength(15)
    for (const id of [
      'github-light',
      'github-dark',
      'dracula',
      'nord',
      'one-dark',
      'tokyo-night',
      'zinc-light',
    ]) {
      expect(MERMAID_PALETTE_NAMES).toContain(id)
    }
  })

  it('translates a full palette to base themeVariables (passthrough of core colours)', () => {
    const v = paletteToThemeVariables(MERMAID_PALETTES['github-light'])
    expect(v.background).toBe('#ffffff')
    expect(v.lineColor).toBe('#d1d9e0')
    expect(v.textColor).toBe('#1f2328')
    expect(v.primaryTextColor).toBe('#1f2328')
    expect(v.darkMode).toBe(false)
  })

  it('sets darkMode from background luminance', () => {
    expect(
      paletteToThemeVariables(MERMAID_PALETTES['github-dark']).darkMode,
    ).toBe(true)
    expect(
      paletteToThemeVariables(MERMAID_PALETTES['github-dark']).background,
    ).toBe('#0d1117')
    expect(
      paletteToThemeVariables(MERMAID_PALETTES['solarized-light']).darkMode,
    ).toBe(false)
  })

  it('derives missing line/accent/muted for a 2-colour palette (zinc) + lowercases hex', () => {
    const v = paletteToThemeVariables(MERMAID_PALETTES['zinc-light'])
    expect(v.background).toBe('#ffffff') // was #FFFFFF
    expect(v.primaryTextColor).toBe('#27272a') // was #27272A
    expect(v.lineColor).toMatch(HEX) // derived, still a valid hex
    expect(v.darkMode).toBe(false)
  })

  it('emits valid hex for every colour variable', () => {
    for (const id of MERMAID_PALETTE_NAMES) {
      const v = paletteToThemeVariables(MERMAID_PALETTES[id])
      for (const [k, val] of Object.entries(v)) {
        if (k === 'darkMode') continue
        expect(val, `${id}.${k}`).toMatch(HEX)
      }
    }
  })
})

describe('pairedPalette (content-theme pairing)', () => {
  it('pairs each content theme with its chosen palette', () => {
    expect(pairedPalette('github-light')).toBe('github-light')
    expect(pairedPalette('github-dark')).toBe('github-dark')
    expect(pairedPalette('material-dark')).toBe('one-dark')
    expect(pairedPalette('vscode-light-2026')).toBe('zinc-light')
    expect(pairedPalette('vscode-dark-2026')).toBe('zinc-dark')
  })

  it('returns undefined for auto / unknown', () => {
    expect(pairedPalette('auto')).toBeUndefined()
    expect(pairedPalette(undefined)).toBeUndefined()
  })
})
