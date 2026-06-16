import { describe, expect, it } from 'vitest'
import {
  NAMED_THEME_VALUES,
  isNamedTheme,
  resolveContentTheme,
} from '../../src/theme-registry'

// `theme.content` migration + normalisation. The `vscode-*-modern` themes were renamed to
// `vscode-*-2026`; VS Code keeps a stale settings.json value after it leaves the manifest enum, so
// resolveContentTheme maps it at read time and folds any other unknown value to `auto` (avoids the
// broken in-between where `markdown-body` is applied but no theme stylesheet matches).
describe('resolveContentTheme (theme.content migration)', () => {
  it('empty / unset → auto', () => {
    expect(resolveContentTheme(undefined)).toBe('auto')
    expect(resolveContentTheme('')).toBe('auto')
    expect(resolveContentTheme('auto')).toBe('auto')
  })

  it('migrates the renamed vscode-*-modern themes to their -2026 names', () => {
    expect(resolveContentTheme('vscode-dark-modern')).toBe('vscode-dark-2026')
    expect(resolveContentTheme('vscode-light-modern')).toBe('vscode-light-2026')
  })

  it('passes through every currently-valid named theme unchanged', () => {
    for (const v of NAMED_THEME_VALUES) {
      expect(resolveContentTheme(v)).toBe(v)
    }
  })

  it('folds any other unknown value to auto (no broken in-between)', () => {
    expect(resolveContentTheme('garbage')).toBe('auto')
    expect(resolveContentTheme('vscode-dark-modern-x')).toBe('auto')
    expect(resolveContentTheme('GitHub-Dark')).toBe('auto') // case-sensitive
  })

  it('every migration target is a real, currently-registered named theme', () => {
    for (const target of ['vscode-dark-2026', 'vscode-light-2026']) {
      expect(isNamedTheme(target)).toBe(true)
    }
  })
})
