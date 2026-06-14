import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NAMED_THEME_VALUES } from '../../src/theme-registry'

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
)

const VIEW_TYPE = 'vmarkd.editor'

describe('package.json manifest', () => {
  // task 84: the manifest enum must stay in sync with the single-source theme
  // registry — `auto` plus exactly the registry's named themes, in order. Guards
  // against adding a theme to the registry but forgetting the manifest (or vice versa).
  it('theme.content enum == auto + the registry themes (registry is the source)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.theme.content'].enum).toEqual([
      'auto',
      ...NAMED_THEME_VALUES,
    ])
  })

  it('points main at the compiled extension entry', () => {
    expect(pkg.main).toBe('out/extension.js')
  })

  it('declares a ^1.110 engines floor (ThemeIcon tab icon / l10n / telemetry)', () => {
    expect(pkg.engines.vscode).toBe('^1.110.0')
  })

  it('pins extensionKind to workspace — it reads the local FS (task 51)', () => {
    expect(pkg.extensionKind).toEqual(['workspace'])
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
    const pairs = selectors.map((s: any) => `${s.filenamePattern}@${s.scheme}`)
    expect(pairs).toEqual(
      expect.arrayContaining([
        '*.md@file',
        '*.md@untitled',
        '*.markdown@file',
        '*.markdown@untitled',
      ]),
    )
  })

  it('contributes the open/edit commands', () => {
    const ids = pkg.contributes.commands.map((c: any) => c.command)
    expect(ids).toEqual(
      expect.arrayContaining(['vmarkd.openEditor', 'vmarkd.openTextEditor']),
    )
  })

  it('contributes an Open-in-Split command shown in the editor title (task 10)', () => {
    const cmd = pkg.contributes.commands.find(
      (c: any) => c.command === 'vmarkd.openInSplit',
    )
    expect(cmd).toBeDefined()
    expect(cmd.icon).toBe('$(split-horizontal)')
    const inTitle = pkg.contributes.menus['editor/title'].some(
      (m: any) =>
        m.command === 'vmarkd.openInSplit' &&
        m.when.includes(`activeCustomEditorId != ${VIEW_TYPE}`),
    )
    expect(inTitle).toBe(true)
  })

  it('contributes an Open-source-to-the-side command in the custom-editor title (task 36)', () => {
    const cmd = pkg.contributes.commands.find(
      (c: any) => c.command === 'vmarkd.openSourceToSide',
    )
    expect(cmd).toBeDefined()
    const inTitle = pkg.contributes.menus['editor/title'].some(
      (m: any) =>
        m.command === 'vmarkd.openSourceToSide' &&
        m.when === `activeCustomEditorId == ${VIEW_TYPE}`,
    )
    expect(inTitle).toBe(true)
  })

  it('contributes an Open-Settings command but NOT in the editor title bar', () => {
    const cmd = pkg.contributes.commands.find(
      (c: any) => c.command === 'vmarkd.openSettings',
    )
    expect(cmd).toBeDefined() // available via the command palette
    // intentionally absent from the editor title bar to keep it uncluttered
    const inTitle = pkg.contributes.menus['editor/title'].some(
      (m: any) => m.command === 'vmarkd.openSettings',
    )
    expect(inTitle).toBe(false)
  })

  it('binds the "edit in text editor" keybinding scoped to the custom editor', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'vmarkd.openTextEditor',
    )
    expect(binding).toBeDefined()
    expect(binding.key).toBe('ctrl+alt+e')
    expect(binding.mac).toBe('cmd+ctrl+e')
    expect(binding.when).toBe(`activeCustomEditorId == ${VIEW_TYPE}`)
  })

  it('binds Ctrl/Cmd+F to the webview find widget inside the custom editor', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'editor.action.webvieweditor.showFind',
    )
    expect(binding).toBeDefined()
    expect(binding.key).toBe('ctrl+f')
    expect(binding.mac).toBe('cmd+f')
    expect(binding.when).toBe(`activeCustomEditorId == ${VIEW_TYPE}`)
  })

  it('activates on the custom editor and the open commands', () => {
    expect(pkg.activationEvents).toEqual(
      expect.arrayContaining([
        'onCustomEditor:vmarkd.editor',
        'onCommand:vmarkd.openEditor',
        'onCommand:vmarkd.openTextEditor',
      ]),
    )
  })

  it('does not eagerly activate on every markdown file (no onLanguage)', () => {
    expect(pkg.activationEvents).not.toContain('onLanguage:markdown')
  })

  it('declares the settings the provider reads, with matching types/defaults', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.image.saveFolder']).toMatchObject({
      type: 'string',
      default: 'assets',
    })
    expect(props['vmarkd.theme.content']).toMatchObject({
      type: 'string',
      default: 'auto',
      enum: [
        'auto',
        'github-light',
        'github-dark',
        'material-dark',
        'vscode-light-2026',
        'vscode-dark-2026',
      ],
    })
    expect(props['vmarkd.editor.fullWidth']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['vmarkd.css.custom']).toMatchObject({
      type: 'string',
    })
  })

  it('scopes css.custom / css.external / image.saveFolder to resource (task 51 #3)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.css.custom'].scope).toBe('resource')
    expect(props['vmarkd.css.external'].scope).toBe('resource')
    expect(props['vmarkd.image.saveFolder'].scope).toBe('resource')
  })

  it('declares the Vditor-option toggles (codeBlockLineNumbers, showToolbar)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.editor.codeLineNumbers']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['vmarkd.editor.toolbar']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['vmarkd.advanced.retainHidden']).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })

  it('declares the outline settings (highlightHeadings, outlinePosition/Width, showOutlineByDefault, outlineHighlight)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.theme.highlightHeadings']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['vmarkd.editor.headingMarkers']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['vmarkd.outline.position']).toMatchObject({
      type: 'string',
      enum: ['left', 'right'],
      default: 'right',
    })
    expect(props['vmarkd.outline.width']).toBeUndefined()
    expect(props['vmarkd.outline.openByDefault']).toMatchObject({
      type: 'boolean',
      default: false,
    })
    expect(props['vmarkd.outline.highlight']).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })

  it('declares the mermaidTheme setting (enum, default "auto")', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.theme.mermaid']).toMatchObject({
      type: 'string',
      default: 'auto',
    })
    expect(props['vmarkd.theme.mermaid'].enum).toEqual(
      expect.arrayContaining(['auto', 'default', 'forest']),
    )
    // task 51: per-value dropdown help, parallel to enum by index.
    const mermaid = props['vmarkd.theme.mermaid']
    expect(mermaid.enumDescriptions).toHaveLength(mermaid.enum.length)
    expect(mermaid.enumDescriptions[0]).toMatch(/VS Code/i)
  })

  it('describes the "auto" value of theme.code (task 51)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    const code = props['vmarkd.theme.code']
    expect(code.enum[0]).toBe('auto')
    // single-entry array: only "auto" (index 0) gets help; the 70+ named
    // highlight.js styles are self-evident and left undescribed.
    expect(code.enumDescriptions[0]).toMatch(/VS Code/i)
  })

  it('declares the fontSize setting under Appearance, default "editor" (task 43)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.editor.fontSize']).toMatchObject({
      type: 'string',
      default: 'editor',
    })
    const appearance = pkg.contributes.configuration.find(
      (c: any) => c.title === 'Appearance',
    )
    expect(Object.keys(appearance.properties)).toContain(
      'vmarkd.editor.fontSize',
    )
  })

  it('declares the externalCssFiles setting', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.css.external']).toMatchObject({
      type: 'array',
      default: [],
    })
  })

  it('groups settings into titled sections: theming under Themes (content first), editor presets under Appearance', () => {
    expect(Array.isArray(pkg.contributes.configuration)).toBe(true)
    const titles = pkg.contributes.configuration.map((c: any) => c.title)
    expect(titles).toEqual(
      expect.arrayContaining(['Themes', 'Appearance', 'Outline', 'Advanced']),
    )
    const group = (title: string) =>
      pkg.contributes.configuration.find((c: any) => c.title === title)
    // All theming lives in its own group, with the content theme FIRST — it drives
    // every other renderer's palette, so it leads the section.
    const themes = group('Themes')
    expect(Object.keys(themes.properties)[0]).toBe('vmarkd.theme.content')
    expect(Object.keys(themes.properties)).toEqual(
      expect.arrayContaining([
        'vmarkd.theme.content',
        'vmarkd.theme.highlightHeadings',
      ]),
    )
    // Appearance holds the editor-presentation toggles (not theming).
    const appearance = group('Appearance')
    expect(Object.keys(appearance.properties)).toEqual(
      expect.arrayContaining([
        'vmarkd.editor.fullWidth',
        'vmarkd.editor.headingMarkers',
      ]),
    )
  })
})
