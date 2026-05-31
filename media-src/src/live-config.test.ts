import { describe, it, expect } from 'vitest'
import {
  initOnlyChanged,
  INIT_ONLY_OPTIONS,
  resolveFontSize,
} from './live-config'

describe('initOnlyChanged', () => {
  it('is false when no constructor-only option changed', () => {
    const opts = { showToolbar: true, wordCount: false, highlightHeadings: true }
    // highlightHeadings flips, but it is a live body-attr option, not init-only
    expect(initOnlyChanged(opts, { ...opts, highlightHeadings: false })).toBe(
      false
    )
  })

  it('is true when a constructor-only option changed', () => {
    const opts = { showToolbar: true, wordCount: false }
    expect(initOnlyChanged(opts, { ...opts, showToolbar: false })).toBe(true)
    expect(initOnlyChanged(opts, { ...opts, wordCount: true })).toBe(true)
  })

  it('covers the documented init-only keys', () => {
    expect(INIT_ONLY_OPTIONS).toContain('showToolbar')
    expect(INIT_ONLY_OPTIONS).toContain('wordCount')
    expect(INIT_ONLY_OPTIONS).toContain('outlinePosition')
    expect(INIT_ONLY_OPTIONS).toContain('mermaidTheme')
  })

  it('does not list fontSize (it is a live body/CSS-var option, not init-only)', () => {
    expect(INIT_ONLY_OPTIONS).not.toContain('fontSize')
  })
})

describe('resolveFontSize (task 43)', () => {
  const VSCODE = 'var(--vscode-editor-font-size, 14px)'

  it('follows VS Code for "editor", empty, and unset', () => {
    expect(resolveFontSize('editor')).toBe(VSCODE)
    expect(resolveFontSize('')).toBe(VSCODE)
    expect(resolveFontSize(undefined)).toBe(VSCODE)
  })

  it('keeps Vditor\'s 16px for "vditor"', () => {
    expect(resolveFontSize('vditor')).toBe('16px')
  })

  it('uses an explicit pixel size for a number or numeric string', () => {
    expect(resolveFontSize(15)).toBe('15px')
    expect(resolveFontSize('13')).toBe('13px')
    expect(resolveFontSize('17.5')).toBe('17.5px')
  })

  it('falls back to the VS Code size for garbage or non-positive values', () => {
    expect(resolveFontSize('nonsense')).toBe(VSCODE)
    expect(resolveFontSize('0')).toBe(VSCODE)
    expect(resolveFontSize('-4')).toBe(VSCODE)
  })
})
