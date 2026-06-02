import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import * as fs from 'node:fs'
import { readingTime } from './reading-time'
import { selectionForLine } from './reveal-range'
import { createDiffScheduler, makeDiffComputer } from './git-diff'
import { type EditorMode, prewarmLute, renderForMode } from './lute-host'
import {
  collectWikiMarkdownFiles,
  getWikiDocumentContext,
  getWikiPageKeys,
  getWikiRoot,
  isWikiFile,
  resolveWikiLink,
} from './wiki'

const KeyVditorOptions = 'vmarkd.options'
const MarkdownEditorViewType = 'vmarkd.editor'
const WikiFileContextKey = 'vmarkd.isWikiFile'
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
  vscode.window.showErrorMessage(`[vMarkd] ${msg}`)
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

// Map the VS Code UI language (vscode.env.language, a lowercase BCP-47 tag like
// "en", "zh-cn", "pt-br") to the closest Vditor i18n bundle that ships under
// media/vditor/dist/js/i18n/*.js (de_DE, en_US, es_ES, fr_FR, ja_JP, ko_KR, pt_BR,
// ru_RU, sv_SE, vi_VN, zh_CN, zh_TW). Default en_US. The host injects the matching
// bundle into the webview HTML *before* main.js so `window.VditorI18n` is set when
// Vditor is constructed; with i18n inline Vditor skips its async i18n fetch and
// builds the editor (toolbar included) synchronously inside the constructor — so
// the toolbar can be cloned into the instant-paint overlay right away, instead of
// after an extra network round-trip (see media-src/src/main.ts).
export function resolveVditorI18nLang(envLang: string | undefined): string {
  const l = (envLang || 'en').toLowerCase().replace('_', '-')
  if (l === 'zh-tw' || l === 'zh-hant') return 'zh_TW'
  if (l.startsWith('zh')) return 'zh_CN'
  const byBase: Record<string, string> = {
    de: 'de_DE',
    en: 'en_US',
    es: 'es_ES',
    fr: 'fr_FR',
    ja: 'ja_JP',
    ko: 'ko_KR',
    pt: 'pt_BR',
    ru: 'ru_RU',
    sv: 'sv_SE',
    vi: 'vi_VN',
  }
  return byBase[l.split('-')[0]] ?? 'en_US'
}

// Resolve the `fontSize` setting to a CSS value for the editor's --me-font-size:
// 'editor'/unset → the VS Code editor font, 'vditor' → Vditor's 16px default, a
// positive number → that many px, anything else → the editor font. Pure/exported
// for unit tests. (The webview has its own resolveFontSize in live-config.ts —
// separate bundle, so they can't share a module.)
export function resolveFontSizeCss(opt: string | undefined): string {
  const editorFont = 'var(--vscode-editor-font-size, 14px)'
  if (!opt || opt === 'editor') return editorFont
  if (opt === 'vditor') return '16px'
  const n = parseFloat(opt)
  return Number.isFinite(n) && n > 0 ? `${n}px` : editorFont
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
      `[vMarkd] Image upload and wiki page creation are unavailable in virtual workspaces.`,
    )
    return false
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      `[vMarkd] Trust this workspace to upload images and create wiki pages.`,
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
      mode.command = 'vmarkd.openTextEditor'
      mode.show()
    } else if (
      input instanceof vscode.TabInputText &&
      isSupportedMarkdownUri(input.uri)
    ) {
      showFor(input.uri)
      mode.text = '$(code) Source'
      mode.tooltip = 'Markdown: source view — click to open the visual editor'
      mode.command = 'vmarkd.openEditor'
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
      'vmarkd.openEditor',
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
      'vmarkd.openInSplit',
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
      'vmarkd.openTextEditor',
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
      'vmarkd.openSourceToSide',
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
    vscode.commands.registerCommand('vmarkd.openSettings', async () => {
      // Open the Settings UI filtered to this extension's options.
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:spiochacz.vmarkd',
      )
    }),
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
            MarkdownEditorProvider.config.get<boolean>('editor.retainHidden') ??
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

// One open editor tab. Holds the per-panel state + behaviour that previously lived
// as closures inside MarkdownEditorProvider.resolveCustomTextEditor (SRP step 1:
// god-method -> class). For now the state stays local to start(); later steps
// promote it to fields and split the closures into methods. The HTML builder is
// injected so this class needn't reach back into the provider's private members.
export class EditorSession {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument,
    private readonly webviewPanel: vscode.WebviewPanel,
    private readonly htmlForWebview: (
      webview: vscode.Webview,
      uri: vscode.Uri,
      content?: string,
      theme?: 'dark' | 'light',
    ) => string,
  ) {}

  // Per-panel state (was closure-local in resolveCustomTextEditor). The `!` fields
  // are assigned at the top of start(); activeUri/activeFsPath are reassigned on
  // rename and read lazily elsewhere, so they must stay fields (not snapshots).
  private disposables!: vscode.Disposable[]
  private activeUri!: vscode.Uri
  private activeFsPath!: string
  private suppressCloseDispose = false
  private textEditTimer: NodeJS.Timeout | undefined
  private applyingWebviewEdit = false
  private pendingWebviewContent: string | undefined
  private lastSyncedContent = ''
  private currentWatcher: vscode.Disposable | undefined
  private externalCssWatcher: vscode.Disposable | undefined
  private wiki!: ReturnType<typeof getWikiDocumentContext>
  private workspaceFolder: vscode.WorkspaceFolder | undefined
  private vditorBaseUri!: string
  private panelEntry!: ActivePanelEntry

  private documentRange(document: vscode.TextDocument) {
    const lastLine = document.lineAt(Math.max(document.lineCount - 1, 0))
    return new vscode.Range(
      0,
      0,
      lastLine.range.end.line,
      lastLine.range.end.character,
    )
  }

  private async syncToEditor(content: string) {
    const document = this.document
    if (normalizeContent(content) === normalizeContent(document.getText())) {
      this.lastSyncedContent = document.getText()
      return
    }
    this.applyingWebviewEdit = true
    this.pendingWebviewContent = content
    try {
      const edit = new vscode.WorkspaceEdit()
      edit.replace(this.activeUri, this.documentRange(document), content)
      await vscode.workspace.applyEdit(edit)
      this.lastSyncedContent = document.getText()
    } finally {
      this.applyingWebviewEdit = false
    }
  }

  private async postUpdate(
    props: {
      type?: 'init' | 'update'
      cdn?: string
      options?: any
      theme?: 'dark' | 'light'
      wiki?: any
    } = { options: void 0 },
  ) {
    const content = this.document.getText()
    const force = props.type === 'init'
    if (
      !force &&
      normalizeContent(content) === normalizeContent(this.lastSyncedContent)
    ) {
      return
    }
    this.lastSyncedContent = content
    this.webviewPanel.webview.postMessage({
      command: 'update',
      content,
      ...props,
    })
  }

  private schedulePostUpdate() {
    if (this.textEditTimer) {
      clearTimeout(this.textEditTimer)
    }
    this.textEditTimer = setTimeout(() => {
      this.postUpdate()
    }, 75)
  }

  // Extracted so it can be disposed + recreated when the file is renamed.
  private setupFileWatcher(uri: vscode.Uri): vscode.Disposable | undefined {
    if (!this.workspaceFolder) {
      return undefined
    }
    const relativePath = NodePath.relative(
      this.workspaceFolder.uri.fsPath,
      uri.fsPath,
    ).replace(/\\/g, '/')
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, relativePath),
    )
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange(() => this.schedulePostUpdate()),
      watcher.onDidCreate(() => this.schedulePostUpdate()),
    )
  }

  private postExternalCss() {
    this.webviewPanel.webview.postMessage({
      command: 'reload-css',
      id: 'external-css',
      css: MarkdownEditorProvider.readExternalCss(this.activeUri),
    })
  }

  // Live config reload (tasks 12/26): push config-driven body options + CSS to the
  // open editor (no Vditor re-init, so cursor/scroll are preserved).
  private postLiveConfig() {
    this.webviewPanel.webview.postMessage({
      command: 'config-changed',
      options: MarkdownEditorProvider.collectConfigOptions(),
    })
    this.webviewPanel.webview.postMessage({
      command: 'reload-css',
      id: 'custom-css',
      css:
        MarkdownEditorProvider.cfgFor(this.activeUri).get<string>(
          'css.custom',
        ) || '',
    })
    this.postExternalCss()
  }

  private refreshExternalCssWatchers() {
    this.externalCssWatcher?.dispose()
    const paths = MarkdownEditorProvider.resolveExternalCssPaths(this.activeUri)
    if (paths.length === 0) {
      this.externalCssWatcher = undefined
      return
    }
    this.externalCssWatcher = vscode.Disposable.from(
      ...paths.map((p) => {
        const w = vscode.workspace.createFileSystemWatcher(p)
        return vscode.Disposable.from(
          w,
          w.onDidChange(() => this.postExternalCss()),
          w.onDidCreate(() => this.postExternalCss()),
          w.onDidDelete(() => this.postExternalCss()),
        )
      }),
    )
    this.disposables.push(this.externalCssWatcher)
  }

  private async onReady() {
    let wikiInit: any = this.wiki
    if (this.wiki.enabled) {
      const root = getWikiRoot(this.document.uri)
      if (root) {
        const pageKeys = await getWikiPageKeys(root)
        wikiInit = { ...this.wiki, pageKeys }
      }
    }
    await this.postUpdate({
      type: 'init',
      cdn: this.vditorBaseUri,
      options: {
        ...MarkdownEditorProvider.collectConfigOptions(),
        ...MarkdownEditorProvider.sanitizeVditorOptions(
          this.context.globalState.get(KeyVditorOptions),
        ),
      },
      theme: currentThemeKind(),
      wiki: wikiInit,
    })
  }

  private async onSaveOptions(message: any) {
    await this.context.globalState.update(
      KeyVditorOptions,
      MarkdownEditorProvider.sanitizeVditorOptions(message.options),
    )
  }

  private onInfo(message: any) {
    vscode.window.showInformationMessage(message.content)
  }

  private onError(message: any) {
    showError(message.content)
  }

  private async onEdit(message: any) {
    await this.syncToEditor(message.content)
  }

  private async onResetConfig() {
    await this.context.globalState.update(KeyVditorOptions, {})
  }

  private async onSave(message: any) {
    await this.syncToEditor(message.content)
    await this.document.save()
  }

  private async onEditInVscode() {
    // Open the source AND jump to the caret's line (task 16). Same column as
    // the visual editor, matching the previous open-in-place behavior.
    await revealCaretInSource(
      this.webviewPanel,
      this.activeUri,
      vscode.ViewColumn.Active,
    )
  }

  private async onNavigateBack() {
    await vscode.commands.executeCommand('workbench.action.navigateBack')
  }

  private async onOpenSettings() {
    await vscode.commands.executeCommand('vmarkd.openSettings')
  }

  private async onListWikiPages() {
    const wikiRoot = getWikiRoot(this.document.uri)
    if (!wikiRoot) {
      return
    }
    const allPages = await collectWikiMarkdownFiles(wikiRoot)
    allPages.sort((a, b) =>
      NodePath.basename(a.fsPath).localeCompare(NodePath.basename(b.fsPath)),
    )
    const picked = await vscode.window.showQuickPick(
      allPages.map((page) => ({
        label: NodePath.basename(page.fsPath, NodePath.extname(page.fsPath)),
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
  }

  private async onUpload(message: any) {
    if (!ensureCanWriteFiles(this.activeUri)) {
      return
    }
    const assetsFolder = MarkdownEditorProvider.getAssetsFolder(this.activeUri)
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsFolder))
    } catch (error) {
      debug('upload: createDirectory failed', error)
      showError(`Invalid image folder: ${assetsFolder}`)
      return // can't write into a folder we failed to create
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
    this.webviewPanel.webview.postMessage({
      command: 'uploaded',
      files: message.files.map((file: any) =>
        NodePath.relative(
          NodePath.dirname(this.activeFsPath),
          NodePath.join(assetsFolder, file.name),
        ).replace(/\\/g, '/'),
      ),
    })
  }

  private async onOpenLink(message: any) {
    const href = String(message.href)
    if (/^https?:/i.test(href)) {
      // External URL → the OS default browser. env.openExternal is the canonical
      // API for this; vscode.open routes http inconsistently (Simple Browser).
      await vscode.env.openExternal(vscode.Uri.parse(href))
      return
    }
    // Relative/local target → open the file in the editor (unchanged behaviour).
    const local = NodePath.resolve(NodePath.dirname(this.activeFsPath), href)
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(local))
  }

  private async onOpenWikilink(message: any) {
    const resolution = await resolveWikiLink(
      this.document.uri,
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
          if (!ensureCanWriteFiles(this.document.uri)) {
            break
          }
          const newFileName = `${resolution.key.replace(/\//g, '-')}.md`
          const newFileUri = vscode.Uri.joinPath(resolution.root, newFileName)
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
            description: vscode.workspace.asRelativePath(candidate, false),
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
  }

  start() {
    const document = this.document
    const webviewPanel = this.webviewPanel

    this.disposables = []
    // Mutable file identity — updated by onDidRenameFiles (task 14) so the tab,
    // watcher, edits and asset paths follow a renamed file. (Wiki context below
    // stays init-frozen — cross-folder wiki rename is a known Phase-1 limit.)
    this.activeUri = document.uri
    this.activeFsPath = document.uri.fsPath
    this.suppressCloseDispose = false
    this.wiki = getWikiDocumentContext(document.uri)
    this.workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    this.vditorBaseUri = webviewPanel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vditor'),
      )
      .toString()
    this.applyingWebviewEdit = false
    this.lastSyncedContent = document.getText()

    webviewPanel.title = NodePath.basename(this.activeFsPath)
    webviewPanel.iconPath = new vscode.ThemeIcon('markdown')
    // Track this panel so commands (e.g. revealInSource, task 16) can find the
    // focused editor + its document. `uri` is updated on rename below and the
    // entry is removed on dispose.
    this.panelEntry = { panel: webviewPanel, uri: this.activeUri }
    MarkdownEditorProvider.activePanels.add(this.panelEntry)
    // Augment, don't replace: keep VS Code's default custom-editor webview options
    // and only override the ones we control (task 27).
    webviewPanel.webview.options = {
      ...webviewPanel.webview.options,
      ...MarkdownEditorProvider.getWebviewOptions(
        this.context.extensionUri,
        document.uri,
      ),
    }
    webviewPanel.webview.html = this.htmlForWebview(
      webviewPanel.webview,
      document.uri,
      document.getText(),
      currentThemeKind(),
    )

    // Git gutters (task 17): debounced HEAD↔current diff pushed to the webview.
    // The computer reads `this.activeFsPath` lazily so it follows a rename. Self-
    // disables (posts []) when there's no git / the file is untracked.
    const scheduleDiffInfo = createDiffScheduler(
      (msg) => webviewPanel.webview.postMessage(msg),
      (content) =>
        makeDiffComputer(this.activeFsPath, vscode.extensions)(content),
    )

    // Extracted so it can be disposed + recreated when the file is renamed.
    this.currentWatcher = this.setupFileWatcher(this.activeUri)
    if (this.currentWatcher) {
      this.disposables.push(this.currentWatcher)
    }

    // Live config reload (tasks 12/26): on settings change push the config-driven
    // body options + CSS to the open editor, and watch external CSS files so
    // edits apply without reopening. No Vditor re-init (cursor/scroll preserved).
    this.refreshExternalCssWatchers()

    // Webview→host message handlers, one per command (replaces a 15-case switch).
    // Each arrow delegates to the session's fields/methods (this.postUpdate,
    // this.syncToEditor, …). Adding a command means adding an entry, not editing a
    // central switch (Open/Closed). Step 4 will promote these into on<Command>
    // methods; for now they stay inline.
    const messageHandlers: Record<string, (message: any) => unknown> = {
      ready: () => this.onReady(),
      'save-options': (message) => this.onSaveOptions(message),
      info: (message) => this.onInfo(message),
      error: (message) => this.onError(message),
      edit: (message) => this.onEdit(message),
      'reset-config': () => this.onResetConfig(),
      save: (message) => this.onSave(message),
      'edit-in-vscode': () => this.onEditInVscode(),
      'navigate-back': () => this.onNavigateBack(),
      'open-settings': () => this.onOpenSettings(),
      'list-wiki-pages': () => this.onListWikiPages(),
      upload: (message) => this.onUpload(message),
      'open-link': (message) => this.onOpenLink(message),
      'open-wikilink': (message) => this.onOpenWikilink(message),
    }

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        // Scope to this document's uri so resource-scoped overrides (task 51 #3)
        // in a folder's .vscode/settings.json trigger a reload — and so an
        // unrelated folder's change doesn't reload editors it doesn't affect.
        if (!e.affectsConfiguration('vmarkd', this.activeUri)) {
          return
        }
        this.postLiveConfig()
        this.refreshExternalCssWatchers()
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== this.activeUri.toString()) {
          return
        }
        const currentContent = event.document.getText()
        // Any content change (webview edit, external edit, typing) shifts the git
        // diff — refresh the gutters even for echoed/own edits.
        scheduleDiffInfo(currentContent)
        if (
          this.pendingWebviewContent !== undefined &&
          normalizeContent(currentContent) ===
            normalizeContent(this.pendingWebviewContent)
        ) {
          this.pendingWebviewContent = undefined
          this.lastSyncedContent = currentContent
          return
        }
        if (this.applyingWebviewEdit) {
          return
        }
        this.schedulePostUpdate()
      }),
      vscode.workspace.onDidSaveTextDocument((savedDocument) => {
        if (savedDocument.uri.toString() !== this.activeUri.toString()) {
          return
        }
        scheduleDiffInfo(savedDocument.getText())
        this.schedulePostUpdate()
      }),
      vscode.workspace.onDidRenameFiles((e) => {
        // Phase 1: direct file rename only. Re-point identity, tab, watcher and
        // suppress the old-uri close that would otherwise dispose the panel.
        const hit = e.files.find(
          (f) => f.oldUri.toString() === this.activeUri.toString(),
        )
        if (!hit) {
          return
        }
        this.suppressCloseDispose = true
        this.activeUri = hit.newUri
        this.activeFsPath = hit.newUri.fsPath
        this.panelEntry.uri = hit.newUri // keep the active-panel registry in sync
        webviewPanel.title = NodePath.basename(this.activeFsPath)
        this.currentWatcher?.dispose()
        this.currentWatcher = this.setupFileWatcher(this.activeUri)
        if (this.currentWatcher) {
          this.disposables.push(this.currentWatcher)
        }
        setTimeout(() => {
          this.suppressCloseDispose = false
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
        if (this.suppressCloseDispose) {
          return
        }
        if (closedDocument.uri.toString() !== this.activeUri.toString()) {
          return
        }
        webviewPanel.dispose()
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== this.activeUri.toString()) {
          return
        }
        webviewPanel.title = `${event.document.isDirty ? '[edit]' : ''}${NodePath.basename(this.activeFsPath)}`
      }),
      webviewPanel.webview.onDidReceiveMessage(async (message) => {
        debug('msg from webview review', message, webviewPanel.active)

        await messageHandlers[message.command]?.(message)
      }),
      webviewPanel.onDidDispose(() => {
        this.pendingWebviewContent = undefined
        MarkdownEditorProvider.activePanels.delete(this.panelEntry)
        if (this.textEditTimer) {
          clearTimeout(this.textEditTimer)
        }
        while (this.disposables.length) {
          this.disposables.pop()?.dispose()
        }
      }),
    )
  }
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
    return vscode.workspace.getConfiguration('vmarkd')
  }

  // Resource-scoped config read (task 51 #3). The settings declared with
  // `scope: "resource"` (css.custom / css.external / image.saveFolder) can be
  // overridden per-project via .vscode/settings.json — but only if the read
  // passes the document URI. Without a uri this is identical to `config`.
  static cfgFor(uri?: vscode.Uri) {
    return vscode.workspace.getConfiguration('vmarkd', uri)
  }

  // External CSS files (task 12): resolve each `externalCssFiles` entry (absolute,
  // or relative to the first workspace folder) and concatenate their contents.
  // Read synchronously so it can feed the (sync) HTML build; unreadable/missing
  // files are skipped. Local-fs only — a no-op in virtual workspaces.
  static readExternalCss(uri?: vscode.Uri): string {
    const files =
      MarkdownEditorProvider.cfgFor(uri).get<string[]>('css.external') || []
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

  static resolveExternalCssPaths(uri?: vscode.Uri): string[] {
    const files =
      MarkdownEditorProvider.cfgFor(uri).get<string[]>('css.external') || []
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

  // The user-configurable Vditor options read from VS Code settings, in one place.
  // Both the initial `update`/init payload and the live `config-changed` push send
  // exactly these keys (init additionally spreads the saved Vditor options on top),
  // so adding a setting means touching only this list.
  static collectConfigOptions() {
    const c = MarkdownEditorProvider.config
    return {
      useVscodeThemeColor: c.get<boolean>('theme.useVscodeColors'),
      enableFullWidth: c.get<boolean>('editor.fullWidth'),
      wordCount: c.get<boolean>('editor.wordCount'),
      codeBlockLineNumbers: c.get<boolean>('editor.codeLineNumbers'),
      mermaidTheme: c.get<string>('theme.mermaid'),
      showToolbar: c.get<boolean>('editor.toolbar'),
      highlightHeadings: c.get<boolean>('theme.highlightHeadings'),
      showHeadingMarkers: c.get<boolean>('editor.headingMarkers'),
      fontSize: c.get<string>('editor.fontSize'),
      outlinePosition: c.get<string>('outline.position'),
      outlineWidth: c.get<number>('outline.width'),
      showOutlineByDefault: c.get<boolean>('outline.openByDefault'),
      outlineHighlight: c.get<boolean>('outline.highlight'),
      codeTheme: c.get<string>('theme.code'),
    }
  }

  // Id'd <style> tags so external + custom CSS can be live-swapped by id
  // (tasks 12/26). External loads first, customCss last, so customCss always
  // wins on conflicting rules (later tag = higher priority). Both are sanitized
  // against `</style>` breakout (task 18 §2b).
  static _cssStyleTags(uri?: vscode.Uri): string {
    const external = `<style id="external-css">${MarkdownEditorProvider.sanitizeCss(MarkdownEditorProvider.readExternalCss(uri))}</style>`
    const custom = `<style id="custom-css">${MarkdownEditorProvider.sanitizeCss(MarkdownEditorProvider.cfgFor(uri).get<string>('css.custom'))}</style>`
    return external + custom
  }

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ) {
    new EditorSession(
      this._context,
      document,
      webviewPanel,
      (webview, uri, content, theme) =>
        this._getHtmlForWebview(webview, uri, content, theme),
    ).start()
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const imageSaveFolder = (
      MarkdownEditorProvider.cfgFor(uri).get<string>('image.saveFolder') ||
      'assets'
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
    // i18n bundle for the VS Code UI language. Loaded *before* main.js (below) so
    // `window.VditorI18n` is set when Vditor is constructed → it skips its async
    // i18n fetch and builds the toolbar synchronously (see resolveVditorI18nLang).
    const i18nLang = resolveVditorI18nLang(vscode.env?.language)
    const i18nScript = toUri(`media/vditor/dist/js/i18n/${i18nLang}.js`)

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
      MarkdownEditorProvider.config.get<boolean>('editor.toolbar') !== false
    // Set the body data-attrs statically so the overlay gets the SAME themed
    // colours/layout the live editor will. Every colour rule in main.css is
    // gated on `body[data-use-vscode-theme-color="1"] .vditor…`, so without
    // these the swap shows a colour jump. Mirrors applyBodyOptions() +
    // resolveFontSize() in media-src/src/live-config.ts — keep in sync.
    const cfg = MarkdownEditorProvider.config
    const bodyAttrs =
      `data-use-vscode-theme-color="${cfg.get<boolean>('theme.useVscodeColors') ? '1' : '0'}" ` +
      `data-full-width="${cfg.get<boolean>('editor.fullWidth') ? '1' : '0'}" ` +
      `data-highlight-headings="${cfg.get<boolean>('theme.highlightHeadings') ? '1' : '0'}" ` +
      `data-heading-markers="${cfg.get<boolean>('editor.headingMarkers') === false ? '0' : '1'}"`
    const fontSizeCss = resolveFontSizeCss(cfg.get<string>('editor.fontSize'))
    // The editor opens in whatever mode was last saved (Vditor's currentMode,
    // persisted via save-options) — default 'ir'. Pre-render in THAT mode so the
    // overlay matches; mismatch showed up as the H1/H2 gutter markers landing
    // wrong when the editor was in WYSIWYG.
    const savedOpts = MarkdownEditorProvider.sanitizeVditorOptions(
      this._context.globalState.get(KeyVditorOptions),
    ) as { mode?: string } | undefined
    const mode: EditorMode =
      savedOpts?.mode === 'wysiwyg'
        ? 'wysiwyg'
        : savedOpts?.mode === 'sv'
          ? 'sv'
          : 'ir'
    const innerClass = mode === 'wysiwyg' ? 'vditor-wysiwyg' : 'vditor-ir'
    // Advanced: `instantPreview` (default on) gates the whole host pre-render —
    // both the read-only content teaser and the placeholder toolbar. Off → preIR
    // stays undefined, so the overlay/toolbar/theme-link/style are all skipped and
    // the editor opens straight into the live (post-Lute) render.
    const instantPreview = cfg.get<boolean>('advanced.instantPreview') !== false
    const preIR =
      instantPreview && content !== undefined
        ? renderForMode(this._context.extensionPath, content, mode)
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
        }" style="height:100%" aria-hidden="true">${prerenderToolbar}<div class="vditor-content"><div class="${innerClass}"><pre class="vditor-reset">${preIR}</pre></div></div></div>`
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
      MarkdownEditorProvider._cssStyleTags(uri) +
      prerenderStyle +
      `
			</head>
			<body ${bodyAttrs} style="--me-font-size:${fontSizeCss}">
				<div id="app"></div>
				${prerenderOverlay}

				<script nonce="${nonce}" id="vditorI18nScript${i18nLang}" src="${i18nScript}"></script>
				<script nonce="${nonce}" id="vditorIconScript" src="${iconScript}"></script>
				<script nonce="${nonce}" id="vditorIconOverride" src="${iconOverrideScript}"></script>
				${JsFiles.map((f) => `<script nonce="${nonce}" src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
