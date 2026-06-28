// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { setD2Config } from './d2-config'
import { resolveDiagramPalette } from './diagram-palette'

// A fake window exposing only what vscodePalette reads: document.documentElement + getComputedStyle
// returning the given CSS custom properties. jsdom's getComputedStyle doesn't resolve --vscode-*
// custom props reliably, so we inject them deterministically instead.
function fakeWin(vars: Record<string, string>) {
  return {
    document: { documentElement: {} },
    getComputedStyle: () => ({
      getPropertyValue: (n: string) => vars[n] ?? '',
    }),
  } as unknown as Window
}

afterEach(() => {
  setD2Config({ contentTheme: undefined, mode: undefined })
})

describe('resolveDiagramPalette', () => {
  it('uses the content-theme paired palette (shared layer-1) when one exists', () => {
    setD2Config({ contentTheme: 'github-dark', mode: 'dark' })
    const p = resolveDiagramPalette(fakeWin({}))
    expect(p.bg).toBe('#0d1117') // github-dark, lowercased
    expect(p.fg).toBe('#e6edf3')
    expect(p.accent).toBe('#4493f8')
    expect(p.line).toBe('#3d444d')
    // surface is a derived tint of bg→fg, distinct from both.
    expect(p.surface).not.toBe(p.bg)
    expect(p.surface).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.note).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('derives from VS Code editor vars when the content theme is auto (no pairing)', () => {
    setD2Config({ contentTheme: 'auto', mode: 'dark' })
    const p = resolveDiagramPalette(
      fakeWin({
        '--vscode-editor-background': '#101418',
        '--vscode-editor-foreground': '#d0d4d8',
        '--vscode-textLink-foreground': '#3794ff',
        '--vscode-panel-border': '#2a2f34',
      }),
    )
    expect(p.bg).toBe('#101418')
    expect(p.fg).toBe('#d0d4d8')
    expect(p.accent).toBe('#3794ff')
    expect(p.line).toBe('#2a2f34')
  })

  it('drops an 8-digit alpha hex from a VS Code var to 6 digits', () => {
    setD2Config({ contentTheme: 'auto', mode: 'dark' })
    const p = resolveDiagramPalette(
      fakeWin({
        '--vscode-editor-background': '#101418ff',
        '--vscode-editor-foreground': '#d0d4d8cc',
      }),
    )
    expect(p.bg).toBe('#101418')
    expect(p.fg).toBe('#d0d4d8')
  })

  it('falls back to github-dark by mode when nothing resolves', () => {
    setD2Config({ contentTheme: 'auto', mode: 'dark' })
    const p = resolveDiagramPalette(fakeWin({}))
    expect(p.bg).toBe('#0d1117')
  })

  it('falls back to github-light when the editor mode is light', () => {
    setD2Config({ contentTheme: 'auto', mode: 'light' })
    const p = resolveDiagramPalette(fakeWin({}))
    expect(p.bg).toBe('#ffffff')
  })

  it('ignores a non-hex VS Code var (rgb()) and falls back', () => {
    setD2Config({ contentTheme: 'auto', mode: 'dark' })
    const p = resolveDiagramPalette(
      fakeWin({
        '--vscode-editor-background': 'rgb(16, 20, 24)',
        '--vscode-editor-foreground': '#d0d4d8',
      }),
    )
    // bg wasn't hex → the whole vscode path bails (needs both bg+fg) → github-dark fallback.
    expect(p.bg).toBe('#0d1117')
  })
})
