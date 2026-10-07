import { describe, it, expect } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NAMED_THEME_VALUES } from '../../src/shared/theme-registry'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
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

  // Task 460: this used to pin the literal string, and that is exactly how it failed.
  // Phase 1 moved extension.ts into `platform/` and updated both the manifest and this
  // assertion; phase 3 moved it again, `platform/` -> `app/`, and updated neither. The
  // test stayed green because it agreed with the stale manifest rather than with the
  // tree, and the extension still launched only because `out/` is never cleaned between
  // builds — a stale `out/platform/extension.js` sat next to the real `out/app/extension.js`.
  // A clean checkout would have shipped an extension that cannot activate.
  //
  // So derive the expected path from where `extension.ts` actually is. `tsconfig.json` has
  // rootDir `src`, so `src/<m>/extension.ts` compiles to `out/<m>/extension.js`.
  it('points main at wherever extension.ts actually compiles to', () => {
    const found = globSync('src/**/extension.ts', { cwd: ROOT })
    expect(found).toHaveLength(1)
    const compiled = found[0].replace(/^src\//, 'out/').replace(/\.ts$/, '.js')
    expect(pkg.main).toBe(compiled)
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

  it('binds Escape (find visible) to vmarkd.findClose, scoped to the custom editor (task 522)', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'vmarkd.findClose',
    )
    expect(binding).toBeDefined()
    expect(binding.key).toBe('escape')
    expect(binding.when).toBe(
      `webviewFindWidgetVisible && activeCustomEditorId == ${VIEW_TYPE}`,
    )
    // No other Escape binding may exist that this one could shadow.
    expect(
      pkg.contributes.keybindings.filter((k: any) => k.key === 'escape'),
    ).toHaveLength(1)
  })

  it('binds Ctrl/Cmd+F to vmarkd.findOpen (tells the webview, then opens the find widget) inside the custom editor (task 522)', () => {
    const binding = pkg.contributes.keybindings.find(
      (k: any) => k.command === 'vmarkd.findOpen',
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
    // Default ON (task 438): the editor matches VS Code's built-in markdown preview — full
    // width with the same 52px side gutter. Off = the narrow, centred 800px column.
    expect(props['vmarkd.editor.fullWidth']).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(props['vmarkd.css.custom']).toMatchObject({
      type: 'string',
    })
  })

  it('keeps Settings descriptions concise while preserving key behavior', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    const descriptions = Object.fromEntries(
      [
        'vmarkd.editor.defaultMode',
        'vmarkd.editor.fontSize',
        'vmarkd.editor.headingMarkers',
        'vmarkd.editor.modifierClickLinks',
        'vmarkd.editor.slugifyMode',
        'vmarkd.paste.csvFormat',
        'vmarkd.paste.urlAsLink',
        'vmarkd.theme.content',
        'vmarkd.diagram.mermaid.layout',
        'vmarkd.diagram.d2.theme',
        'vmarkd.diagram.d2.sketch',
        'vmarkd.diagram.geo.basemap',
        'vmarkd.css.external',
        'vmarkd.image.saveFolder',
        'vmarkd.image.format',
        'vmarkd.image.maxWidth',
        'vmarkd.image.allowRemote',
        'vmarkd.performance.streamLargeFiles',
        'vmarkd.performance.contentVisibility',
      ].map((key) => [
        key,
        props[key].markdownDescription ?? props[key].description,
      ]),
    )

    expect(descriptions).toEqual({
      'vmarkd.editor.defaultMode':
        'Default mode for opening Markdown files. You can override it per path with Default Mode by Glob. Large files always use Instant Rendering.',
      'vmarkd.editor.fontSize':
        'Editor content size. Use "editor" to follow VS Code, "vditor" for 16px, or enter a pixel value such as "15".',
      'vmarkd.editor.headingMarkers':
        'Show heading and link-reference markers in Instant Rendering mode. Disable to reduce the left margin.',
      'vmarkd.editor.modifierClickLinks':
        'Open links with Ctrl+click (Cmd+click on macOS). Disable to open links with a regular click instead.',
      'vmarkd.editor.slugifyMode':
        'Heading-anchor format used for #heading links, the outline, and link completion.',
      'vmarkd.paste.csvFormat':
        'Convert pasted spreadsheet cells to a Markdown table. Content pasted into code blocks stays unchanged.',
      'vmarkd.paste.urlAsLink':
        'Convert pasted URLs to Markdown links. With selected text, the selection becomes the link label.',
      'vmarkd.theme.content':
        'Rendered Markdown color theme. "auto" follows VS Code; named themes use their own palette. Configure code colors separately.',
      'vmarkd.diagram.mermaid.layout':
        'Layout engine for Mermaid graph diagrams. Use ELK for more compact graphs; other Mermaid diagram types are unaffected.',
      'vmarkd.diagram.d2.theme':
        'Color theme for D2 diagrams. "auto" follows the render theme; "mono" uses the editor foreground.',
      'vmarkd.diagram.d2.sketch':
        'Use a hand-drawn style for D2 diagrams. Colors still follow the selected D2 theme.',
      'vmarkd.diagram.geo.basemap':
        'Basemap for GeoJSON and TopoJSON maps. Remote tiles require Allow Remote Images; "none" works offline.',
      'vmarkd.css.external':
        'External CSS files to load in the editor. Paths may be absolute or workspace-relative; changes reload automatically.',
      'vmarkd.image.saveFolder':
        'Destination folder for uploaded images. Use `${projectRoot}/assets` for a project-level folder.',
      'vmarkd.image.format':
        'Output format for uploaded and pasted images. WebP reduces raster image size; SVG and GIF files keep their original format.',
      'vmarkd.image.maxWidth':
        'Resize uploaded and pasted images wider than this value. Use 0 to disable resizing.',
      'vmarkd.image.allowRemote':
        'Allow remote HTTPS images in the editor. Disabled by default because loading them can reveal your IP and that you opened the file. Reopen the editor after changing this setting.',
      'vmarkd.performance.streamLargeFiles':
        'Load large Markdown files in chunks to keep the editor responsive. Files around 700 KB or larger use this automatically.',
      'vmarkd.performance.contentVisibility':
        'Improve large-document performance by skipping off-screen layout and painting. Reopen the file after changing this setting.',
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
    // advanced.retainHidden + advanced.instantPreview graduated to ALWAYS ON — no user settings.
    expect(props['vmarkd.advanced.retainHidden']).toBeUndefined()
    expect(props['vmarkd.advanced.instantPreview']).toBeUndefined()
  })

  it('declares the outline settings (highlightHeadings, outlinePosition/Width, showOutlineByDefault, outlineHighlight)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    // Task 489 renamed this: theme.highlightHeadings -> editor.headingColors (a feature toggle, not
    // a theme). The old key stays declared-but-deprecated, so assert the LIVE one.
    expect(props['vmarkd.editor.headingColors']).toMatchObject({
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
    expect(props['vmarkd.outline.defaultOpen']).toMatchObject({
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
    // Task 489: theme.mermaid -> diagram.mermaid.theme (per-engine grouping).
    expect(props['vmarkd.diagram.mermaid.theme']).toMatchObject({
      type: 'string',
      default: 'auto',
    })
    expect(props['vmarkd.diagram.mermaid.theme'].enum).toEqual(
      expect.arrayContaining(['auto', 'default', 'forest']),
    )
    // task 51: per-value dropdown help, parallel to enum by index.
    const mermaid = props['vmarkd.diagram.mermaid.theme']
    expect(mermaid.enumDescriptions).toHaveLength(mermaid.enum.length)
    expect(mermaid.enumDescriptions[0]).toMatch(/VS Code/i)
  })

  it('declares the geoBasemap setting (enum incl. auto/voyager/osm/none, default "auto")', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    const geo = props['vmarkd.diagram.geo.basemap']
    expect(geo).toMatchObject({ type: 'string', default: 'auto' })
    expect(geo.enum).toEqual(['auto', 'voyager', 'osm', 'none'])
    // per-value dropdown help, parallel to enum by index (task 51 convention)
    expect(geo.enumDescriptions).toHaveLength(geo.enum.length)
  })

  it('has no fast-edit / render-cache settings — they graduated to ALWAYS ON (tasks 175/180/184)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    // These optimisations are no longer user settings — they run unconditionally (fastDiagramEdit 175,
    // fastProseEdit 180, diagramRenderCache 184), and the capture/re-home experiment (stableRenderNode
    // 183) was removed entirely.
    expect(props['vmarkd.advanced.fastDiagramEdit']).toBeUndefined()
    expect(props['vmarkd.advanced.fastProseEdit']).toBeUndefined()
    expect(props['vmarkd.advanced.diagramRenderCache']).toBeUndefined()
    expect(props['vmarkd.advanced.stableRenderNode']).toBeUndefined()
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

  it('declares the fontSize setting under Editor, default "editor" (task 43)', () => {
    const props = Object.assign(
      {},
      ...pkg.contributes.configuration.map((c: any) => c.properties),
    )
    expect(props['vmarkd.editor.fontSize']).toMatchObject({
      type: 'string',
      default: 'editor',
    })
    // Task 489 renamed the group: "Appearance" only ever held editor.* keys.
    const editor = pkg.contributes.configuration.find(
      (c: any) => c.title === 'Editor',
    )
    expect(Object.keys(editor.properties)).toContain('vmarkd.editor.fontSize')
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

  // Task 489 — the categories were regrouped so that the UI section a setting appears in matches its
  // key namespace. Before, `diagram.*` sat under "Themes" and `slugifyMode`/`paste.*` under
  // "Appearance"; a reader scanning the Settings UI had no way to predict where a key lived.
  it('groups settings into titled sections whose namespaces match the category', () => {
    expect(Array.isArray(pkg.contributes.configuration)).toBe(true)
    const titles = pkg.contributes.configuration.map((c: any) => c.title)
    expect(titles).toEqual([
      'Editor',
      'Themes',
      'Diagrams',
      'Custom CSS',
      'Outline',
      'Image',
      'Wiki',
      'Performance',
    ])
    const group = (title: string) =>
      pkg.contributes.configuration.find((c: any) => c.title === title)
    const keysOf = (title: string) =>
      Object.keys(group(title).properties).map((k: string) =>
        k.replace(/^vmarkd\./, ''),
      )
    // Each live category owns one or two namespaces — nothing foreign leaks in.
    const OWNED: Record<string, string[]> = {
      Editor: ['editor.', 'paste.'],
      Themes: ['theme.'],
      Diagrams: ['diagram.'],
      'Custom CSS': ['css.'],
      Outline: ['outline.'],
      Image: ['image.'],
      Wiki: ['wiki.'],
      Performance: ['performance.'],
    }
    for (const [title, prefixes] of Object.entries(OWNED))
      for (const key of keysOf(title))
        expect(
          prefixes.some((p) => key.startsWith(p)),
          `${key} does not belong under "${title}"`,
        ).toBe(true)
    // The content theme leads its section — it drives every other renderer's palette.
    expect(keysOf('Themes')).toEqual(['theme.content', 'theme.code'])
  })

  // The old Themes group had TWO settings at `order: 7`, so their UI position was undefined.
  it('gives every setting a distinct order within its group', () => {
    for (const group of pkg.contributes.configuration) {
      const orders = Object.values(group.properties).map((p: any) => p.order)
      expect(orders, `${group.title} has an unordered setting`).not.toContain(
        undefined,
      )
      expect(new Set(orders).size, `${group.title} has duplicate orders`).toBe(
        orders.length,
      )
    }
  })
})
