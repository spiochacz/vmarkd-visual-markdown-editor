/**
 * Minimal in-memory mock of the `vscode` API surface that
 * `src/extension.ts` and `src/wiki.ts` touch. Aliased to the bare
 * `vscode` specifier via `test/vitest.config.ts` (resolve.alias).
 *
 * It is intentionally small: it implements only what the provider calls,
 * plus a `mock` control surface for driving events and inspecting calls.
 *
 * Extend (don't rewrite) when new API surface is exercised — see the
 * portability notes in `tasks/21-backend-tests-vitest.md`.
 */
import { vi } from 'vitest'
import * as NodePath from 'node:path'

// ---------------------------------------------------------------------------
// Value types (constructed with `new vscode.X(...)` or `vscode.X.static(...)`)
// ---------------------------------------------------------------------------

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '')
  }

  static parse(value: string): Uri {
    // scheme://authority/path
    const full = /^([a-zA-Z][\w+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(value)
    if (full) {
      return new Uri(full[1], full[2] || '', full[3] || '', '', '')
    }
    // scheme:path (e.g. untitled:Untitled-1) — but not a bare absolute path
    const scoped = /^([a-zA-Z][\w+.-]*):(.*)$/.exec(value)
    if (scoped && !value.startsWith('/')) {
      const p = scoped[2]
      return new Uri(scoped[1], '', p.startsWith('/') ? p : `/${p}`, '', '')
    }
    // bare filesystem path
    return new Uri('file', '', value, '', '')
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(
      base.scheme,
      base.authority,
      NodePath.posix.join(base.path, ...segments),
      '',
      '',
    )
  }

  get fsPath(): string {
    return this.path
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position
  public readonly end: Position

  constructor(
    startLineOrPos: number | Position,
    startCharOrPos: number | Position,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startLineOrPos === 'number') {
      this.start = new Position(startLineOrPos, startCharOrPos as number)
      this.end = new Position(endLine!, endChar!)
    } else {
      this.start = startLineOrPos
      this.end = startCharOrPos as Position
    }
  }
}

export class Selection extends Range {
  get anchor(): Position {
    return this.start
  }
  get active(): Position {
    return this.end
  }
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  String = 14,
  Number = 15,
  Boolean = 16,
  Array = 17,
  Object = 18,
  Key = 19,
  Null = 20,
  EnumMember = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export class DocumentSymbol {
  children: DocumentSymbol[] = []
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export class WorkspaceEdit {
  public readonly replacements: { uri: Uri; range: Range; content: string }[] =
    []

  replace(uri: Uri, range: Range, content: string): void {
    this.replacements.push({ uri, range, content })
  }
}

// Task 434 — checkNoopOnWillSave (writeback-controller.ts) returns `vscode.TextEdit[]` for
// `event.waitUntil`; minimal shape matching the real API's `TextEdit.replace` static factory.
export class TextEdit {
  constructor(
    public readonly range: Range,
    public readonly newText: string,
  ) {}

  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText)
  }
}

export class RelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose(): void {
    this.fn?.()
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      items.forEach((i) => {
        i.dispose()
      })
    })
  }
}

export class EventEmitter<T = any> {
  private readonly listeners = new Set<(e: T) => unknown>()

  event = (listener: (e: T) => unknown): Disposable => {
    this.listeners.add(listener)
    return new Disposable(() => this.listeners.delete(listener))
  }

  fire(data: T): void {
    for (const listener of [...this.listeners]) listener(data)
  }

  async fireAsync(data: T): Promise<void> {
    for (const listener of [...this.listeners]) await listener(data)
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  dispose(): void {
    this.listeners.clear()
  }
}

// Classes used purely for `instanceof` discrimination of tab inputs.
export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: unknown,
  ) {}
}

export class MarkdownString {
  value: string
  isTrusted?: boolean
  constructor(value = '') {
    this.value = value
  }
  appendMarkdown(value: string): this {
    this.value += value
    return this
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string
  collapsibleState?: TreeItemCollapsibleState
  command?: unknown
  iconPath?: unknown
  tooltip?: string
  description?: string
  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}

export class TabInputText {
  constructor(public readonly uri: Uri) {}
}
export class TabInputCustom {
  constructor(
    public readonly uri: Uri,
    public readonly viewType: string,
  ) {}
}
export class TabInputTextDiff {
  constructor(
    public readonly original: Uri,
    public readonly modified: Uri,
  ) {}
}

// Task 83 (toolbar toggle): the scopes a setting write can target.
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const

export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const

export const StatusBarAlignment = { Left: 1, Right: 2 } as const

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 } as const

export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const

// ---------------------------------------------------------------------------
// Mutable mock state + control surface
// ---------------------------------------------------------------------------

interface MockTextDocument {
  uri: Uri
  languageId: string
  getText(): string
  save(): Promise<boolean>
  readonly lineCount: number
  lineAt(line: number): { range: Range }
  readonly isDirty: boolean
  // Task 477 (instrumentation) — mirrors real vscode.TextDocument.version: starts at 1,
  // bumps on every text change regardless of who made it (us via applyEdit, or a test
  // simulating an external edit via __setText directly). writeback-controller.ts reads
  // this to discriminate "who changed the document" on a failed applyEdit.
  readonly version: number
  __setText(text: string): void
}

const DEFAULT_CONFIG: Record<string, any> = {
  'image.saveFolder': 'assets',
  'theme.content': 'auto',
  'preview.fontFamily':
    "-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif",
  colorTheme: 'Test Theme',
  'css.custom': '',
  'editor.fullWidth': true,
}

function freshState() {
  return {
    config: { ...DEFAULT_CONFIG } as Record<string, any>,
    // Per-resource overrides keyed by uri.toString() (task 51 #3, scope:"resource").
    // getConfiguration(section, uri) consults this first, then falls back to `config`.
    resourceConfig: {} as Record<string, Record<string, any>>,
    // getConfiguration().inspect(key) results keyed by the bare key (task 83 toolbar toggle).
    configInspect: {} as Record<
      string,
      {
        workspaceFolderValue?: unknown
        workspaceValue?: unknown
        globalValue?: unknown
      }
    >,
    isTrusted: true,
    activeColorThemeKind: ColorThemeKind.Light as number,
    activeColorThemeId: 'Test Theme',
    activeTextEditor: undefined as { document: { uri: Uri } } | undefined,
    activeTabInput: undefined as unknown,
    tabGroups: [] as Array<{
      viewColumn: number
      tabs: Array<{ input: unknown; group: any }>
    }>,
    workspaceFolder: undefined as
      | { uri: Uri; name: string; index: number }
      | undefined,
    documents: [] as MockTextDocument[],
    watchers: [] as MockWatcher[],
    globalState: {} as Record<string, any>,
    readDirectory: async (_uri: Uri): Promise<[string, number][]> => [],
    // fs.stat overrides keyed by fsPath (task 359, onOpenLink directory/missing-target
    // handling). Anything NOT listed here defaults to "file exists" — the pre-359 tests
    // (open-link.test.ts, asset-link-actions.test.ts) all assume the target exists and stay
    // green unmodified; only the new directory/missing-file tests need to register an entry.
    fsEntries: {} as Record<string, 'file' | 'directory' | 'missing'>,
    responses: {
      showQuickPick: undefined as any,
      showWarningMessage: undefined as any,
      gitExtension: undefined as any,
      cursorReply: undefined as { line: number; lineText: string } | undefined,
      executeCommand: undefined as
        | ((command: string, args: any[]) => any)
        | undefined,
    },
    calls: {
      executeCommand: [] as { command: string; args: any[] }[],
      openExternal: [] as Uri[],
      clipboard: [] as string[],
      registeredCommands: new Map<string, (...args: any[]) => any>(),
      showError: [] as string[],
      showInformation: [] as string[],
      showWarning: [] as { message: string; items: string[] }[],
      showQuickPick: [] as any[],
      appliedEdits: [] as WorkspaceEdit[],
      postMessage: [] as any[],
      globalStateUpdates: [] as { key: string; value: any }[],
      configUpdates: [] as {
        key: string
        value: unknown
        target: number | undefined
        scope: string | undefined
      }[],
      fileSystemWatchers: [] as MockWatcher[],
      fsWrites: [] as { uri: Uri; content: Uint8Array }[],
      fsDirsCreated: [] as Uri[],
      customEditor: undefined as
        | { viewType: string; provider: any; options: any }
        | undefined,
      setKeysForSync: [] as string[][],
      statusBarItems: [] as any[],
      shownTextEditors: [] as any[],
      outputChannels: [] as {
        name: string
        options: any
        logs: { level: string; message: string }[]
        disposed: boolean
      }[],
    },
    emitters: {
      didChangeActiveTextEditor: new EventEmitter(),
      didChangeTabs: new EventEmitter(),
      didOpenTextDocument: new EventEmitter(),
      didCloseTextDocument: new EventEmitter(),
      didChangeTextDocument: new EventEmitter(),
      didSaveTextDocument: new EventEmitter(),
      // Task 434 — checkNoopOnWillSave's correctness-backstop listener (editor-session.ts).
      willSaveTextDocument: new EventEmitter(),
      didChangeConfiguration: new EventEmitter(),
      didChangeActiveColorTheme: new EventEmitter(),
      didRenameFiles: new EventEmitter(),
    },
  }
}

let state = freshState()

interface MockWatcher {
  // The pattern the watcher was created with. Recorded because HOW a watcher is constructed is
  // load-bearing: VS Code matches a plain STRING glob against workspace-relative paths, so an
  // absolute path passed as a string silently watches nothing (task 520 shipped exactly that,
  // and every mocked test still passed because nobody asserted this).
  pattern: unknown
  onDidChange: EventEmitter['event']
  onDidCreate: EventEmitter['event']
  onDidDelete: EventEmitter['event']
  dispose: ReturnType<typeof vi.fn>
  disposed: boolean
  fireChange(): void
  fireCreate(): void
  _fireCreate(uri: Uri): void
  _fireDelete(uri: Uri): void
}

// ---------------------------------------------------------------------------
// vscode namespaces
// ---------------------------------------------------------------------------

export const window = {
  registerTreeDataProvider: vi.fn(
    (_id: string, _provider: unknown) => new Disposable(),
  ),
  get activeTextEditor() {
    return state.activeTextEditor
  },
  get activeColorTheme() {
    return { id: state.activeColorThemeId, kind: state.activeColorThemeKind }
  },
  get tabGroups() {
    return {
      all: state.tabGroups,
      activeTabGroup: {
        get activeTab() {
          return state.activeTabInput
            ? { input: state.activeTabInput }
            : undefined
        },
      },
      onDidChangeTabs: state.emitters.didChangeTabs.event,
    }
  },
  showErrorMessage: vi.fn((message: string) => {
    state.calls.showError.push(message)
    return Promise.resolve(undefined)
  }),
  showInformationMessage: vi.fn((message: string) => {
    state.calls.showInformation.push(message)
    return Promise.resolve(undefined)
  }),
  showWarningMessage: vi.fn((message: string, ...items: string[]) => {
    state.calls.showWarning.push({ message, items })
    return Promise.resolve(state.responses.showWarningMessage)
  }),
  showQuickPick: vi.fn((items: any) => {
    state.calls.showQuickPick.push(items)
    return Promise.resolve(state.responses.showQuickPick)
  }),
  registerCustomEditorProvider: vi.fn(
    (viewType: string, provider: any, options: any) => {
      state.calls.customEditor = { viewType, provider, options }
      return new Disposable()
    },
  ),
  createOutputChannel: vi.fn((name: string, options?: any) => {
    const record = { name, options, logs: [], disposed: false } as {
      name: string
      options: any
      logs: { level: string; message: string }[]
      disposed: boolean
    }
    state.calls.outputChannels.push(record)
    const log = (level: string) => (message: string) =>
      record.logs.push({ level, message })
    return {
      name,
      trace: vi.fn(log('trace')),
      debug: vi.fn(log('debug')),
      info: vi.fn(log('info')),
      warn: vi.fn(log('warn')),
      error: vi.fn(log('error')),
      appendLine: vi.fn(log('append')),
      show: vi.fn(),
      dispose: vi.fn(() => {
        record.disposed = true
      }),
    }
  }),
  createStatusBarItem: vi.fn((alignment?: number, priority?: number) => {
    const item: any = {
      alignment,
      priority,
      text: '',
      tooltip: '',
      command: undefined as string | undefined,
      name: '',
      visible: false,
      show: vi.fn(() => {
        item.visible = true
      }),
      hide: vi.fn(() => {
        item.visible = false
      }),
      dispose: vi.fn(),
    }
    state.calls.statusBarItems.push(item)
    return item
  }),
  showTextDocument: vi.fn(async (uriOrDoc: any, options?: any) => {
    const editor = {
      document: uriOrDoc,
      options,
      selection: undefined as unknown,
      revealRange: vi.fn(),
    }
    state.calls.shownTextEditors.push(editor)
    return editor
  }),
  onDidChangeActiveTextEditor: (l: any) =>
    state.emitters.didChangeActiveTextEditor.event(l),
  onDidChangeActiveColorTheme: (l: any) =>
    state.emitters.didChangeActiveColorTheme.event(l),
}

export const workspace = {
  get isTrusted() {
    return state.isTrusted
  },
  get textDocuments() {
    return state.documents
  },
  getConfiguration: vi.fn((_section?: string, scope?: Uri) => {
    const overrides = scope ? state.resourceConfig[scope.toString()] : undefined
    return {
      get: <T>(key: string, defaultValue?: T): T => {
        if (overrides && key in overrides) return overrides[key] as T
        return (key in state.config ? state.config[key] : defaultValue) as T
      },
      inspect: (key: string) => state.configInspect[key],
      update: async (key: string, value: unknown, target?: number) => {
        state.calls.configUpdates.push({
          key,
          value,
          target,
          scope: scope?.toString(),
        })
      },
    }
  }),
  getWorkspaceFolder: vi.fn((_uri: Uri) => state.workspaceFolder),
  // Task 229 (onOpenCodeRef) — first caller needing this. Mirrors fs.stat's
  // fsEntries-keyed missing/exists behaviour; reuses an already-`setDocument`-registered
  // MockTextDocument for the same path when there is one, else creates a fresh empty one
  // (real openTextDocument reads from disk regardless of what's already open).
  openTextDocument: vi.fn(async (uri: Uri) => {
    const entry = state.fsEntries[uri.fsPath] ?? 'file'
    if (entry === 'missing') {
      throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' })
    }
    return (
      state.documents.find((d) => d.uri.fsPath === uri.fsPath) ??
      createTextDocument(uri.fsPath)
    )
  }),
  asRelativePath: vi.fn((uri: Uri | string) =>
    typeof uri === 'string' ? uri : uri.fsPath,
  ),
  applyEdit: vi.fn(async (edit: WorkspaceEdit) => {
    state.calls.appliedEdits.push(edit)
    for (const r of edit.replacements) {
      const doc = state.documents.find(
        (d) => d.uri.toString() === r.uri.toString(),
      )
      doc?.__setText(r.content)
    }
    return true
  }),
  createFileSystemWatcher: vi.fn((pattern: unknown): MockWatcher => {
    const change = new EventEmitter()
    const create = new EventEmitter()
    const del = new EventEmitter()
    const watcher: MockWatcher = {
      pattern,
      onDidChange: change.event,
      onDidCreate: create.event,
      onDidDelete: del.event,
      dispose: vi.fn(() => {
        watcher.disposed = true
      }),
      disposed: false,
      fireChange: () => change.fire(undefined),
      fireCreate: () => create.fire(undefined),
      _fireCreate: (uri: Uri) => create.fire(uri),
      _fireDelete: (uri: Uri) => del.fire(uri),
    }
    state.watchers.push(watcher)
    state.calls.fileSystemWatchers.push(watcher)
    return watcher
  }),
  onDidOpenTextDocument: (l: any) =>
    state.emitters.didOpenTextDocument.event(l),
  onDidCloseTextDocument: (l: any) =>
    state.emitters.didCloseTextDocument.event(l),
  onDidChangeTextDocument: (l: any) =>
    state.emitters.didChangeTextDocument.event(l),
  onDidSaveTextDocument: (l: any) =>
    state.emitters.didSaveTextDocument.event(l),
  onWillSaveTextDocument: (l: any) =>
    state.emitters.willSaveTextDocument.event(l),
  onDidChangeConfiguration: (l: any) =>
    state.emitters.didChangeConfiguration.event(l),
  onDidRenameFiles: (l: any) => state.emitters.didRenameFiles.event(l),
  fs: {
    createDirectory: vi.fn(async (uri: Uri) => {
      state.calls.fsDirsCreated.push(uri)
    }),
    writeFile: vi.fn(async (uri: Uri, content: Uint8Array) => {
      state.calls.fsWrites.push({ uri, content })
    }),
    readDirectory: vi.fn((uri: Uri) => state.readDirectory(uri)),
    stat: vi.fn(async (uri: Uri) => {
      const entry = state.fsEntries[uri.fsPath] ?? 'file'
      if (entry === 'missing') {
        throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' })
      }
      return {
        type: entry === 'directory' ? FileType.Directory : FileType.File,
        ctime: 0,
        mtime: 0,
        size: 0,
      }
    }),
  },
}

// Minimal extensions namespace. Defaults to "no git" so the gutter diff
// scheduler (task 17) self-disables in tests; a test can override via
// state.responses.gitExtension.
export const extensions = {
  getExtension: vi.fn((id: string) =>
    id === 'vscode.git' ? state.responses.gitExtension : undefined,
  ),
}

export const env = {
  language: 'en',
  openExternal: vi.fn(async (uri: Uri) => {
    state.calls.openExternal.push(uri)
    return true
  }),
  clipboard: {
    writeText: vi.fn(async (text: string) => {
      state.calls.clipboard.push(text)
    }),
  },
}

export const languages = {
  registerDocumentSymbolProvider: vi.fn(
    (_selector: unknown, _provider: unknown) => new Disposable(),
  ),
}

export const commands = {
  registerCommand: vi.fn(
    (command: string, handler: (...args: any[]) => any) => {
      state.calls.registeredCommands.set(command, handler)
      return new Disposable()
    },
  ),
  executeCommand: vi.fn(async (command: string, ...args: any[]) => {
    state.calls.executeCommand.push({ command, args })
    if (command === 'setContext') return undefined
    return state.responses.executeCommand?.(command, args)
  }),
}

// ---------------------------------------------------------------------------
// Test factories + control surface (`mock`)
// ---------------------------------------------------------------------------

function createTextDocument(fsPath: string, text = ''): MockTextDocument {
  let current = text
  let saved = text
  let version = 1 // task 477 — matches real vscode.TextDocument.version's initial value
  const uri = Uri.file(fsPath)
  const doc: MockTextDocument = {
    uri,
    languageId: 'markdown',
    getText: () => current,
    save: vi.fn(async () => {
      saved = current
      return true
    }) as unknown as () => Promise<boolean>,
    get lineCount() {
      return current.split('\n').length
    },
    lineAt(line: number) {
      const lines = current.split('\n')
      const text = lines[line] ?? ''
      return { text, range: new Range(line, 0, line, text.length) }
    },
    get isDirty() {
      return current !== saved
    },
    get version() {
      return version
    },
    __setText(value: string) {
      current = value
      version += 1
    },
  }
  state.documents.push(doc)
  return doc
}

function createWebviewPanel() {
  const messages = new EventEmitter()
  const dispose = new EventEmitter()
  // Task 420 — record the ORDER of ('listener-attached' | 'html-assigned') so a unit test can pin
  // the invariant `src/editor-session.ts` documents in comments but nothing enforced: the message
  // listener must attach BEFORE webview.html is set, or the webview's early `ready` message (fired
  // as soon as html loads main.js) is dropped silently. `webview.html` is turned into an accessor
  // (was a plain string field) purely to observe the assignment; reads still behave like a string.
  const eventOrder: string[] = []
  let htmlValue = ''
  const webview: any = {
    options: undefined as unknown,
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: Uri) => ({
      toString: () => `https://file.vscode-resource.vscode-cdn.net${uri.path}`,
    }),
    postMessage: vi.fn((message: any) => {
      state.calls.postMessage.push(message)
      // Auto-reply to the reveal round-trip when a cursor reply is configured,
      // so tests can drive get-cursor-offset → cursor-offset end to end.
      if (
        message?.command === 'get-cursor-offset' &&
        state.responses.cursorReply
      ) {
        messages.fire({
          command: 'cursor-offset',
          // echo the correlation id like the real webview (185/3a)
          requestId: message.requestId,
          ...state.responses.cursorReply,
        })
      }
      return Promise.resolve(true)
    }),
    onDidReceiveMessage: (l: any) => {
      eventOrder.push('listener-attached')
      return messages.event(l)
    },
  }
  Object.defineProperty(webview, 'html', {
    enumerable: true,
    get: () => htmlValue,
    set: (value: string) => {
      eventOrder.push('html-assigned')
      htmlValue = value
    },
  })
  const panel = {
    title: '',
    active: true,
    visible: true,
    webview,
    onDidDispose: (l: any) => dispose.event(l),
    onDidChangeViewState: (_l: any) => new Disposable(),
    dispose: vi.fn(() => dispose.fire(undefined)),
    // test helpers
    _receiveMessage: (message: any) => messages.fireAsync(message),
    _fireDispose: () => dispose.fire(undefined),
    // task 420 — the recorded ('listener-attached' | 'html-assigned') sequence
    _eventOrder: eventOrder,
  }
  return panel
}

function createExtensionContext() {
  return {
    extensionUri: Uri.file('/ext'),
    subscriptions: [] as { dispose(): void }[],
    globalState: {
      get: (key: string) => state.globalState[key],
      update: vi.fn(async (key: string, value: any) => {
        state.globalState[key] = value
        state.calls.globalStateUpdates.push({ key, value })
      }),
      setKeysForSync: vi.fn((keys: string[]) => {
        state.calls.setKeysForSync.push(keys)
      }),
    },
  }
}

export const mock = {
  reset() {
    state = freshState()
  },
  get state() {
    return state
  },
  get calls() {
    return state.calls
  },
  setConfig(values: Record<string, any>) {
    Object.assign(state.config, values)
  },
  // Resource-scoped override for a specific document uri (task 51 #3). A read via
  // getConfiguration('vmarkd', uri) sees these in preference to the global config.
  setResourceConfig(uri: Uri | string, values: Record<string, any>) {
    const key = typeof uri === 'string' ? uri : uri.toString()
    state.resourceConfig[key] = { ...state.resourceConfig[key], ...values }
  },
  // What getConfiguration('vmarkd').inspect(key) reports (which scopes define the value).
  setConfigInspect(
    key: string,
    values: {
      workspaceFolderValue?: unknown
      workspaceValue?: unknown
      globalValue?: unknown
    },
  ) {
    state.configInspect[key] = values
  },
  setThemeKind(kind: number) {
    state.activeColorThemeKind = kind
  },
  setThemeId(id: string) {
    state.activeColorThemeId = id
    state.config.colorTheme = id
  },
  setWorkspaceFolder(fsPath: string) {
    state.workspaceFolder = {
      uri: Uri.file(fsPath),
      name: NodePath.basename(fsPath),
      index: 0,
    }
  },
  setActiveTextEditor(uri: Uri | undefined) {
    state.activeTextEditor = uri ? { document: { uri } } : undefined
  },
  // Register an open text document so workspace.textDocuments.find() sees it.
  // createTextDocument already pushes into state.documents.
  setDocument(fsPath: string, text = ''): MockTextDocument {
    return createTextDocument(fsPath, text)
  },
  setActiveTab(input: unknown) {
    state.activeTabInput = input
  },
  // Build tab groups for findTabForUri (task 36). Each entry → one group with a
  // viewColumn and its tab inputs; tabs get a back-ref to their group so
  // `tab.group.viewColumn` works like the real API.
  setTabGroups(groups: Array<{ viewColumn: number; inputs: unknown[] }>) {
    state.tabGroups = groups.map((g) => {
      const group: any = { viewColumn: g.viewColumn, tabs: [] as any[] }
      group.tabs = g.inputs.map((input) => ({ input, group }))
      return group
    })
  },
  setTrusted(value: boolean) {
    state.isTrusted = value
  },
  setReadDirectory(fn: (uri: Uri) => Promise<[string, number][]>) {
    state.readDirectory = fn
  },
  // Registers a directory/missing fs.stat outcome for a specific fsPath (task 359). Anything
  // not registered defaults to "file" — see freshState()'s fsEntries comment.
  setFsEntry(fsPath: string, kind: 'file' | 'directory' | 'missing') {
    state.fsEntries[fsPath] = kind
  },
  setQuickPickResponse(value: any) {
    state.responses.showQuickPick = value
  },
  setWarningResponse(value: any) {
    state.responses.showWarningMessage = value
  },
  setExecuteCommandResponse(fn: (command: string, args: any[]) => any) {
    state.responses.executeCommand = fn
  },
  // Make every panel webview auto-reply to get-cursor-offset with this payload,
  // so reveal-in-source round-trips resolve in tests (task 16).
  setCursorReply(reply: { line: number; lineText: string }) {
    state.responses.cursorReply = reply
  },
  fireDidChangeTextDocument(
    document: MockTextDocument,
    extra: Record<string, any> = {},
  ) {
    return state.emitters.didChangeTextDocument.fire({ document, ...extra })
  },
  fireDidSaveTextDocument(document: MockTextDocument) {
    return state.emitters.didSaveTextDocument.fire(document)
  },
  // Task 434 — fires onWillSaveTextDocument and captures whatever the listener passes to
  // `event.waitUntil` (real VS Code applies those edits atomically with the save; here the test
  // just awaits `.edits` to see what checkNoopOnWillSave decided).
  fireWillSaveTextDocument(document: MockTextDocument) {
    const captured: { edits?: Thenable<unknown> } = {}
    state.emitters.willSaveTextDocument.fire({
      document,
      waitUntil: (thenable: Thenable<unknown>) => {
        captured.edits = thenable
      },
    })
    return captured
  },
  fireDidCloseTextDocument(document: MockTextDocument) {
    return state.emitters.didCloseTextDocument.fire(document)
  },
  fireDidChangeActiveColorTheme() {
    return state.emitters.didChangeActiveColorTheme.fire({
      id: state.activeColorThemeId,
      kind: state.activeColorThemeKind,
    })
  },
  fireDidRenameFiles(oldUri: Uri, newUri: Uri) {
    return state.emitters.didRenameFiles.fire({
      files: [{ oldUri, newUri }],
    })
  },
  fireDidChangeConfiguration(section = 'vmarkd') {
    return state.emitters.didChangeConfiguration.fire({
      affectsConfiguration: (s: string) =>
        s === section || s.startsWith(`${section}.`),
    })
  },
  fireDidChangeTabs() {
    return state.emitters.didChangeTabs.fire(undefined)
  },
  createTextDocument,
  createWebviewPanel,
  createExtensionContext,
}
