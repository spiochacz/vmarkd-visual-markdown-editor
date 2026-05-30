import * as vscode from 'vscode'
import * as NodePath from 'path'
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

function debug(...args: any[]) {
  console.log(...args)
}

function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
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
  private static getFolders(): vscode.Uri[] {
    const data = []
    for (let i = 65; i <= 90; i++) {
      data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
    }
    return data
  }

  static getWebviewOptions(): vscode.WebviewOptions &
    vscode.WebviewPanelOptions {
    return {
      // Enable javascript in the webview
      enableScripts: true,

      localResourceRoots: [vscode.Uri.file("/"), ...this.getFolders()],
      // The effective panel-level option is set in registerCustomEditorProvider
      // (task 37); kept here in sync for clarity.
      retainContextWhenHidden:
        this.config.get<boolean>('retainHiddenEditors') ?? true,
      enableCommandUris: true,
    }
  }

  static get config() {
    return vscode.workspace.getConfiguration('markdown-editor')
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
    webviewPanel.webview.options = MarkdownEditorProvider.getWebviewOptions()
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

    disposables.push(
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
                ...this._context.globalState.get(KeyVditorOptions),
              },
              theme: currentThemeKind(),
              wiki: wikiInit,
            })
            break
          }
          case 'save-options':
            await this._context.globalState.update(KeyVditorOptions, message.options)
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

    return (
      `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join('\n')}

				<title>markdown editor</title>
        <style>` +
      MarkdownEditorProvider.config.get<string>('customCss') +
      `</style>
			</head>
			<body>
				<div id="app"></div>

				<script id="vditorIconScript" src="${iconScript}"></script>
				${JsFiles.map((f) => `<script src="${f}"></script>`).join('\n')}
			</body>
			</html>`
    )
  }
}
