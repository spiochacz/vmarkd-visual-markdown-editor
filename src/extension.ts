import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import * as fs from 'node:fs'
import { readingTime, wordCount } from './reading-time'
import { MarkdownOutlineProvider, type HeadingItem } from './outline-tree'
import { selectionForLine } from './reveal-range'
import { createDiffScheduler, makeDiffComputer } from './git-diff'
import {
  type EditorMode,
  prewarmLute,
  renderForMode,
  reserializeMarkdown,
} from './lute-host'
import { minimalDiffWriteback } from './minimal-diff-writeback'
import { escapeTableSpanPipes } from './table-pipe-escape'
import {
  createWikiPage,
  getWikiDocumentContext,
  getWikiRoot,
  isWikiFile,
  normalizeWikiLookupKey,
} from './wiki'
import {
  disposeAllCaches,
  getOrBuildCache,
  invalidateCache,
} from './wiki-cache'
import { buildWebviewHtml, sanitizeCss } from './html-builder'
import {
  resolveContentTheme,
  resolveFontSize,
  themeDef,
} from './theme-registry'

const KeyVditorOptions = 'vmarkd.options'
const KeyOutlineWidth = 'vmarkd.outlineWidth'
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

// Resolve the `fontSize` setting to the --me-font-size CSS value. Thin alias over the
// shared registry resolver (src/theme-registry.ts) so the host and webview can't
// diverge — the registry is now importable by BOTH build units (it's dependency-free),
// retiring the old "separate bundle, can't share" duplication. Kept exported under this
// name for the host unit tests + the call site below.
export const resolveFontSizeCss = resolveFontSize

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

// The editor's light/dark MODE (task 82). A GitHub content theme pins the mode to
// its own light/dark so the rendered content — including code blocks (hljs) — is
// themed consistently (github-light → light code, not the VS Code dark code). The
// toolbar/chrome stays VS Code-coloured regardless (its CSS vars are mode-independent
// in main.css). `auto` follows the VS Code theme.
function effectiveThemeKind(): 'dark' | 'light' {
  const ct = resolveContentTheme(
    vscode.workspace.getConfiguration('vmarkd').get<string>('theme.content'),
  )
  // A named theme pins its own mode (registry); `auto`/unknown follows VS Code.
  return themeDef(ct)?.mode ?? currentThemeKind()
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

// task 69: per-document large/normal regime (block-count gate), reported by the webview
// and shown as a small status-bar marker. Keyed by uri.toString(). `refreshStatusBarMarker`
// is the status-bar updater, wired in activate() so the webview report can refresh it.
export const docLargeMode = new Map<
  string,
  {
    blocks: number
    chars: number
    contentVisibility: boolean
    streaming: boolean
    incremental: boolean
  }
>()
let refreshStatusBarMarker: () => void = () => {}
// Wired in activate(); called from a panel's onDidChangeViewState so the
// Markdown Outline tree (task 78) follows the active vMarkd editor — custom
// editors don't fire onDidChangeActiveTextEditor.
let refreshOutline: () => void = () => {}

// Native status-bar items (task 35): estimated reading time + an editor-mode
// indicator (WYSIWYG vs Source) + a large/normal document marker (task 69), shown
// only while a markdown doc is the active tab. Returns an `update` fn the caller wires
// to the same active-tab / document listeners that drive updateEditorContexts.
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
  // task 69: large-document marker (incremental serialization regime). Right-aligned with
  // a higher priority than reading-time (100) so it sits to the LEFT of the word counter;
  // shown only for large docs — its presence alone signals "incremental mode".
  const docSize = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101,
  )
  docSize.name = 'vMarkd Document Size'
  context.subscriptions.push(reading, mode, docSize)

  const textForUri = (uri: vscode.Uri): string =>
    vscode.workspace.textDocuments
      .find((d) => d.uri.toString() === uri.toString())
      ?.getText() ?? ''

  return () => {
    const input = getActiveTabInput()
    const showFor = (uri: vscode.Uri) => {
      const text = textForUri(uri)
      reading.text = `$(book) ${readingTime(text)} · $(pencil) ${wordCount(text)} words`
      reading.tooltip = 'Estimated reading time · word count'
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
      // Large-doc marker — shown whenever ANY large-document helper is active
      // (content-visibility, streaming, or incremental serialization). The tooltip
      // lists exactly which are on. Only meaningful in the visual editor (webview).
      const ds = docLargeMode.get(input.uri.toString())
      const active: string[] = []
      if (ds?.contentVisibility) {
        const kb = ds.chars ? ` (~${Math.round(ds.chars / 1024)} KB)` : ''
        active.push(
          `**content-visibility**${kb} — browser skips layout/paint of off-screen blocks, keeping tab-switch repaint fast`,
        )
      }
      if (ds?.streaming) {
        active.push(
          '**chunked streaming** — the document was rendered progressively at open instead of one blocking pass',
        )
      }
      if (ds?.incremental) {
        active.push(
          `**incremental serialization** (${ds.blocks} top-level blocks) — only the edited block is reparsed on save`,
        )
      }
      if (active.length) {
        docSize.text = '$(zap) Large md'
        const tip = new vscode.MarkdownString(
          `**Large-document helpers active:**\n\n${active.map((a) => `- ${a}`).join('\n')}`,
        )
        docSize.tooltip = tip
        docSize.show()
      } else {
        docSize.hide()
      }
    } else if (
      input instanceof vscode.TabInputText &&
      isSupportedMarkdownUri(input.uri)
    ) {
      showFor(input.uri)
      mode.text = '$(code) Source'
      mode.tooltip = 'Markdown: source view — click to open the visual editor'
      mode.command = 'vmarkd.openEditor'
      mode.show()
      docSize.hide() // no webview in source view → the marker doesn't apply
    } else {
      reading.hide()
      mode.hide()
      docSize.hide()
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
  context.subscriptions.push({ dispose: disposeAllCaches })

  // Warm the host-side Lute now so the first file open already gets the instant
  // pre-rendered paint (see src/lute-host.ts). Deferred off the activation path.
  prewarmLute(context.extensionPath)

  const updateStatusBar = setupStatusBar(context)
  // Let a webview's large/normal-mode report (task 69) refresh the status-bar marker.
  refreshStatusBarMarker = updateStatusBar

  // Markdown Outline tree (task 78): a sidebar TreeView, because VS Code's
  // built-in Outline does not query DocumentSymbolProvider while a custom editor
  // is active (microsoft/vscode#97095). Tracks the active vMarkd/text markdown
  // document and lets a click scroll the webview to that heading.
  const outlineProvider = new MarkdownOutlineProvider()
  let lastHasOutline: boolean | undefined
  const updateOutline = () => {
    const enabled =
      MarkdownEditorProvider.config.get<boolean>('outline.treeView') !== false
    const target = enabled ? getCommandTarget() : undefined
    const doc =
      target && isSupportedMarkdownUri(target)
        ? vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === target.toString(),
          )
        : undefined
    outlineProvider.refresh(doc)
    const has = !!doc
    if (has !== lastHasOutline) {
      lastHasOutline = has
      void vscode.commands.executeCommand(
        'setContext',
        'vmarkd.hasOutline',
        has,
      )
    }
  }
  // Debounced — a single file switch fires many editor/tab/view-state events;
  // coalesce them so the tree rebuilds once (not 4–5×, which froze the UI).
  let outlineTimer: NodeJS.Timeout | undefined
  const scheduleOutline = () => {
    if (outlineTimer) clearTimeout(outlineTimer)
    outlineTimer = setTimeout(updateOutline, 120)
  }
  const debouncedOutline = scheduleOutline

  refreshOutline = scheduleOutline
  const refreshContexts = () => {
    void updateEditorContexts()
    updateStatusBar()
    scheduleOutline()
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
            MarkdownEditorProvider.config.get<boolean>(
              'advanced.retainHidden',
            ) ?? true,
          enableFindWidget: true,
        },
      },
    ),
    vscode.window.onDidChangeActiveTextEditor(refreshContexts),
    vscode.window.tabGroups.onDidChangeTabs(refreshContexts),
    vscode.workspace.onDidOpenTextDocument(refreshContexts),
    vscode.workspace.onDidCloseTextDocument(refreshContexts),
    vscode.workspace.onDidChangeTextDocument(debouncedStatusBar),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === outlineProvider.uri?.toString())
        debouncedOutline()
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vmarkd.outline.treeView')) scheduleOutline()
    }),
    vscode.window.registerTreeDataProvider('vmarkd.outline', outlineProvider),
    vscode.commands.registerCommand(
      'vmarkd.outlineReveal',
      (item: HeadingItem) => {
        const panel = MarkdownEditorProvider.findPanelForUri(item.documentUri)
        if (panel) {
          panel.panel.webview.postMessage({
            command: 'scroll-to-heading',
            index: item.index,
          })
          panel.panel.reveal?.(undefined, false)
        } else {
          // No open vMarkd webview — fall back to revealing the source line.
          void vscode.window.showTextDocument(item.documentUri).then((ed) => {
            const pos = new vscode.Position(item.line, 0)
            ed.selection = new vscode.Selection(pos, pos)
            ed.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.AtTop,
            )
          })
        }
      },
    ),
  )

  context.globalState.setKeysForSync([KeyVditorOptions, KeyOutlineWidth])
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
  private lastWikiRoot: vscode.Uri | undefined
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

  // Task 61 — minimal-diff write-back. Keep the ORIGINAL source bytes for every block
  // the user didn't actually change; only changed blocks take Vditor's reserialized
  // form. Best-effort + gated by size (large docs reflow negligibly — see task 49/61
  // benches — and aren't worth the per-block reserialize cost) and falls back to the
  // editor's full output on any issue. `reserializeMarkdown` is memoized per source
  // block (block bytes are stable across edits), so only the first edit pays the cost.
  private static MINDIFF_CAP = 100_000
  private reserializeCache = new Map<string, string>()
  private minimizeWriteback(original: string, next: string): string {
    if (original.length > EditorSession.MINDIFF_CAP) return next
    try {
      return minimalDiffWriteback(original, next, (block) => {
        const hit = this.reserializeCache.get(block)
        if (hit !== undefined) return hit
        const r = reserializeMarkdown(this.context.extensionPath, block)
        if (r !== undefined) this.reserializeCache.set(block, r) // don't cache cold-Lute misses
        return r
      })
    } catch {
      return next
    }
  }

  private async syncToEditor(content: string) {
    const document = this.document
    if (normalizeContent(content) === normalizeContent(document.getText())) {
      this.lastSyncedContent = document.getText()
      return
    }
    const toWrite = this.minimizeWriteback(document.getText(), content)
    // Minimization may reduce the edit to a no-op vs disk (pure reflow the user undid).
    if (normalizeContent(toWrite) === normalizeContent(document.getText())) {
      this.lastSyncedContent = document.getText()
      return
    }
    this.applyingWebviewEdit = true
    this.pendingWebviewContent = toWrite
    try {
      const edit = new vscode.WorkspaceEdit()
      edit.replace(this.activeUri, this.documentRange(document), toWrite)
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
      // Normalize table-cell math/code pipes (#1904) before Vditor parses it. Identity
      // for content without the bug; dedup above still tracks the raw text.
      content: escapeTableSpanPipes(content),
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
      // Effective light/dark mode so a live theme.content change re-themes the
      // editor (mode + code) without a reopen (task 82).
      theme: effectiveThemeKind(),
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
    const wikiRoot = this.wiki.enabled
      ? getWikiRoot(this.document.uri)
      : undefined
    this.lastWikiRoot = wikiRoot
    if (wikiRoot) {
      const cache = await getOrBuildCache(wikiRoot, () => {
        // Watcher fired (file create/delete) — push updated keys to webview.
        this.webviewPanel.webview.postMessage({
          command: 'wiki-update',
          pageKeys: cache.allPageKeys(),
          displayNames: cache.allDisplayNames(),
        })
      })
      // Send the full key + display-name set at init so the hint and the
      // missing-link check agree from the first render. (These are precomputed
      // and cached on the WikiCache, so this is cheap — no per-target resolve.)
      wikiInit = {
        ...this.wiki,
        pageKeys: cache.allPageKeys(),
        displayNames: cache.allDisplayNames(),
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
        // Drag-resized outline width overrides the setting default.
        ...(this.context.globalState.get<number>(KeyOutlineWidth)
          ? {
              outlineWidth:
                this.context.globalState.get<number>(KeyOutlineWidth),
            }
          : {}),
      },
      theme: effectiveThemeKind(),
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

  // Copy HTML / Markdown via the host clipboard (task 53 #1). The webview posts the
  // content and we write it with vscode.env.clipboard — rock-solid regardless of
  // iframe focus/permissions, unlike navigator.clipboard inside the webview.
  private async onCopyToClipboard(message: any, label: string) {
    try {
      await vscode.env.clipboard.writeText(String(message.content ?? ''))
      vscode.window.showInformationMessage(`Copy ${label} successfully!`)
    } catch (error: any) {
      showError(`Copy ${label} failed! ${error?.message ?? error}`)
    }
  }

  private async onEdit(message: any) {
    await this.syncToEditor(message.content)
  }

  // The webview reports which large-document helpers are active (content-visibility,
  // streaming, incremental serialization). Store per-uri and refresh the status-bar
  // marker, whose tooltip lists the active ones.
  private onDocMode(message: any) {
    docLargeMode.set(this.activeUri.toString(), {
      blocks: Number(message.blocks) || 0,
      chars: Number(message.chars) || 0,
      contentVisibility: Boolean(message.contentVisibility),
      streaming: Boolean(message.streaming),
      incremental: Boolean(message.incremental),
    })
    refreshStatusBarMarker()
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
    const cache = await getOrBuildCache(wikiRoot)
    const allPages = cache.allFiles()
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
    const root = getWikiRoot(this.document.uri)
    if (!root) {
      showError(
        'Wiki links are only enabled for Markdown files inside a wiki folder.',
      )
      return
    }
    const rawTarget = String(message.target)
    const [targetPart] = rawTarget.split('|', 1)
    const key = normalizeWikiLookupKey(targetPart.trim())
    if (!key) {
      showError('Invalid wiki link target.')
      return
    }
    const cache = await getOrBuildCache(root)
    const matches = cache.resolve(key)

    if (matches.length === 0) {
      const createChoice = await vscode.window.showWarningMessage(
        `Wiki page "${rawTarget}" was not found under "${vscode.workspace.asRelativePath(root, false)}".`,
        'Create Page',
      )
      if (createChoice === 'Create Page') {
        if (!ensureCanWriteFiles(this.document.uri)) return
        const newFileUri = await createWikiPage(root, key)
        await vscode.commands.executeCommand(
          'vscode.openWith',
          newFileUri,
          MarkdownEditorViewType,
        )
      }
      return
    }
    if (matches.length > 1) {
      const picked = await vscode.window.showQuickPick(
        matches.map((candidate) => ({
          label: NodePath.basename(candidate.fsPath),
          description: vscode.workspace.asRelativePath(candidate, false),
          uri: candidate,
        })),
        {
          title: `Select wiki page for "${rawTarget}"`,
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
      return
    }
    await vscode.commands.executeCommand(
      'vscode.openWith',
      matches[0],
      MarkdownEditorViewType,
    )
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
    // NOTE: webview.html is intentionally set LAST (after onDidReceiveMessage is
    // registered below) — see the assignment at the end of this method. Setting it
    // here loads main.js, which posts `ready` almost immediately; if the host's
    // message listener isn't attached yet, that `ready` is dropped and the editor
    // never gets its `init` payload (blank/"hung" editor — intermittent, races the
    // bundle load). Attaching the listener first closes that race.

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
      save: (message) => this.onSave(message),
      docMode: (message) => this.onDocMode(message),
      log: (message) => logger?.appendLine(String(message?.text ?? '')),
      'edit-in-vscode': () => this.onEditInVscode(),
      'navigate-back': () => this.onNavigateBack(),
      'open-settings': () => this.onOpenSettings(),
      'list-wiki-pages': () => this.onListWikiPages(),
      'save-outline-width': (message) =>
        this.context.globalState.update(KeyOutlineWidth, message.width),
      upload: (message) => this.onUpload(message),
      'open-link': (message) => this.onOpenLink(message),
      'open-wikilink': (message) => this.onOpenWikilink(message),
      'copy-html': (message) => this.onCopyToClipboard(message, 'HTML'),
      'copy-markdown': (message) => this.onCopyToClipboard(message, 'Markdown'),
    }

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        // Scope to this document's uri so resource-scoped overrides (task 51 #3)
        // in a folder's .vscode/settings.json trigger a reload — and so an
        // unrelated folder's change doesn't reload editors it doesn't affect.
        if (!e.affectsConfiguration('vmarkd', this.activeUri)) {
          return
        }
        // Wiki config changed (enabled/root) → invalidate the old cache so the
        // re-init (triggered by postLiveConfig → handleConfigChanged) builds a
        // fresh cache for the potentially-changed root.
        if (e.affectsConfiguration('vmarkd.wiki')) {
          if (this.lastWikiRoot) {
            invalidateCache(this.lastWikiRoot)
            this.lastWikiRoot = undefined
          }
          this.wiki = getWikiDocumentContext(this.document.uri)
          void updateEditorContexts()
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
        // Live re-theme this editor when the VS Code theme changes (task 25). A
        // GitHub content theme pins the mode to its own light/dark (task 82), so
        // effectiveThemeKind keeps the content stable here while `auto` follows VS Code.
        webviewPanel.webview.postMessage({
          command: 'set-theme',
          theme: effectiveThemeKind(),
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
      webviewPanel.onDidChangeViewState(() => {
        // Custom editors don't fire onDidChangeActiveTextEditor, so refresh the
        // Markdown Outline tree (task 78) when this panel becomes active/inactive.
        refreshOutline()
      }),
      webviewPanel.webview.onDidReceiveMessage(async (message) => {
        debug('msg from webview review', message, webviewPanel.active)

        await messageHandlers[message.command]?.(message)
      }),
      webviewPanel.onDidDispose(() => {
        this.pendingWebviewContent = undefined
        docLargeMode.delete(this.activeUri.toString())
        MarkdownEditorProvider.activePanels.delete(this.panelEntry)
        if (this.textEditTimer) {
          clearTimeout(this.textEditTimer)
        }
        while (this.disposables.length) {
          this.disposables.pop()?.dispose()
        }
      }),
    )

    // Set the HTML LAST — only now that onDidReceiveMessage (above) is attached.
    // This loads main.js, which posts `ready` and triggers the init handshake; with
    // the listener already live, the `ready` can't be dropped, so the editor always
    // gets its content (fixes the intermittent blank/"hung" editor on window reload).
    webviewPanel.webview.html = this.htmlForWebview(
      webviewPanel.webview,
      document.uri,
      document.getText(),
      effectiveThemeKind(),
    )

    // Populate the Markdown Outline tree for this freshly-opened editor (task 78);
    // onDidChangeViewState may not fire on the initial open.
    refreshOutline()
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

  static sanitizeCss(css: string | undefined): string {
    return sanitizeCss(css)
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
    // Rendering theme (task 82): `auto` keeps the VS Code-colour look (the old
    // useVscodeColors=true path); github-light/github-dark force a GitHub palette
    // via the vendored github-markdown-css <link>, so `auto` ⇔ useVscodeThemeColor.
    const contentTheme = resolveContentTheme(c.get<string>('theme.content'))
    return {
      contentTheme,
      useVscodeThemeColor: contentTheme === 'auto',
      enableFullWidth: c.get<boolean>('editor.fullWidth'),
      codeBlockLineNumbers: c.get<boolean>('editor.codeLineNumbers'),
      mermaidTheme: c.get<string>('theme.mermaid'),
      echartsTheme: c.get<string>('theme.echarts'),
      d2Layout: c.get<string>('diagram.d2Layout'),
      showToolbar: c.get<boolean>('editor.toolbar'),
      highlightHeadings: c.get<boolean>('theme.highlightHeadings'),
      showHeadingMarkers: c.get<boolean>('editor.headingMarkers'),
      fontSize: c.get<string>('editor.fontSize'),
      outlinePosition: c.get<string>('outline.position'),
      showOutlineByDefault: c.get<boolean>('outline.openByDefault'),
      outlineHighlight: c.get<boolean>('outline.highlight'),
      codeTheme: c.get<string>('theme.code'),
      streamLargeFiles: c.get<boolean>('advanced.streamLargeFiles'),
      contentVisibility: c.get<boolean>('advanced.contentVisibility'),
      linkOpenWithModifier: c.get<boolean>('editor.linkOpenWithModifier'),
      // Image upload conversion (task 74) — read by the webview's upload handler.
      imageFormat: c.get<string>('image.format'),
      imageQuality: c.get<number>('image.quality'),
      imageMaxWidth: c.get<number>('image.maxWidth'),
      wikiEnabled: c.get<boolean>('wiki.enabled') !== false,
    }
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
      webview
        .asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, f))
        .toString()
    const baseHref = `${NodePath.dirname(
      webview.asWebviewUri(vscode.Uri.file(uri.fsPath)).toString(),
    )}/`
    const cfg = MarkdownEditorProvider.config
    const savedOpts = MarkdownEditorProvider.sanitizeVditorOptions(
      this._context.globalState.get(KeyVditorOptions),
    ) as { mode?: string } | undefined
    const savedMode: EditorMode =
      savedOpts?.mode === 'wysiwyg'
        ? 'wysiwyg'
        : savedOpts?.mode === 'sv'
          ? 'sv'
          : 'ir'

    const contentTheme = resolveContentTheme(cfg.get<string>('theme.content'))
    return buildWebviewHtml({
      toUri,
      baseHref,
      cspSource: webview.cspSource,
      nonce: getNonce(),
      theme,
      config: {
        showToolbar: cfg.get<boolean>('editor.toolbar') !== false,
        contentTheme,
        useVscodeThemeColor: contentTheme === 'auto',
        enableFullWidth: cfg.get<boolean>('editor.fullWidth') === true,
        highlightHeadings: cfg.get<boolean>('theme.highlightHeadings') === true,
        showHeadingMarkers: cfg.get<boolean>('editor.headingMarkers') !== false,
        fontSize: resolveFontSizeCss(
          cfg.get<string>('editor.fontSize'),
          contentTheme,
        ),
        instantPreview: cfg.get<boolean>('advanced.instantPreview') !== false,
        allowRemoteImages:
          MarkdownEditorProvider.cfgFor(uri).get<boolean>(
            'image.allowRemoteImages',
          ) === true,
        customCss:
          MarkdownEditorProvider.cfgFor(uri).get<string>('css.custom') || '',
        externalCss: MarkdownEditorProvider.readExternalCss(uri),
      },
      preRenderedHtml:
        content !== undefined
          ? renderForMode(
              this._context.extensionPath,
              content,
              savedMode,
              isWikiFile(uri),
            )
          : undefined,
      savedMode,
      i18nLang: resolveVditorI18nLang(vscode.env?.language),
    })
  }
}
