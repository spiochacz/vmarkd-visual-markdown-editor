import { describe, expect, it } from 'vitest'
import { resolveFontSizeCss } from '../../src/extension'

// resolveFontSizeCss maps the `fontSize` setting to the --me-font-size CSS value.
describe('resolveFontSizeCss', () => {
  const editorFont = 'var(--vscode-editor-font-size, 14px)'

  it('uses the VS Code editor font for unset / "editor"', () => {
    expect(resolveFontSizeCss(undefined)).toBe(editorFont)
    expect(resolveFontSizeCss('')).toBe(editorFont)
    expect(resolveFontSizeCss('editor')).toBe(editorFont)
  })

  it('uses Vditor\'s 16px default for "vditor"', () => {
    expect(resolveFontSizeCss('vditor')).toBe('16px')
  })

  it('treats a positive number as a px value', () => {
    expect(resolveFontSizeCss('18')).toBe('18px')
    expect(resolveFontSizeCss('13.5')).toBe('13.5px')
  })

  it('falls back to the editor font for non-positive / garbage values', () => {
    expect(resolveFontSizeCss('0')).toBe(editorFont)
    expect(resolveFontSizeCss('-4')).toBe(editorFont)
    expect(resolveFontSizeCss('abc')).toBe(editorFont)
  })
})
