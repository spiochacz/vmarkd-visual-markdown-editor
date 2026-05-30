import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
)

const VIEW_TYPE = 'markdown-editor.editor'

describe('package.json manifest', () => {
  it('points main at the compiled extension entry', () => {
    expect(pkg.main).toBe('out/extension.js')
  })

  it('declares a ^1.110 engines floor (ThemeIcon tab icon / l10n / telemetry)', () => {
    expect(pkg.engines.vscode).toBe('^1.110.0')
  })

  it('registers exactly one custom editor with the expected view type', () => {
    expect(pkg.contributes.customEditors).toHaveLength(1)
    const editor = pkg.contributes.customEditors[0]
    expect(editor.viewType).toBe(VIEW_TYPE)
    expect(editor.priority).toBe('option')
  })

  it('selects both markdown extensions on file and untitled schemes', () => {
    const selectors = pkg.contributes.customEditors[0].selector
    const pairs = selectors.map(
      (s: any) => `${s.filenamePattern}@${s.scheme}`
    )
    expect(pairs).toEqual(
      expect.arrayContaining([
        '*.md@file',
        '*.md@untitled',
        '*.markdown@file',
        '*.markdown@untitled',
      ])
    )
  })

  it('contributes the open/edit commands', () => {
    const ids = pkg.contributes.commands.map((c: any) => c.command)
    expect(ids).toEqual(
      expect.arrayContaining([
        'markdown-editor.openEditor',
        'markdown-editor.openTextEditor',
      ])
    )
  })

  it('binds the "edit in text editor" keybinding scoped to the custom editor', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'markdown-editor.openTextEditor'
    )
    expect(binding).toBeDefined()
    expect(binding.key).toBe('ctrl+alt+e')
    expect(binding.mac).toBe('cmd+ctrl+e')
    expect(binding.when).toBe(`activeCustomEditorId == ${VIEW_TYPE}`)
  })

  it('binds Ctrl/Cmd+F to the webview find widget inside the custom editor', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'editor.action.webvieweditor.showFind'
    )
    expect(binding).toBeDefined()
    expect(binding.key).toBe('ctrl+f')
    expect(binding.mac).toBe('cmd+f')
    expect(binding.when).toBe(`activeCustomEditorId == ${VIEW_TYPE}`)
  })

  it('activates on the custom editor and the open commands', () => {
    expect(pkg.activationEvents).toEqual(
      expect.arrayContaining([
        'onCustomEditor:markdown-editor.editor',
        'onCommand:markdown-editor.openEditor',
        'onCommand:markdown-editor.openTextEditor',
      ])
    )
  })

  it('does not eagerly activate on every markdown file (no onLanguage)', () => {
    expect(pkg.activationEvents).not.toContain('onLanguage:markdown')
  })

  it('declares the settings the provider reads, with matching types/defaults', () => {
    const props = pkg.contributes.configuration.properties
    expect(props['markdown-editor.imageSaveFolder']).toMatchObject({
      type: 'string',
      default: 'assets',
    })
    expect(props['markdown-editor.useVscodeThemeColor']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.enableFullWidth']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.customCss']).toMatchObject({ type: 'string' })
  })

  it('declares the Vditor-option toggles (wordCount, codeBlockLineNumbers, showToolbar)', () => {
    const props = pkg.contributes.configuration.properties
    expect(props['markdown-editor.wordCount']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.codeBlockLineNumbers']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['markdown-editor.showToolbar']).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })
})
