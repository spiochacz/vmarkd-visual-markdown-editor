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
    public readonly fragment: string
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
      ''
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
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position
  public readonly end: Position

  constructor(
    startLineOrPos: number | Position,
    startCharOrPos: number | Position,
    endLine?: number,
    endChar?: number
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

export class WorkspaceEdit {
  public readonly replacements: { uri: Uri; range: Range; content: string }[] = []

  replace(uri: Uri, range: Range, content: string): void {
    this.replacements.push({ uri, range, content })
  }
}

export class RelativePattern {
  constructor(public readonly base: unknown, public readonly pattern: string) {}
}

export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose(): void {
    this.fn?.()
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => items.forEach((i) => i.dispose()))
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
export class TabInputText {
  constructor(public readonly uri: Uri) {}
}
export class TabInputCustom {
  constructor(public readonly uri: Uri, public readonly viewType: string) {}
}
export class TabInputTextDiff {
  constructor(public readonly original: Uri, public readonly modified: Uri) {}
}

export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 } as const

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
  __setText(text: string): void
}

const DEFAULT_CONFIG: Record<string, any> = {
  imageSaveFolder: 'assets',
  useVscodeThemeColor: true,
  customCss: '',
  enableFullWidth: true,
}

function freshState() {
  return {
    config: { ...DEFAULT_CONFIG } as Record<string, any>,
    activeColorThemeKind: ColorThemeKind.Light as number,
    activeTextEditor: undefined as { document: { uri: Uri } } | undefined,
    activeTabInput: undefined as unknown,
    workspaceFolder: undefined as { uri: Uri; name: string; index: number } | undefined,
    documents: [] as MockTextDocument[],
    watchers: [] as MockWatcher[],
    globalState: {} as Record<string, any>,
    readDirectory: async (_uri: Uri): Promise<[string, number][]> => [],
    responses: {
      showQuickPick: undefined as any,
      showWarningMessage: undefined as any,
      executeCommand: undefined as ((command: string, args: any[]) => any) | undefined,
    },
    calls: {
      executeCommand: [] as { command: string; args: any[] }[],
      registeredCommands: new Map<string, (...args: any[]) => any>(),
      showError: [] as string[],
      showInformation: [] as string[],
      showWarning: [] as { message: string; items: string[] }[],
      showQuickPick: [] as any[],
      appliedEdits: [] as WorkspaceEdit[],
      postMessage: [] as any[],
      globalStateUpdates: [] as { key: string; value: any }[],
      fsWrites: [] as { uri: Uri; content: Uint8Array }[],
      fsDirsCreated: [] as Uri[],
      customEditor: undefined as
        | { viewType: string; provider: any; options: any }
        | undefined,
      setKeysForSync: [] as string[][],
    },
    emitters: {
      didChangeActiveTextEditor: new EventEmitter(),
      didChangeTabs: new EventEmitter(),
      didOpenTextDocument: new EventEmitter(),
      didCloseTextDocument: new EventEmitter(),
      didChangeTextDocument: new EventEmitter(),
      didSaveTextDocument: new EventEmitter(),
      didChangeConfiguration: new EventEmitter(),
      didChangeActiveColorTheme: new EventEmitter(),
    },
  }
}

let state = freshState()

interface MockWatcher {
  onDidChange: EventEmitter['event']
  onDidCreate: EventEmitter['event']
  onDidDelete: EventEmitter['event']
  dispose: ReturnType<typeof vi.fn>
  disposed: boolean
  fireChange(): void
  fireCreate(): void
}

// ---------------------------------------------------------------------------
// vscode namespaces
// ---------------------------------------------------------------------------

export const window = {
  get activeTextEditor() {
    return state.activeTextEditor
  },
  get activeColorTheme() {
    return { kind: state.activeColorThemeKind }
  },
  get tabGroups() {
    return {
      activeTabGroup: { get activeTab() {
        return state.activeTabInput ? { input: state.activeTabInput } : undefined
      } },
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
    }
  ),
  onDidChangeActiveTextEditor: (l: any) =>
    state.emitters.didChangeActiveTextEditor.event(l),
}

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T =>
      (key in state.config ? state.config[key] : defaultValue) as T,
  })),
  getWorkspaceFolder: vi.fn((_uri: Uri) => state.workspaceFolder),
  asRelativePath: vi.fn((uri: Uri | string) =>
    typeof uri === 'string' ? uri : uri.fsPath
  ),
  applyEdit: vi.fn(async (edit: WorkspaceEdit) => {
    state.calls.appliedEdits.push(edit)
    for (const r of edit.replacements) {
      const doc = state.documents.find(
        (d) => d.uri.toString() === r.uri.toString()
      )
      doc?.__setText(r.content)
    }
    return true
  }),
  createFileSystemWatcher: vi.fn((_pattern: unknown): MockWatcher => {
    const change = new EventEmitter()
    const create = new EventEmitter()
    const del = new EventEmitter()
    const watcher: MockWatcher = {
      onDidChange: change.event,
      onDidCreate: create.event,
      onDidDelete: del.event,
      dispose: vi.fn(() => {
        watcher.disposed = true
      }),
      disposed: false,
      fireChange: () => change.fire(undefined),
      fireCreate: () => create.fire(undefined),
    }
    state.watchers.push(watcher)
    return watcher
  }),
  onDidOpenTextDocument: (l: any) => state.emitters.didOpenTextDocument.event(l),
  onDidCloseTextDocument: (l: any) => state.emitters.didCloseTextDocument.event(l),
  onDidChangeTextDocument: (l: any) => state.emitters.didChangeTextDocument.event(l),
  onDidSaveTextDocument: (l: any) => state.emitters.didSaveTextDocument.event(l),
  onDidChangeConfiguration: (l: any) => state.emitters.didChangeConfiguration.event(l),
  fs: {
    createDirectory: vi.fn(async (uri: Uri) => {
      state.calls.fsDirsCreated.push(uri)
    }),
    writeFile: vi.fn(async (uri: Uri, content: Uint8Array) => {
      state.calls.fsWrites.push({ uri, content })
    }),
    readDirectory: vi.fn((uri: Uri) => state.readDirectory(uri)),
  },
}

export const commands = {
  registerCommand: vi.fn((command: string, handler: (...args: any[]) => any) => {
    state.calls.registeredCommands.set(command, handler)
    return new Disposable()
  }),
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
      const value = lines[line] ?? ''
      return { range: new Range(line, 0, line, value.length) }
    },
    get isDirty() {
      return current !== saved
    },
    __setText(value: string) {
      current = value
    },
  }
  state.documents.push(doc)
  return doc
}

function createWebviewPanel() {
  const messages = new EventEmitter()
  const dispose = new EventEmitter()
  const panel = {
    title: '',
    active: true,
    visible: true,
    webview: {
      options: undefined as unknown,
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: Uri) => ({
        toString: () => `https://file.vscode-resource.vscode-cdn.net${uri.path}`,
      }),
      postMessage: vi.fn((message: any) => {
        state.calls.postMessage.push(message)
        return Promise.resolve(true)
      }),
      onDidReceiveMessage: (l: any) => messages.event(l),
    },
    onDidDispose: (l: any) => dispose.event(l),
    onDidChangeViewState: (_l: any) => new Disposable(),
    dispose: vi.fn(() => dispose.fire(undefined)),
    // test helpers
    _receiveMessage: (message: any) => messages.fireAsync(message),
    _fireDispose: () => dispose.fire(undefined),
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
  setThemeKind(kind: number) {
    state.activeColorThemeKind = kind
  },
  setWorkspaceFolder(fsPath: string) {
    state.workspaceFolder = { uri: Uri.file(fsPath), name: NodePath.basename(fsPath), index: 0 }
  },
  setActiveTextEditor(uri: Uri | undefined) {
    state.activeTextEditor = uri ? { document: { uri } } : undefined
  },
  setActiveTab(input: unknown) {
    state.activeTabInput = input
  },
  setReadDirectory(fn: (uri: Uri) => Promise<[string, number][]>) {
    state.readDirectory = fn
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
  fireDidChangeTextDocument(document: MockTextDocument, extra: Record<string, any> = {}) {
    return state.emitters.didChangeTextDocument.fire({ document, ...extra })
  },
  fireDidSaveTextDocument(document: MockTextDocument) {
    return state.emitters.didSaveTextDocument.fire(document)
  },
  fireDidCloseTextDocument(document: MockTextDocument) {
    return state.emitters.didCloseTextDocument.fire(document)
  },
  createTextDocument,
  createWebviewPanel,
  createExtensionContext,
}
