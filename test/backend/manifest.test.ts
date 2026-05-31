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

  it('declares untrusted + virtual workspace capabilities as limited', () => {
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe('limited')
    expect(pkg.capabilities.virtualWorkspaces.supported).toBe('limited')
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

  it('contributes an Open-Settings command shown in the editor title for the custom editor', () => {
    const cmd = pkg.contributes.commands.find(
      (c: any) => c.command === 'markdown-editor.openSettings'
    )
    expect(cmd).toBeDefined()
    expect(cmd.icon).toBe('$(settings-gear)')
    const inTitle = pkg.contributes.menus['editor/title'].some(
      (m: any) =>
        m.command === 'markdown-editor.openSettings' &&
        m.when === `activeCustomEditorId == ${VIEW_TYPE}`
    )
    expect(inTitle).toBe(true)
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
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties)
    )
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
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties)
    )
    expect(props['markdown-editor.wordCount']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['markdown-editor.codeBlockLineNumbers']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['markdown-editor.showToolbar']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.retainHiddenEditors']).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })

  it('declares the outline settings (highlightHeadings, outlinePosition/Width, showOutlineByDefault, outlineHighlight)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties)
    )
    expect(props['markdown-editor.highlightHeadings']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.showHeadingMarkers']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['markdown-editor.outlinePosition']).toMatchObject({
      type: 'string',
      enum: ['left', 'right'],
      default: 'right',
    })
    expect(props['markdown-editor.outlineWidth']).toMatchObject({
      type: 'number',
      default: 200,
    })
    expect(props['markdown-editor.showOutlineByDefault']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['markdown-editor.outlineHighlight']).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })

  it('declares the fontSize setting under Appearance, default "editor" (task 43)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties)
    )
    expect(props['markdown-editor.fontSize']).toMatchObject({
      type: 'string',
      default: 'editor',
    })
    const appearance = pkg.contributes.configuration.find(
      (c: any) => c.title === 'Appearance'
    )
    expect(Object.keys(appearance.properties)).toContain('markdown-editor.fontSize')
  })

  it('declares the externalCssFiles setting', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties)
    )
    expect(props['markdown-editor.externalCssFiles']).toMatchObject({
      type: 'array',
      default: [],
    })
  })

  it('groups settings into titled sections, with visual-presence ones under Appearance', () => {
    expect(Array.isArray(pkg.contributes.configuration)).toBe(true)
    const titles = pkg.contributes.configuration.map((c: any) => c.title)
    expect(titles).toEqual(
      expect.arrayContaining(['General', 'Appearance', 'Outline'])
    )
    const appearance = pkg.contributes.configuration.find(
      (c: any) => c.title === 'Appearance'
    )
    expect(Object.keys(appearance.properties)).toEqual(
      expect.arrayContaining([
        'markdown-editor.highlightHeadings',
        'markdown-editor.showHeadingMarkers',
        'markdown-editor.enableFullWidth',
      ])
    )
  })
})
