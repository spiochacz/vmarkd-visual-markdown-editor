import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import * as fs from 'node:fs'
import { readingTime } from './reading-time'
import { selectionForLine } from './reveal-range'
import { createDiffScheduler, makeDiffComputer } from './git-diff'
import { prewarmLute, renderIR } from './lute-host'
import {
  collectWikiMarkdownFiles,
  getWikiDocumentContext,
  getWikiPageKeys,
  getWikiRoot,
  isWikiFile,
  resolveWikiLink,
} from './wiki'

const KeyVditorOptions = 'vditor.options'
const MarkdownEditorViewType = 'markdown-editor.editor'
const WikiFileContextKey = 'markdown-editor.isWikiFile'
const SupportedSchemes = new Set(['file', 'untitled'])
const SupportedMarkdownExtensions = new Set(['.md', '.markdown'])

// Levelled log channel (task 18 §2d). Replaces raw `console.log`, which always
// dumped full payloads — including document content — to the dev console.
// Routed at `trace`, so content-bearing logs surface only when the user raises
// the channel's log level; nothing leaks at the default level.
let logger: vscode.LogOutputChannel | undefined

function debug(...args: any[]) {
  if (!logger) return
  logger.trace(
    args
      .map((a) => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' '),
  )
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
}

// Random per-render nonce so only our own <script> tags are allowed to run
// under the CSP (task 18 §2c) — injected inline scripts (no nonce) cannot.
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}

function normalizeContent(content: string) {
  return content.replace(/\r\n/g, '\n')
}

// Map the active VS Code color theme to the webview's two-value theme. Used by
// both the init payload and the live onDidChangeActiveColorTheme listener so
// they stay in sync (task 25).
function currentThemeKind(): 'dark' | 'light' {
  const kind = vscode.window.activeColorTheme.kind
  return kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
    ? 'dark'
    : 'light'
}

// Gate filesystem-writing actions (image upload, wiki page creation) on the
// declared capabilities (see package.json `capabilities`): not in virtual
// workspaces (non-file scheme), and not in an untrusted workspace.
function ensureCanWriteFiles(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') {
    vscode.window.showInformationMessage(
      `[markdown-editor] Image upload and wiki page creation are unavailable in virtual workspaces.`,
    )
    return false
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      `[markdown-editor] Trust this workspace to upload images and create wiki pages.`,
    )
    return false
  }
  return true
}

function isSupportedMarkdownUri(uri: vscode.Uri) {
  return (
    SupportedSchemes.has(uri.scheme) &&
    SupportedMarkdownExtensions.has(NodePath.extname(uri.path).toLowerCase())
  )
}

function getActiveTabInput() {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.input
}

// Scan every tab group for a tab already showing `uri` in the given editor kind
// — our custom (WYSIWYG) editor, or a plain text editor. Lets us reveal an
// existing tab in its own column instead of opening a duplicate (task 36).
function findTabForUri(
  uri: vscode.Uri,
  kind: 'custom' | 'text',
): vscode.Tab | undefined {
  const want = uri.toString()
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input
      if (
        kind === 'custom' &&
        input instanceof vscode.TabInputCustom &&
        input.viewType === MarkdownEditorViewType &&
        input.uri.toString() === want
      ) {
        return tab
      }
      if (
        kind === 'text' &&
        input instanceof vscode.TabInputText &&
        input.uri.toString() === want
      ) {
        return tab
      }
    }
  }
  return undefined
}

function getCommandTarget(uri?: vscode.Uri) {
  if (uri) {
    return uri
  }

  const activeInput = getActiveTabInput()
  if (
    activeInput instanceof vscode.TabInputText ||
    activeInput instanceof vscode.TabInputCustom
  ) {
    return activeInput.uri
  }

  const activeEditorUri = vscode.window.activeTextEditor?.document.uri
  if (activeEditorUri) {
    return activeEditorUri
  }

  return undefined
}

function isDiffContextForUri(uri: vscode.Uri) {
  const activeInput = getActiveTabInput()
  return (
    activeInput instanceof vscode.TabInputTextDiff &&
    (activeInput.original.toString() === uri.toString() ||
      activeInput.modified.toString() === uri.toString())
  )
}

async function updateEditorContexts() {
  const target = getCommandTarget()
  await vscode.commands.executeCommand(
    'setContext',
    WikiFileContextKey,
    isWikiFile(target),
  )
}

// Native status-bar items (task 35): estimated reading time + an editor-mode
// indicator (WYSIWYG vs Source), shown only while a markdown doc is the active
// tab. Returns an `update` fn the caller wires to the same active-tab / document
// listeners that drive updateEditorContexts.
function setupStatusBar(context: vscode.ExtensionContext): () => void {
  const reading = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  )
  reading.name = 'vMarkd Reading Time'
  const mode = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  )
  mode.name = 'vMarkd Editor Mode'
  context.subscriptions.push(reading, mode)

  const textForUri = (uri: vscode.Uri): string =>
    vscode.workspace.textDocuments
      .find((d) => d.uri.toString() === uri.toString())
      ?.getText() ?? ''

  return () => {
    const input = getActiveTabInput()
    const showFor = (uri: vscode.Uri) => {
      reading.text = `$(book) ${readingTime(textForUri(uri))}`
      reading.show()
    }
    if (
      input instanceof vscode.TabInputCustom &&
      input.viewType === MarkdownEditorViewType
    ) {
      showFor(input.uri)
      mode.text = '$(eye) WYSIWYG'
      mode.tooltip = 'Markdown: visual editor — click to edit as source'
      mode.command = 'markdown-editor.openTextEditor'
      mode.show()
    } else if (
      input instanceof vscode.TabInputText &&
      isSupportedMarkdownUri(input.uri)
    ) {
      showFor(input.uri)
      mode.text = '$(code) Source'
      mode.tooltip = 'Markdown: source view — click to open the visual editor'
      mode.command = 'markdown-editor.openEditor'
      mode.show()
    } else {
      reading.hide()
      mode.hide()
    }
  }
}

// Open a vMarkd document's source in a text editor and select the caret's line
// (task 16). Shared by the revealInSource command (opens Beside) and the
// edit-in-vscode toolbar button (opens in the active column). The webview is
// asked for the caret's line + that line's text — measured against
// vditor.getValue() — and we match by CONTENT in the real doc so Vditor's
// on-load reflow (a blank line after a heading, `>` re-prefixing) can't shift
// the target. If the caret can't be resolved, we still open the editor (at the
// top) so the button always does something.
async function revealCaretInSource(
  panel: vscode.WebviewPanel,
  docUri: vscode.Uri,
  viewColumn: vscode.ViewColumn,
): Promise<void> {
  const reply = await new Promise<{ line: number; lineText: string }>(
    (resolve) => {
      const timeout = setTimeout(() => {
        sub.dispose()
        resolve({ line: -1, lineText: '' })
      }, 1000)
      const sub = panel.webview.onDidReceiveMessage((msg: any) => {
        if (msg?.command === 'cursor-offset') {
          clearTimeout(timeout)
          sub.dispose()
          resolve({
            line: typeof msg.line === 'number' ? msg.line : -1,
            lineText: typeof msg.lineText === 'string' ? msg.lineText : '',
          })
        }
      })
      panel.webview.postMessage({ command: 'get-cursor-offset' })
    },
  )

  const editor = await vscode.window.showTextDocument(docUri, {
    viewColumn,
    preview: false,
  })
  if (reply.line < 0) return // opened, but no caret to jump to

  const doc = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === docUri.toString(),
  )
  const text = doc ? doc.getText() : editor.document.getText()
  const { line, startChar, endChar } = selectionForLine(
    text,
    reply.line,
    reply.lineText,
  )
  const start = new vscode.Position(line, startChar)
  const end = new vscode.Position(line, endChar)
  editor.selection = new vscode.Selection(start, end)
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenter,
  )
}

export function activate(context: vscode.ExtensionContext) {
  logger = vscode.window.createOutputChannel('vMarkd', { log: true })
  context.subscriptions.push(logger)

  // Warm the host-side Lute now so the first file open already gets the instant
  // pre-rendered paint (see src/lute-host.ts). Deferred off the activation path.
  prewarmLute(context.extensionPath)

  const updateStatusBar = setupStatusBar(context)
  const refreshContexts = () => {
    void updateEditorContexts()
    updateStatusBar()
  }
  // Live reading-time on edits, debounced so it doesn't recompute per keystroke.
  let statusBarTimer: NodeJS.Timeout | undefined
  const debouncedStatusBar = () => {
    if (statusBarTimer) clearTimeout(statusBarTimer)
    statusBarTimer = setTimeout(updateStatusBar, 300)
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openEditor',
      async (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        const target = getCommandTarget(uri)
        if (!target) {
          showError(`Cannot find markdown file!`)
          return
        }
        if (isDiffContextForUri(target)) {
          showError(`Markdown editor is unavailable in diff editors.`)
          return
        }
        if (!isSupportedMarkdownUri(target)) {
          showError(`Markdown editor can only open local markdown files.`)
          return
        }
        // Reveal an existing vMarkd tab for this file instead of opening a
        // duplicate (task 36): target its own column so VS Code focuses it.
        const existing = findTabForUri(target, 'custom')
        if (existing) {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            target,
            MarkdownEditorViewType,
            { viewColumn: existing.group.viewColumn },
          )
          return
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorViewType,
        )
      },
    ),
    vscode.commands.registerCommand(
      'markdown-editor.openInSplit',
      async (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        const target = getCommandTarget(uri)
        if (!target) {
          showError(`Cannot find markdown file!`)
          return
        }
        if (isDiffContextForUri(target)) {
          showError(`Markdown editor is unavailable in diff editors.`)
          return
        }
        if (!isSupportedMarkdownUri(target)) {
          showError(`Markdown editor can only open local markdown files.`)
          return
        }
        // Open the visual editor beside the current view (task 10).
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorViewType,
          vscode.ViewColumn.Beside,
        )
      },
    ),
    vscode.commands.registerCommand(
      'markdown-editor.openTextEditor',
      async (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        const target = getCommandTarget(uri)
        if (!target) {
          showError(`Cannot find markdown file!`)
          return
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          'default',
        )
      },
    ),
    vscode.commands.registerCommand(
      'markdown-editor.openSourceToSide',
      async (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        const target = getCommandTarget(uri)
        if (!target) {
          showError(`Cannot find markdown file!`)
          return
        }
        if (!isSupportedMarkdownUri(target)) {
          showError(`Markdown editor can only open local markdown files.`)
          return
        }
        // Reuse an existing source tab (focus it in its column); otherwise open
        // the text view in the adjacent column (task 36). When this is invoked
        // from a live vMarkd editor for the same file, also jump to the caret's
        // line (task 16) — one button does both: open source to the side AND
        // reveal the cursor.
        const existing = findTabForUri(target, 'text')
        const viewColumn = existing
          ? existing.group.viewColumn
          : vscode.ViewColumn.Beside
        const panelEntry = MarkdownEditorProvider.findPanelForUri(target)
        if (panelEntry) {
          await revealCaretInSource(panelEntry.panel, target, viewColumn)
        } else {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            target,
            'default',
            { viewColumn },
          )
        }
      },
    ),
    vscode.commands.registerCommand(
      'markdown-editor.openSettings',
      async () => {
        // Open the Settings UI filtered to this extension's options.
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:spiochacz.vmarkd',
        )
      },
    ),
    vscode.window.registerCustomEditorProvider(
      MarkdownEditorViewType,
      new MarkdownEditorProvider(context),
      {
        webviewOptions: {
          // Configurable (task 37). Default ON = instant tab switching; the
          // reload on re-show with it OFF proved too disruptive to be the
          // default. Memory-conscious users with many tabs can disable it.
          // The bounded retain-cache (keep N) is tasks/41.
          retainContextWhenHidden:
            MarkdownEditorProvider.config.get<boolean>('retainHiddenEditors') ??
            true,
          enableFindWidget: true,
        },
      },
    ),
    vscode.window.onDidChangeActiveTextEditor(refreshContexts),
    vscode.window.tabGroups.onDidChangeTabs(refreshContexts),
    vscode.workspace.onDidOpenTextDocument(refreshContexts),
    vscode.workspace.onDidCloseTextDocument(refreshContexts),
    vscode.workspace.onDidChangeTextDocument(debouncedStatusBar),
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
  refreshContexts()
}

interface ActivePanelEntry {
  panel: vscode.WebviewPanel
  uri: vscode.Uri
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  // Live registry of open vMarkd panels (task 16). Commands like revealInSource
  // need the focused panel + its document; CustomTextEditorProvider gives us no
  // singleton, so we track them here and pick the active one.
  static activePanels = new Set<ActivePanelEntry>()

  static findActivePanel(): ActivePanelEntry | undefined {
    for (const entry of MarkdownEditorProvider.activePanels) {
      if (entry.panel.active) return entry
    }
    return undefined
  }

  static findPanelForUri(uri: vscode.Uri): ActivePanelEntry | undefined {
    const want = uri.toString()
    for (const entry of MarkdownEditorProvider.activePanels) {
      if (entry.uri.toString() === want) return entry
    }
    return undefined
  }

  // Scope the webview's filesystem reach (task 18 §2a). Previously the roots were
  // the whole disk (`/` + every Windows drive), letting the webview load any local
  // file. Narrow to exactly what we serve:
  //   - the extension's `media` dir (Vditor assets: the local `cdn` base where
  //     Mermaid/KaTeX/etc. are self-hosted — MUST stay in the roots or diagram/
  //     math rendering silently 404s),
  //   - the document's workspace folder (covers images referenced relative to the
  //     doc or the workspace), or its own directory when there is no workspace.
  static webviewRoots(
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
  static getWebviewOptions(
    extensionUri: vscode.Uri,
    documentUri: vscode.Uri,
  ): vscode.WebviewOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,
      // Narrowed to the extension media dir + the document's workspace (task 18 §2a).
      localResourceRoots: MarkdownEditorProvider.webviewRoots(
        extensionUri,
        documentUri,
      ),
      // Navigation goes through postMessage (open-link / navigate-back / …), never
      // `command:` URIs, so keep them disabled to reduce webview privilege (task 27).
      enableCommandUris: false,
    }
  }

  static get config() {
    return vscode.workspace.getConfiguration('markdown-editor')
  }

  // External CSS files (task 12): resolve each `externalCssFiles` entry (absolute,
  // or relative to the first workspace folder) and concatenate their contents.
  // Read synchronously so it can feed the (sync) HTML build; unreadable/missing
  // files are skipped. Local-fs only — a no-op in virtual workspaces.
  static readExternalCss(): string {
    const files =
      MarkdownEditorProvider.config.get<string[]>('externalCssFiles') || []
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

  static resolveExternalCssPaths(): string[] {
    const files =
      MarkdownEditorProvider.config.get<string[]>('externalCssFiles') || []
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return files
      .filter(Boolean)
      .map((f) =>
        NodePath.isAbsolute(f) ? f : root ? NodePath.join(root, f) : f,
      )
  }

  // Neutralize a `</style>` breakout in user CSS (task 18 §2b). When CSS is
  // baked into the HTML string inside a <style> block, a literal `</style` in
  // the value closes the tag early and everything after it is parsed as markup
  // — i.e. arbitrary `<script>` injection. Strip the closing-tag sequence
  // (case-insensitive). The live `reload-css` path is already safe: swapStyle
  // assigns `textContent`, which never parses markup.
  static sanitizeCss(css: string | undefined): string {
    return (css || '').replace(/<\/style/gi, '')
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
  static sanitizeVditorOptions<T>(options: T): T {
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

  // Id'd <style> tags so external + custom CSS can be live-swapped by id
  // (tasks 12/26). External loads first, customCss last, so customCss always
  // wins on conflicting rules (later tag = higher priority). Both are sanitized
  // against `</style>` breakout (task 18 §2b).
  static _cssStyleTags(): string {
    const external = `<style id="external-css">${MarkdownEditorProvider.sanitizeCss(MarkdownEditorProvider.readExternalCss())}</style>`
    const custom = `<style id="custom-css">${MarkdownEditorProvider.sanitizeCss(MarkdownEditorProvider.config.get<string>('customCss'))}</style>`
    return external + custom
  }

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ) {
    const disposables: vscode.Disposable[] = []
    // Mutable file identity — updated by onDidRenameFiles (task 14) so the tab,
    // watcher, edits and asset paths follow a renamed file. (Wiki context below
    // stays init-frozen — cross-folder wiki rename is a known Phase-1 limit.)
    let activeUri = document.uri
    let activeFsPath = document.uri.fsPath
    let suppressCloseDispose = false
    const wiki = getWikiDocumentContext(document.uri)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    const vditorBaseUri = webviewPanel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vditor'),
      )
      .toString()
    let textEditTimer: NodeJS.Timeout | undefined
    let applyingWebviewEdit = false
    let pendingWebviewContent: string | undefined
    let lastSyncedContent = document.getText()

    webviewPanel.title = NodePath.basename(activeFsPath)
    webviewPanel.iconPath = new vscode.ThemeIcon('markdown')
    // Track this panel so commands (e.g. revealInSource, task 16) can find the
    // focused editor + its document. `uri` is updated on rename below and the
    // entry is removed on dispose.
    const panelEntry: ActivePanelEntry = { panel: webviewPanel, uri: activeUri }
    MarkdownEditorProvider.activePanels.add(panelEntry)
    // Augment, don't replace: keep VS Code's default custom-editor webview options
    // and only override the ones we control (task 27).
    webviewPanel.webview.options = {
      ...webviewPanel.webview.options,
      ...MarkdownEditorProvider.getWebviewOptions(
        this._context.extensionUri,
        document.uri,
      ),
    }
    webviewPanel.webview.html = this._getHtmlForWebview(
      webviewPanel.webview,
      document.uri,
      document.getText(),
      currentThemeKind(),
    )

    const syncToEditor = async (content: string) => {
      if (normalizeContent(content) === normalizeContent(document.getText())) {
        lastSyncedContent = document.getText()
        return
      }
      applyingWebviewEdit = true
      pendingWebviewContent = content
      try {
        const edit = new vscode.WorkspaceEdit()
        edit.replace(activeUri, this._documentRange(document), content)
        await vscode.workspace.applyEdit(edit)
        lastSyncedContent = document.getText()
      } finally {
        applyingWebviewEdit = false
      }
    }

    const postUpdate = async (
      props: {
        type?: 'init' | 'update'
        cdn?: string
        options?: any
        theme?: 'dark' | 'light'
        wiki?: any
      } = { options: void 0 },
    ) => {
      const content = document.getText()
      const force = props.type === 'init'
      if (
        !force &&
        normalizeContent(content) === normalizeContent(lastSyncedContent)
      ) {
        return
      }
      lastSyncedContent = content
      webviewPanel.webview.postMessage({
        command: 'update',
        content,
        ...props,
      })
    }

    const schedulePostUpdate = () => {
      if (textEditTimer) {
        clearTimeout(textEditTimer)
      }
      textEditTimer = setTimeout(() => {
        postUpdate()
      }, 75)
    }

    // Git gutters (task 17): debounced HEAD↔current diff pushed to the webview.
    // The computer reads `activeFsPath` lazily so it follows a rename. Self-
    // disables (posts []) when there's no git / the file is untracked.
    const scheduleDiffInfo = createDiffScheduler(
      (msg) => webviewPanel.webview.postMessage(msg),
      (content) => makeDiffComputer(activeFsPath, vscode.extensions)(content),
    )

    // Extracted so it can be disposed + recreated when the file is renamed.
    const setupFileWatcher = (
      uri: vscode.Uri,
    ): vscode.Disposable | undefined => {
      if (!workspaceFolder) {
        return undefined
      }
      const relativePath = NodePath.relative(
        workspaceFolder.uri.fsPath,
        uri.fsPath,
      ).replace(/\\/g, '/')
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, relativePath),
      )
      return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(() => schedulePostUpdate()),
        watcher.onDidCreate(() => schedulePostUpdate()),
      )
    }
    let currentWatcher = setupFileWatcher(activeUri)
    if (currentWatcher) {
      disposables.push(currentWatcher)
    }

    // Live config reload (tasks 12/26): on settings change push the config-driven
    // body options + CSS to the open editor, and watch external CSS files so
    // edits apply without reopening. No Vditor re-init (cursor/scroll preserved).
    const postExternalCss = () => {
      webviewPanel.webview.postMessage({
        command: 'reload-css',
        id: 'external-css',
        css: MarkdownEditorProvider.readExternalCss(),
      })
    }
    const postLiveConfig = () => {
      webviewPanel.webview.postMessage({
        command: 'config-changed',
        options: {
          useVscodeThemeColor: MarkdownEditorProvider.config.get<boolean>(
            'useVscodeThemeColor',
          ),
          enableFullWidth:
            MarkdownEditorProvider.config.get<boolean>('enableFullWidth'),
          highlightHeadings:
            MarkdownEditorProvider.config.get<boolean>('highlightHeadings'),
          showHeadingMarkers:
            MarkdownEditorProvider.config.get<boolean>('showHeadingMarkers'),
          fontSize: MarkdownEditorProvider.config.get<string>('fontSize'),
          outlineWidth:
            MarkdownEditorProvider.config.get<number>('outlineWidth'),
          // constructor-only options — a change re-inits Vditor (webview side)
          showToolbar:
            MarkdownEditorProvider.config.get<boolean>('showToolbar'),
          wordCount: MarkdownEditorProvider.config.get<boolean>('wordCount'),
          codeBlockLineNumbers: MarkdownEditorProvider.config.get<boolean>(
            'codeBlockLineNumbers',
          ),
          mermaidTheme:
            MarkdownEditorProvider.config.get<string>('mermaidTheme'),
          outlinePosition:
            MarkdownEditorProvider.config.get<string>('outlinePosition'),
          showOutlineByDefault: MarkdownEditorProvider.config.get<boolean>(
            'showOutlineByDefault',
          ),
          outlineHighlight:
            MarkdownEditorProvider.config.get<boolean>('outlineHighlight'),
          codeTheme: MarkdownEditorProvider.config.get<string>('codeTheme'),
        },
      })
      webviewPanel.webview.postMessage({
        command: 'reload-css',
        id: 'custom-css',
        css: MarkdownEditorProvider.config.get<string>('customCss') || '',
      })
      postExternalCss()
    }
    let externalCssWatcher: vscode.Disposable | undefined
    const refreshExternalCssWatchers = () => {
      externalCssWatcher?.dispose()
      const paths = MarkdownEditorProvider.resolveExternalCssPaths()
      if (paths.length === 0) {
        externalCssWatcher = undefined
        return
      }
      externalCssWatcher = vscode.Disposable.from(
        ...paths.map((p) => {
          const w = vscode.workspace.createFileSystemWatcher(p)
          return vscode.Disposable.from(
            w,
            w.onDidChange(postExternalCss),
            w.onDidCreate(postExternalCss),
            w.onDidDelete(postExternalCss),
          )
        }),
      )
      disposables.push(externalCssWatcher)
    }
    refreshExternalCssWatchers()

    disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('markdown-editor')) {
          return
        }
        postLiveConfig()
        refreshExternalCssWatchers()
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== activeUri.toString()) {
          return
        }
        const currentContent = event.document.getText()
        // Any content change (webview edit, external edit, typing) shifts the git
        // diff — refresh the gutters even for echoed/own edits.
        scheduleDiffInfo(currentContent)
        if (
          pendingWebviewContent !== undefined &&
          normalizeContent(currentContent) ===
            normalizeContent(pendingWebviewContent)
        ) {
          pendingWebviewContent = undefined
          lastSyncedContent = currentContent
          return
        }
        if (applyingWebviewEdit) {
          return
        }
        schedulePostUpdate()
      }),
      vscode.workspace.onDidSaveTextDocument((savedDocument) => {
        if (savedDocument.uri.toString() !== activeUri.toString()) {
          return
        }
        scheduleDiffInfo(savedDocument.getText())
        schedulePostUpdate()
      }),
      vscode.workspace.onDidRenameFiles((e) => {
        // Phase 1: direct file rename only. Re-point identity, tab, watcher and
        // suppress the old-uri close that would otherwise dispose the panel.
        const hit = e.files.find(
          (f) => f.oldUri.toString() === activeUri.toString(),
        )
        if (!hit) {
          return
        }
        suppressCloseDispose = true
        activeUri = hit.newUri
        activeFsPath = hit.newUri.fsPath
        panelEntry.uri = hit.newUri // keep the active-panel registry in sync
        webviewPanel.title = NodePath.basename(activeFsPath)
        currentWatcher?.dispose()
        currentWatcher = setupFileWatcher(activeUri)
        if (currentWatcher) {
          disposables.push(currentWatcher)
        }
        setTimeout(() => {
          suppressCloseDispose = false
        }, 0)
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        // Live re-theme this editor when the VS Code theme changes (task 25).
        webviewPanel.webview.postMessage({
          command: 'set-theme',
          theme: currentThemeKind(),
        })
      }),
      vscode.workspace.onDidCloseTextDocument((closedDocument) => {
        if (suppressCloseDispose) {
          return
        }
        if (closedDocument.uri.toString() !== activeUri.toString()) {
          return
        }
        webviewPanel.dispose()
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== activeUri.toString()) {
          return
        }
        webviewPanel.title = `${event.document.isDirty ? '[edit]' : ''}${NodePath.basename(activeFsPath)}`
      }),
      webviewPanel.webview.onDidReceiveMessage(async (message) => {
        debug('msg from webview review', message, webviewPanel.active)

        switch (message.command) {
          case 'ready': {
            let wikiInit: any = wiki
            if (wiki.enabled) {
              const root = getWikiRoot(document.uri)
              if (root) {
                const pageKeys = await getWikiPageKeys(root)
                wikiInit = { ...wiki, pageKeys }
              }
            }
            await postUpdate({
              type: 'init',
              cdn: vditorBaseUri,
              options: {
                useVscodeThemeColor: MarkdownEditorProvider.config.get<boolean>(
                  'useVscodeThemeColor',
                ),
                enableFullWidth:
                  MarkdownEditorProvider.config.get<boolean>('enableFullWidth'),
                wordCount:
                  MarkdownEditorProvider.config.get<boolean>('wordCount'),
                codeBlockLineNumbers:
                  MarkdownEditorProvider.config.get<boolean>(
                    'codeBlockLineNumbers',
                  ),
                mermaidTheme:
                  MarkdownEditorProvider.config.get<string>('mermaidTheme'),
                showToolbar:
                  MarkdownEditorProvider.config.get<boolean>('showToolbar'),
                highlightHeadings:
                  MarkdownEditorProvider.config.get<boolean>(
                    'highlightHeadings',
                  ),
                showHeadingMarkers:
                  MarkdownEditorProvider.config.get<boolean>(
                    'showHeadingMarkers',
                  ),
                fontSize: MarkdownEditorProvider.config.get<string>('fontSize'),
                outlinePosition:
                  MarkdownEditorProvider.config.get<string>('outlinePosition'),
                outlineWidth:
                  MarkdownEditorProvider.config.get<number>('outlineWidth'),
                showOutlineByDefault:
                  MarkdownEditorProvider.config.get<boolean>(
                    'showOutlineByDefault',
                  ),
                outlineHighlight:
                  MarkdownEditorProvider.config.get<boolean>(
                    'outlineHighlight',
                  ),
                codeTheme:
                  MarkdownEditorProvider.config.get<string>('codeTheme'),
                ...MarkdownEditorProvider.sanitizeVditorOptions(
                  this._context.globalState.get(KeyVditorOptions),
                ),
              },
              theme: currentThemeKind(),
              wiki: wikiInit,
            })
            break
          }
          case 'save-options':
            await this._context.globalState.update(
              KeyVditorOptions,
              MarkdownEditorProvider.sanitizeVditorOptions(message.options),
            )
            break
          case 'info':
            vscode.window.showInformationMessage(message.content)
            break
          case 'error':
            showError(message.content)
            break
          case 'edit':
            await syncToEditor(message.content)
            break
          case 'reset-config':
            await this._context.globalState.update(KeyVditorOptions, {})
            break
          case 'save':
            await syncToEditor(message.content)
            await document.save()
            break
          case 'edit-in-vscode':
            // Open the source AND jump to the caret's line (task 16). Same column
            // as the visual editor, matching the previous open-in-place behavior.
            await revealCaretInSource(
              webviewPanel,
              activeUri,
              vscode.ViewColumn.Active,
            )
            break
          case 'navigate-back':
            await vscode.commands.executeCommand(
              'workbench.action.navigateBack',
            )
            break
          case 'open-settings':
            await vscode.commands.executeCommand('markdown-editor.openSettings')
            break
          case 'list-wiki-pages': {
            const wikiRoot = getWikiRoot(document.uri)
            if (!wikiRoot) {
              break
            }
            const allPages = await collectWikiMarkdownFiles(wikiRoot)
            allPages.sort((a, b) =>
              NodePath.basename(a.fsPath).localeCompare(
                NodePath.basename(b.fsPath),
              ),
            )
            const picked = await vscode.window.showQuickPick(
              allPages.map((page) => ({
                label: NodePath.basename(
                  page.fsPath,
                  NodePath.extname(page.fsPath),
                ),
                description: vscode.workspace.asRelativePath(page, false),
                uri: page,
              })),
              {
                title: 'Wiki Pages',
                placeHolder: 'Select a wiki page to open',
              },
            )
            if (picked?.uri) {
              await vscode.commands.executeCommand(
                'vscode.openWith',
                picked.uri,
                MarkdownEditorViewType,
              )
            }
            break
          }
          case 'upload': {
            if (!ensureCanWriteFiles(activeUri)) {
              break
            }
            const assetsFolder =
              MarkdownEditorProvider.getAssetsFolder(activeUri)
            try {
              await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(assetsFolder),
              )
            } catch (error) {
              console.error(error)
              showError(`Invalid image folder: ${assetsFolder}`)
            }
            await Promise.all(
              message.files.map(async (file: any) => {
                const content = Buffer.from(file.base64, 'base64')
                return vscode.workspace.fs.writeFile(
                  vscode.Uri.file(NodePath.join(assetsFolder, file.name)),
                  content,
                )
              }),
            )
            webviewPanel.webview.postMessage({
              command: 'uploaded',
              files: message.files.map((file: any) =>
                NodePath.relative(
                  NodePath.dirname(activeFsPath),
                  NodePath.join(assetsFolder, file.name),
                ).replace(/\\/g, '/'),
              ),
            })
            break
          }
          case 'open-link': {
            let url = message.href
            if (!/^https?:/i.test(url)) {
              url = NodePath.resolve(NodePath.dirname(activeFsPath), url)
            }
            await vscode.commands.executeCommand(
              'vscode.open',
              vscode.Uri.parse(url),
            )
            break
          }
          case 'open-wikilink': {
            const resolution = await resolveWikiLink(
              document.uri,
              String(message.target),
            )

            switch (resolution.kind) {
              case 'disabled':
                showError(
                  `Wiki links are only enabled for Markdown files inside a wiki folder.`,
                )
                break
              case 'invalid':
                showError(`Invalid wiki link target.`)
                break
              case 'missing': {
                const createChoice = await vscode.window.showWarningMessage(
                  `Wiki page "${message.target}" was not found under "${vscode.workspace.asRelativePath(
                    resolution.root,
                    false,
                  )}".`,
                  'Create Page',
                )
                if (createChoice === 'Create Page') {
                  if (!ensureCanWriteFiles(document.uri)) {
                    break
                  }
                  const newFileName = `${resolution.key.replace(/\//g, '-')}.md`
                  const newFileUri = vscode.Uri.joinPath(
                    resolution.root,
                    newFileName,
                  )
                  const heading = resolution.key
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                  await vscode.workspace.fs.writeFile(
                    newFileUri,
                    Buffer.from(`# ${heading}\n`),
                  )
                  await vscode.commands.executeCommand(
                    'vscode.openWith',
                    newFileUri,
                    MarkdownEditorViewType,
                  )
                }
                break
              }
              case 'ambiguous': {
                const picked = await vscode.window.showQuickPick(
                  resolution.candidates.map((candidate) => ({
                    label: NodePath.basename(candidate.fsPath),
                    description: vscode.workspace.asRelativePath(
                      candidate,
                      false,
                    ),
                    uri: candidate,
                  })),
                  {
                    title: `Select wiki page for "${message.target}"`,
                    placeHolder: 'Multiple wiki pages match this link.',
                  },
                )

                if (picked?.uri) {
                  await vscode.commands.executeCommand(
                    'vscode.openWith',
                    picked.uri,
                    MarkdownEditorViewType,
                  )
                }
                break
              }
              case 'resolved':
                await vscode.commands.executeCommand(
                  'vscode.openWith',
                  resolution.target,
                  MarkdownEditorViewType,
                )
                break
            }
            break
          }
        }
      }),
      webviewPanel.onDidDispose(() => {
        pendingWebviewContent = undefined
        MarkdownEditorProvider.activePanels.delete(panelEntry)
        if (textEditTimer) {
          clearTimeout(textEditTimer)
        }
        while (disposables.length) {
          disposables.pop()?.dispose()
        }
      }),
    )
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const imageSaveFolder = (
      MarkdownEditorProvider.config.get<string>('imageSaveFolder') || 'assets'
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

  private _documentRange(document: vscode.TextDocument) {
    const lastLine = document.lineAt(Math.max(document.lineCount - 1, 0))
    return new vscode.Range(
      0,
      0,
      lastLine.range.end.line,
      lastLine.range.end.character,
    )
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    uri: vscode.Uri,
    content?: string,
    theme: 'dark' | 'light' = 'light',
  ) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, f))
    const baseHref = `${NodePath.dirname(
      webview.asWebviewUri(vscode.Uri.file(uri.fsPath)).toString(),
    )}/`
    const toMediaPath = (f: string) => `media/dist/${f}`
    const JsFiles = ['main.js'].map(toMediaPath).map(toUri)
    const CssFiles = ['main.css'].map(toMediaPath).map(toUri)
    const iconScript = toUri('media/vditor/dist/js/icons/ant.js')
    // Codicon restyle of the toolbar: loaded right after ant.js, it mutates the
    // injected <symbol> defs in place (see media-src/build-icon-sprite.mjs, task 44).
    const iconOverrideScript = toUri('media/vditor-icons-codicon.js')

    // Content-Security-Policy (task 18 §2c). default-src 'none' denies
    // everything, then we re-allow only what the editor needs, all scoped to the
    // webview origin (`cspSource`, which covers our asWebviewUri assets):
    //   - scripts: our own tags by nonce + same-origin Vditor assets. 'unsafe-eval'
    //     is kept because some bundled libs (e.g. GopherJS Lute / diagram engines)
    //     eval at runtime; injected inline scripts still can't run (no nonce), so
    //     the §2b/§2c injection protection is preserved.
    //   - styles: same-origin + 'unsafe-inline' (Vditor sets inline style attrs and
    //     we inject <style> for custom/external CSS).
    //   - images: same-origin + data:/blob: + https: (remote images in markdown).
    // Instant paint (perf): render the document to Vditor IR DOM host-side and
    // inline it as a static, read-only overlay. It shows during HTML parse —
    // before main.js loads + the webview's own Lute runtime bootstraps (~150 ms)
    // — and is removed once the live editor is ready (media-src/src/main.ts).
    // Falls back to nothing (normal render path) when Lute isn't warm yet.
    const showToolbar =
      MarkdownEditorProvider.config.get<boolean>('showToolbar') !== false
    // Set the body data-attrs statically so the overlay gets the SAME themed
    // colours/layout the live editor will. Every colour rule in main.css is
    // gated on `body[data-use-vscode-theme-color="1"] .vditor…`, so without
    // these the swap shows a colour jump. Mirrors applyBodyOptions() +
    // resolveFontSize() in media-src/src/live-config.ts — keep in sync.
    const cfg = MarkdownEditorProvider.config
    const bodyAttrs =
      `data-use-vscode-theme-color="${cfg.get<boolean>('useVscodeThemeColor') ? '1' : '0'}" ` +
      `data-full-width="${cfg.get<boolean>('enableFullWidth') ? '1' : '0'}" ` +
      `data-highlight-headings="${cfg.get<boolean>('highlightHeadings') ? '1' : '0'}" ` +
      `data-heading-markers="${cfg.get<boolean>('showHeadingMarkers') === false ? '0' : '1'}"`
    const fontSizeOpt = cfg.get<string>('fontSize')
    const fontSizeCss =
      !fontSizeOpt || fontSizeOpt === 'editor'
        ? 'var(--vscode-editor-font-size, 14px)'
        : fontSizeOpt === 'vditor'
          ? '16px'
          : Number.isFinite(parseFloat(fontSizeOpt)) &&
              parseFloat(fontSizeOpt) > 0
            ? `${parseFloat(fontSizeOpt)}px`
            : 'var(--vscode-editor-font-size, 14px)'
    const preIR =
      content !== undefined
        ? renderIR(this._context.extensionPath, content)
        : undefined
    // A static, empty themed toolbar bar (no icons) so the chrome region looks
    // present during the instant paint — the real toolbar can't be reused here, it
    // isn't attached to the DOM until Vditor's post-Lute initUI (~the swap moment).
    // The real icons fade in at the swap. .vditor-toolbar/--pin inherit the themed
    // bg + bottom border from the .vditor wrapper; min-height set in the style.
    const prerenderToolbar = showToolbar
      ? '<div class="vditor-toolbar vditor-toolbar--pin" style="height:35px;box-sizing:content-box;padding-top:0;padding-bottom:0;"></div>'
      : ''
    // Mirror the live editor's DOM exactly: .vditor > toolbar + .vditor-content >
    // .vditor-ir > pre.vditor-reset. The .vditor-content wrapper matters — it lets
    // Vditor's own CSS make .vditor-reset the scroll container (overflow:auto =
    // a BFC), which both gives a single scrollbar AND stops the first heading's
    // margin-top from collapsing through and pushing content down 24px. Measured
    // (Playwright): content lands at the same offset as the live editor → no jump.
    const prerenderOverlay = preIR
      ? `<div id="vmarkd-prerender" class="vditor${
          theme === 'dark' ? ' vditor--dark' : ''
        }" style="height:100%" aria-hidden="true">${prerenderToolbar}<div class="vditor-content"><div class="vditor-ir"><pre class="vditor-reset">${preIR}</pre></div></div></div>`
      : ''
    // The base content text colour comes from Vditor's content-theme CSS, which
    // the live editor loads at runtime via setTheme. Link the SAME file here so
    // the overlay text/headings match exactly (otherwise they render dim — the
    // index.css light-theme fallback on a dark background).
    // id="vditorContentTheme": the live editor's setContentTheme() reuses a link
    // with this id (leaves it if the href already matches), so the overlay's
    // theme link becomes the editor's — no duplicate, no stale link on a later
    // live theme switch.
    const prerenderThemeLink = preIR
      ? `<link id="vditorContentTheme" href="${toUri(
          `media/vditor/dist/css/content-theme/${theme === 'dark' ? 'dark' : 'light'}.css`,
        )}" rel="stylesheet">`
      : ''
    // The overlay just positions the mirrored editor over #app and clips
    // (overflow:hidden) — the inner .vditor-reset scrolls natively via Vditor's
    // own CSS, exactly like the live editor (single scrollbar, correct margins).
    const prerenderStyle = preIR
      ? `<style>#vmarkd-prerender{position:absolute;inset:0;overflow:hidden;z-index:5;box-sizing:border-box;background:var(--vscode-editor-background,#fff);}</style>`
      : ''

    const nonce = getNonce()
    const csp = webview.cspSource
    const cspMeta =
      `<meta http-equiv="Content-Security-Policy" content="` +
      `default-src 'none'; ` +
      `img-src ${csp} data: blob: https:; ` +
      `media-src ${csp} data: blob:; ` +
      `font-src ${csp} data:; ` +
      `style-src ${csp} 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}' ${csp} 'unsafe-eval'; ` +
      `connect-src ${csp} data:; ` +
      `worker-src ${csp} blob:;">`

    return (
      `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				${cspMeta}

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>markdown editor</title>
        ` +
      prerenderThemeLink +
      MarkdownEditorProvider._cssStyleTags() +
      prerenderStyle +
      `
			</head>
			<body ${bodyAttrs} style="--me-font-size:${fontSizeCss}">
				<div id="app"></div>
				${prerenderOverlay}

				<script nonce="${nonce}" id="vditorIconScript" src="${iconScript}"></script>
				<script nonce="${nonce}" id="vditorIconOverride" src="${iconOverrideScript}"></script>
				${JsFiles.map((f) => `<script nonce="${nonce}" src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
