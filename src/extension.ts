import * as vscode from 'vscode'
import * as NodePath from 'path'
import * as fs from 'fs'
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
      .join(' ')
  )
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
}

// Random per-render nonce so only our own <script> tags are allowed to run
// under the CSP (task 18 §2c) — injected inline scripts (no nonce) cannot.
function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
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
      `[markdown-editor] Image upload and wiki page creation are unavailable in virtual workspaces.`
    )
    return false
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      `[markdown-editor] Trust this workspace to upload images and create wiki pages.`
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
    isWikiFile(target)
  )
}

export function activate(context: vscode.ExtensionContext) {
  logger = vscode.window.createOutputChannel('vMarkd', { log: true })
  context.subscriptions.push(logger)

  const refreshContexts = () => {
    void updateEditorContexts()
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
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorViewType
        )
      }
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
        await vscode.commands.executeCommand('vscode.openWith', target, 'default')
      }
    ),
    vscode.commands.registerCommand('markdown-editor.openSettings', async () => {
      // Open the Settings UI filtered to this extension's options.
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:spiochacz.vmarkd'
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
            MarkdownEditorProvider.config.get<boolean>('retainHiddenEditors') ?? true,
          enableFindWidget: true,
        },
      }
    ),
    vscode.window.onDidChangeActiveTextEditor(refreshContexts),
    vscode.window.tabGroups.onDidChangeTabs(refreshContexts),
    vscode.workspace.onDidOpenTextDocument(refreshContexts),
    vscode.workspace.onDidCloseTextDocument(refreshContexts)
  )

  context.globalState.setKeysForSync([KeyVditorOptions])
  refreshContexts()
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
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
    documentUri: vscode.Uri
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
    documentUri: vscode.Uri
  ): vscode.WebviewOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,
      // Narrowed to the extension media dir + the document's workspace (task 18 §2a).
      localResourceRoots: this.webviewRoots(extensionUri, documentUri),
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
    const files = this.config.get<string[]>('externalCssFiles') || []
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
    const files = MarkdownEditorProvider.config.get<string[]>('externalCssFiles') || []
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    return files
      .filter(Boolean)
      .map((f) => (NodePath.isAbsolute(f) ? f : root ? NodePath.join(root, f) : f))
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
        s
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
    const external = `<style id="external-css">${this.sanitizeCss(this.readExternalCss())}</style>`
    const custom = `<style id="custom-css">${this.sanitizeCss(this.config.get<string>('customCss'))}</style>`
    return external + custom
  }

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
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
      .asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vditor'))
      .toString()
    let textEditTimer: NodeJS.Timeout | undefined
    let applyingWebviewEdit = false
    let pendingWebviewContent: string | undefined
    let lastSyncedContent = document.getText()

    webviewPanel.title = NodePath.basename(activeFsPath)
    webviewPanel.iconPath = new vscode.ThemeIcon('markdown')
    // Augment, don't replace: keep VS Code's default custom-editor webview options
    // and only override the ones we control (task 27).
    webviewPanel.webview.options = {
      ...webviewPanel.webview.options,
      ...MarkdownEditorProvider.getWebviewOptions(
        this._context.extensionUri,
        document.uri
      ),
    }
    webviewPanel.webview.html = this._getHtmlForWebview(
      webviewPanel.webview,
      document.uri
    )

    const syncToEditor = async (content: string) => {
      if (
        normalizeContent(content) === normalizeContent(document.getText())
      ) {
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
      } = { options: void 0 }
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

    // Extracted so it can be disposed + recreated when the file is renamed.
    const setupFileWatcher = (uri: vscode.Uri): vscode.Disposable | undefined => {
      if (!workspaceFolder) {
        return undefined
      }
      const relativePath = NodePath.relative(
        workspaceFolder.uri.fsPath,
        uri.fsPath
      ).replace(/\\/g, '/')
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, relativePath)
      )
      return vscode.Disposable.from(
        watcher,
        watcher.onDidChange(() => schedulePostUpdate()),
        watcher.onDidCreate(() => schedulePostUpdate())
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
          useVscodeThemeColor:
            MarkdownEditorProvider.config.get<boolean>('useVscodeThemeColor'),
          enableFullWidth:
            MarkdownEditorProvider.config.get<boolean>('enableFullWidth'),
          highlightHeadings:
            MarkdownEditorProvider.config.get<boolean>('highlightHeadings'),
          showHeadingMarkers:
            MarkdownEditorProvider.config.get<boolean>('showHeadingMarkers'),
          fontSize: MarkdownEditorProvider.config.get<string>('fontSize'),
          outlineWidth: MarkdownEditorProvider.config.get<number>('outlineWidth'),
          // constructor-only options — a change re-inits Vditor (webview side)
          showToolbar: MarkdownEditorProvider.config.get<boolean>('showToolbar'),
          wordCount: MarkdownEditorProvider.config.get<boolean>('wordCount'),
          codeBlockLineNumbers:
            MarkdownEditorProvider.config.get<boolean>('codeBlockLineNumbers'),
          outlinePosition:
            MarkdownEditorProvider.config.get<string>('outlinePosition'),
          showOutlineByDefault:
            MarkdownEditorProvider.config.get<boolean>('showOutlineByDefault'),
          outlineHighlight:
            MarkdownEditorProvider.config.get<boolean>('outlineHighlight'),
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
            w.onDidDelete(postExternalCss)
          )
        })
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
        schedulePostUpdate()
      }),
      vscode.workspace.onDidRenameFiles((e) => {
        // Phase 1: direct file rename only. Re-point identity, tab, watcher and
        // suppress the old-uri close that would otherwise dispose the panel.
        const hit = e.files.find(
          (f) => f.oldUri.toString() === activeUri.toString()
        )
        if (!hit) {
          return
        }
        suppressCloseDispose = true
        activeUri = hit.newUri
        activeFsPath = hit.newUri.fsPath
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
                  'useVscodeThemeColor'
                ),
                enableFullWidth: MarkdownEditorProvider.config.get<boolean>(
                  'enableFullWidth'
                ),
                wordCount: MarkdownEditorProvider.config.get<boolean>('wordCount'),
                codeBlockLineNumbers: MarkdownEditorProvider.config.get<boolean>(
                  'codeBlockLineNumbers'
                ),
                showToolbar: MarkdownEditorProvider.config.get<boolean>('showToolbar'),
                highlightHeadings: MarkdownEditorProvider.config.get<boolean>(
                  'highlightHeadings'
                ),
                showHeadingMarkers: MarkdownEditorProvider.config.get<boolean>(
                  'showHeadingMarkers'
                ),
                fontSize: MarkdownEditorProvider.config.get<string>('fontSize'),
                outlinePosition: MarkdownEditorProvider.config.get<string>(
                  'outlinePosition'
                ),
                outlineWidth: MarkdownEditorProvider.config.get<number>('outlineWidth'),
                showOutlineByDefault: MarkdownEditorProvider.config.get<boolean>(
                  'showOutlineByDefault'
                ),
                outlineHighlight: MarkdownEditorProvider.config.get<boolean>(
                  'outlineHighlight'
                ),
                ...MarkdownEditorProvider.sanitizeVditorOptions(
                  this._context.globalState.get(KeyVditorOptions)
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
              MarkdownEditorProvider.sanitizeVditorOptions(message.options)
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
            await vscode.commands.executeCommand(
              'markdown-editor.openTextEditor',
              activeUri
            )
            break
          case 'navigate-back':
            await vscode.commands.executeCommand('workbench.action.navigateBack')
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
              NodePath.basename(a.fsPath).localeCompare(NodePath.basename(b.fsPath))
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
              }
            )
            if (picked?.uri) {
              await vscode.commands.executeCommand(
                'vscode.openWith',
                picked.uri,
                MarkdownEditorViewType
              )
            }
            break
          }
          case 'upload': {
            if (!ensureCanWriteFiles(activeUri)) {
              break
            }
            const assetsFolder = MarkdownEditorProvider.getAssetsFolder(activeUri)
            try {
              await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsFolder))
            } catch (error) {
              console.error(error)
              showError(`Invalid image folder: ${assetsFolder}`)
            }
            await Promise.all(
              message.files.map(async (file: any) => {
                const content = Buffer.from(file.base64, 'base64')
                return vscode.workspace.fs.writeFile(
                  vscode.Uri.file(NodePath.join(assetsFolder, file.name)),
                  content
                )
              })
            )
            webviewPanel.webview.postMessage({
              command: 'uploaded',
              files: message.files.map((file: any) =>
                NodePath.relative(
                  NodePath.dirname(activeFsPath),
                  NodePath.join(assetsFolder, file.name)
                ).replace(/\\/g, '/')
              ),
            })
            break
          }
          case 'open-link': {
            let url = message.href
            if (!/^https?:/i.test(url)) {
              url = NodePath.resolve(NodePath.dirname(activeFsPath), url)
            }
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url))
            break
          }
          case 'open-wikilink': {
            const resolution = await resolveWikiLink(document.uri, String(message.target))

            switch (resolution.kind) {
              case 'disabled':
                showError(`Wiki links are only enabled for Markdown files inside a wiki folder.`)
                break
              case 'invalid':
                showError(`Invalid wiki link target.`)
                break
              case 'missing': {
                const createChoice = await vscode.window.showWarningMessage(
                  `Wiki page "${message.target}" was not found under "${vscode.workspace.asRelativePath(
                    resolution.root,
                    false
                  )}".`,
                  'Create Page'
                )
                if (createChoice === 'Create Page') {
                  if (!ensureCanWriteFiles(document.uri)) {
                    break
                  }
                  const newFileName = resolution.key.replace(/\//g, '-') + '.md'
                  const newFileUri = vscode.Uri.joinPath(resolution.root, newFileName)
                  const heading = resolution.key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                  await vscode.workspace.fs.writeFile(
                    newFileUri,
                    Buffer.from(`# ${heading}\n`)
                  )
                  await vscode.commands.executeCommand(
                    'vscode.openWith',
                    newFileUri,
                    MarkdownEditorViewType
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
                  }
                )

                if (picked?.uri) {
                  await vscode.commands.executeCommand(
                    'vscode.openWith',
                    picked.uri,
                    MarkdownEditorViewType
                  )
                }
                break
              }
              case 'resolved':
                await vscode.commands.executeCommand(
                  'vscode.openWith',
                  resolution.target,
                  MarkdownEditorViewType
                )
                break
            }
            break
          }
        }
      }),
      webviewPanel.onDidDispose(() => {
        pendingWebviewContent = undefined
        if (textEditTimer) {
          clearTimeout(textEditTimer)
        }
        while (disposables.length) {
          disposables.pop()?.dispose()
        }
      })
    )
  }

  static getAssetsFolder(uri: vscode.Uri) {
    const imageSaveFolder = (
      MarkdownEditorProvider.config.get<string>('imageSaveFolder') || 'assets'
    )
      .replace(
        '${projectRoot}',
        vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || ''
      )
      .replace('${file}', uri.fsPath)
      .replace(
        '${fileBasenameNoExtension}',
        NodePath.basename(uri.fsPath, NodePath.extname(uri.fsPath))
      )
      .replace('${dir}', NodePath.dirname(uri.fsPath))
    const assetsFolder = NodePath.resolve(
      NodePath.dirname(uri.fsPath),
      imageSaveFolder
    )
    return assetsFolder
  }

  private _documentRange(document: vscode.TextDocument) {
    const lastLine = document.lineAt(Math.max(document.lineCount - 1, 0))
    return new vscode.Range(0, 0, lastLine.range.end.line, lastLine.range.end.character)
  }

  private _getHtmlForWebview(webview: vscode.Webview, uri: vscode.Uri) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, f))
    const baseHref =
      NodePath.dirname(
        webview.asWebviewUri(vscode.Uri.file(uri.fsPath)).toString()
      ) + '/'
    const toMediaPath = (f: string) => `media/dist/${f}`
    const JsFiles = ['main.js'].map(toMediaPath).map(toUri)
    const CssFiles = ['main.css'].map(toMediaPath).map(toUri)
    const iconScript = toUri('media/vditor/dist/js/icons/ant.js')

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
      MarkdownEditorProvider._cssStyleTags() +
      `
			</head>
			<body>
				<div id="app"></div>

				<script nonce="${nonce}" id="vditorIconScript" src="${iconScript}"></script>
				${JsFiles.map((f) => `<script nonce="${nonce}" src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
