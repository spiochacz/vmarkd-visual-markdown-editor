import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import * as fs from 'node:fs'
import { resolveDefaultMode } from './default-mode'
import {
  resolveAutoContentTheme,
  resolveContentTheme,
  resolveMarkdownPreviewFontFamily,
  themeDef,
} from '../shared/theme-registry'
import type { VmarkdConfigOptions } from '../shared/protocol'

// Task 184 — engine-version stamp folded into the diagram-cache hash key. Reuses the
// extension version (the lowest-risk existing constant): a re-pin of any bundled engine
// ships with a version bump, which changes every cache hash → old SVGs are never reused
// (and the disk store is wiped on load when the stored version differs). A shared free
// function so both collectConfigOptions and the DiagramCache getter can use it.
export function extensionVersion(): string {
  return (
    (vscode.extensions.getExtension('spiochacz.vmarkd')?.packageJSON?.version as
      | string
      | undefined) ?? '0'
  )
}

export function vmarkdConfig() {
  return vscode.workspace.getConfiguration('vmarkd')
}

// Resource-scoped config read (task 51 #3). The settings declared with
// `scope: "resource"` (css.custom / css.external / image.saveFolder) can be
// overridden per-project via .vscode/settings.json — but only if the read
// passes the document URI. Without a uri this is identical to `vmarkdConfig`.
export function cfgFor(uri?: vscode.Uri) {
  return vscode.workspace.getConfiguration('vmarkd', uri)
}

// Map the active VS Code color theme to the webview's two-value theme. Used by
// both the init payload and the live onDidChangeActiveColorTheme listener so
// they stay in sync (task 25). Moved here (task 405) so both extension.ts and
// panel-config.ts can call it without importing back into extension.ts.
function currentThemeKind(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme.kind
  return kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
    ? 'dark'
    : 'light'
}

// `auto` normally follows VS Code's CSS variables. For the built-in Modern and GitHub
// workbench themes, use the matching VMark stylesheet so markdown and diagrams use
// the same hand-maintained palette as the corresponding VS Code preview.
export function effectiveContentTheme(uri?: vscode.Uri): string {
  const configured = resolveContentTheme(
    cfgFor(uri).get<string>('theme.content'),
  )
  if (configured !== 'auto') return configured
  return resolveAutoContentTheme(
    vscode.workspace.getConfiguration('workbench').get<string>('colorTheme'),
    currentThemeKind(),
  )
}

export function markdownPreviewFontFamily(uri?: vscode.Uri): string {
  return resolveMarkdownPreviewFontFamily(
    vscode.workspace
      .getConfiguration('markdown', uri)
      .get<string>('preview.fontFamily'),
  )
}

// The editor's light/dark MODE (task 82). A GitHub content theme pins the mode to
// its own light/dark so the rendered content — including code blocks (hljs) — is
// themed consistently (github-light → light code, not the VS Code dark code). The
// toolbar/chrome stays VS Code-coloured regardless (its CSS vars are mode-independent
// in main.css). `auto` follows the VS Code theme.
export function effectiveThemeKind(uri?: vscode.Uri): 'dark' | 'light' {
  // `uri` (task 295): theme.content is resource-scoped, so a folder that pins github-light must
  // resolve to a LIGHT mode for its own documents even while another root stays dark.
  const ct = effectiveContentTheme(uri)
  // A named theme pins its own mode (registry); `auto`/unknown follows VS Code.
  return themeDef(ct)?.mode ?? currentThemeKind()
}

// Scope the webview's filesystem reach (task 18 §2a). Previously the roots were
// the whole disk (`/` + every Windows drive), letting the webview load any local
// file. Narrow to exactly what we serve:
//   - the extension's `media` dir (Vditor assets: the local `cdn` base where
//     Mermaid/KaTeX/etc. are self-hosted — MUST stay in the roots or diagram/
//     math rendering silently 404s),
//   - the document's workspace folder (covers images referenced relative to the
//     doc or the workspace), or its own directory when there is no workspace.
export function webviewRoots(
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri,
): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'media')]
  const ws = vscode.workspace.getWorkspaceFolder(documentUri)
  if (ws) roots.push(ws.uri)
  else if (documentUri.scheme === 'file')
    roots.push(vscode.Uri.file(NodePath.dirname(documentUri.fsPath)))
  return roots
}

// Only the webview options we deliberately control (task 27). The caller spreads
// these over the existing `webview.options` so VS Code's sensible custom-editor
// defaults are augmented, not wholesale-replaced. `retainContextWhenHidden` is a
// panel-level option set at registerCustomEditorProvider (task 37) — it is not a
// WebviewOptions field, so it does not belong here.
export function getWebviewOptions(
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri,
): vscode.WebviewOptions {
  return {
    // Enable javascript in the webview
    enableScripts: true,
    // Narrowed to the extension media dir + the document's workspace (task 18 §2a).
    localResourceRoots: webviewRoots(extensionUri, documentUri),
    // Navigation goes through postMessage (open-link / navigate-back / …), never
    // `command:` URIs, so keep them disabled to reduce webview privilege (task 27).
    enableCommandUris: false,
  }
}

// External CSS files (task 12): resolve each `externalCssFiles` entry (absolute,
// or relative to the first workspace folder) and concatenate their contents.
// Read synchronously so it can feed the (sync) HTML build; unreadable/missing
// files are skipped. Local-fs only — a no-op in virtual workspaces.
export function readExternalCss(uri?: vscode.Uri): string {
  const files = cfgFor(uri).get<string[]>('css.external') || []
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const chunks: string[] = []
  for (const f of files) {
    if (!f) continue
    const p = NodePath.isAbsolute(f) ? f : root ? NodePath.join(root, f) : f
    try {
      chunks.push(fs.readFileSync(p, 'utf8'))
    } catch {
      // skip missing / unreadable / non-file-scheme
    }
  }
  return chunks.join('\n')
}

export function resolveExternalCssPaths(uri?: vscode.Uri): string[] {
  const files = cfgFor(uri).get<string[]>('css.external') || []
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  return files
    .filter(Boolean)
    .map((f) =>
      NodePath.isAbsolute(f) ? f : root ? NodePath.join(root, f) : f,
    )
}

// Vditor's saved options can bake absolute webview-resource URLs that embed
// the extension's *versioned* install dir — e.g. `preview.theme.path` ends up
// as `…/extensions/spiochacz.vmarkd-0.4.0/media/vditor/dist/css/content-theme`.
// We persist these in globalState (and mark the key for Settings Sync), then
// spread them back into the init options on every open. After the extension
// updates (or on another machine), that stale path points at a dir that no
// longer exists / is outside localResourceRoots → the content/code-theme CSS
// 401s and the editor renders with no colors. Strip any baked resource URL so
// Vditor recomputes every path from the current `cdn`. Applied on both read
// (heals existing dirty/synced state) and write (never re-persists it).
export function sanitizeVditorOptions<T>(options: T): T {
  if (!options || typeof options !== 'object') return options
  const isBakedResourceUrl = (s: string) =>
    /vscode-resource|vscode-cdn\.net|[/\\]extensions[/\\]spiochacz\.vmarkd-|\.vscode-server[/\\]extensions/.test(
      s,
    )
  const clone = JSON.parse(JSON.stringify(options))
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (typeof v === 'string') {
        if (isBakedResourceUrl(v)) delete o[k]
      } else if (typeof v === 'object') {
        walk(v)
      }
    }
  }
  walk(clone)
  return clone
}

// The user-configurable Vditor options read from VS Code settings, in one place.
// Both the initial `update`/init payload and the live `config-changed` push send
// exactly these keys (init additionally spreads the saved Vditor options on top),
// so adding a setting means touching only this list.
export function collectConfigOptions(uri?: vscode.Uri): VmarkdConfigOptions {
  // Task 295 — read against the DOCUMENT's uri so a `.vscode/settings.json` in its own workspace
  // folder wins. Every key below is declared `"scope": "resource"` in package.json; the two must
  // stay in step, since a resource-scoped declaration whose read drops the uri is exactly the
  // silent-ignore bug this fixes, and a uri-aware read of a window-scoped setting just no-ops.
  const c = cfgFor(uri)
  // Rendering theme (task 82): explicit named themes always win; `auto` pairs to a
  // recognized active VS Code theme and otherwise keeps the VS Code-colour path.
  const contentTheme = effectiveContentTheme(uri)
  return {
    contentTheme,
    useVscodeThemeColor: contentTheme === 'auto',
    markdownPreviewFontFamily: markdownPreviewFontFamily(uri),
    enableFullWidth: c.get<boolean>('editor.fullWidth'),
    codeBlockLineNumbers: c.get<boolean>('editor.codeLineNumbers'),
    mermaidTheme: c.get<string>('diagram.mermaid.theme'),
    // Opt-in ELK layout for mermaid graph diagrams (task 112) — dagre (default) | elk.
    mermaidLayout: c.get<string>('diagram.mermaid.layout'),
    echartsTheme: c.get<string>('diagram.echarts.theme'),
    d2Layout: c.get<string>('diagram.d2.layout'),
    d2Theme: c.get<string>('diagram.d2.theme'),
    // Opt-in hand-drawn "sketch" look for D2 diagrams (task 120) — rough.js wobbly shapes + edges.
    d2Sketch: c.get<boolean>('diagram.d2.sketch'),
    // Basemap under geojson/topojson maps (diagram.geo.basemap). `auto` (default) = themed
    // monochrome CARTO; only takes effect when image.allowRemote is on (CSP). Read by initLeafletMap.
    geoBasemap: c.get<string>('diagram.geo.basemap'),
    showToolbar: c.get<boolean>('editor.toolbar'),
    highlightHeadings: c.get<boolean>('editor.headingColors'),
    showHeadingMarkers: c.get<boolean>('editor.headingMarkers'),
    fontSize: c.get<string>('editor.fontSize'),
    outlinePosition: c.get<string>('outline.position'),
    showOutlineByDefault: c.get<boolean>('outline.defaultOpen'),
    outlineHighlight: c.get<boolean>('outline.highlight'),
    codeTheme: c.get<string>('theme.code'),
    streamLargeFiles: c.get<boolean>('performance.streamLargeFiles'),
    contentVisibility: c.get<boolean>('performance.contentVisibility'),
    // Task 175/180 — defer the per-keystroke spin in fenced diagram/code bodies + for inert prose
    // keystrokes are ALWAYS ON (no setting); nothing to read here.
    linkOpenWithModifier: c.get<boolean>('editor.modifierClickLinks'),
    // Task 392 — paste a URL as a markdown link. A reflex action, so it must be switchable off.
    pasteUrlAsLink: c.get<boolean>('paste.urlAsLink'),
    // Image upload conversion (task 74) — read by the webview's upload handler.
    imageFormat: c.get<string>('image.format'),
    imageQuality: c.get<number>('image.quality'),
    imageMaxWidth: c.get<number>('image.maxWidth'),
    // Lets the webview add a remote basemap tile layer to geojson/topojson maps (task 99). The CSP
    // is the real gate (img-src adds `https:` only when this is on); the webview reads this to decide
    // whether to request tiles at all (so they aren't added + blocked when off).
    allowRemoteImages: c.get<boolean>('image.allowRemote') === true,
    wikiEnabled: c.get<boolean>('wiki.enabled') !== false,
    // Task 218 — convert a pasted TSV/CSV block into a markdown table.
    pasteCsvAsTable: c.get<string>('paste.csvFormat'),
    // Task 243 — which heading-slug flavor `#fragment` anchor links resolve against.
    slugifyMode: c.get<string>('editor.slugifyMode'),
    // Task 530 — the written form of a new hard line break.
    hardBreakStyle: c.get<string>('editor.hardBreakStyle'),
    // Task 83 — soft line breaks flow (Preview half; the editor surfaces follow in a later increment).
    reflowLineBreaks: c.get<boolean>('editor.reflowLineBreaks'),
    // Task 282 — resolved HERE, not in the webview: the glob match needs the document's
    // workspace-relative path. `asRelativePath(uri, false)` omits the folder name so a pattern like
    // `docs/**` means the same thing in a single-root and a multi-root workspace.
    defaultMode: resolveDefaultMode({
      setting: c.get<string>('editor.defaultMode'),
      byGlob: c.get<Record<string, string>>('editor.defaultModeByGlob'),
      relPath: uri ? vscode.workspace.asRelativePath(uri, false) : undefined,
    }),
    // Task 184 — engine-version stamp folded into the cache hash key (the webview computes
    // the hash). A version bump ⇒ every hash changes ⇒ old cached SVGs are never reused.
    assetsVersion: extensionVersion(),
  }
}

export function getAssetsFolder(uri: vscode.Uri) {
  const imageSaveFolder = (
    cfgFor(uri).get<string>('image.saveFolder') || 'assets'
  )
    .replace(
      '${projectRoot}',
      vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || '',
    )
    .replace('${file}', uri.fsPath)
    .replace(
      '${fileBasenameNoExtension}',
      NodePath.basename(uri.fsPath, NodePath.extname(uri.fsPath)),
    )
    .replace('${dir}', NodePath.dirname(uri.fsPath))
  const assetsFolder = NodePath.resolve(
    NodePath.dirname(uri.fsPath),
    imageSaveFolder,
  )
  return assetsFolder
}
