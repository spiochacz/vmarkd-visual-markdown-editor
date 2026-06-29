// Single source of truth for the host↔webview message contract (task 151).
//
// WHY this lives in `src/` (the host tree) and not `media-src/`: both seams must
// import the SAME types or the union silently drifts from the wire (the bug this
// task fixes — `config-changed.theme` / `wiki-update.displayNames` had drifted out).
// The host imports it directly (`./protocol`); the webview reaches across the tree
// (`../../src/protocol`) — the exact pattern already used for `mermaid-palettes` /
// `echarts-theme`. Typing BOTH directions here makes a command/field rename a
// COMPILE error on both sides instead of a runtime no-op.

export type ThemeKind = 'dark' | 'light'

// The config payload the host computes (`collectConfigOptions`) and the webview
// reads (`vditor-options` / `live-config`). Every field mirrors a `vmarkd.*`
// setting; all optional because `WorkspaceConfiguration.get<T>()` returns
// `T | undefined`. `outlineWidth` is transient (drag-resize, not a setting).
export interface VmarkdConfigOptions {
  contentTheme?: string
  useVscodeThemeColor?: boolean
  enableFullWidth?: boolean
  codeBlockLineNumbers?: boolean
  mermaidTheme?: string
  echartsTheme?: string
  d2Layout?: string
  d2Theme?: string
  geoBasemap?: string
  showToolbar?: boolean
  highlightHeadings?: boolean
  showHeadingMarkers?: boolean
  fontSize?: string
  outlinePosition?: string
  showOutlineByDefault?: boolean
  outlineHighlight?: boolean
  codeTheme?: string
  streamLargeFiles?: boolean
  contentVisibility?: boolean
  linkOpenWithModifier?: boolean
  imageFormat?: string
  imageQuality?: number
  imageMaxWidth?: number
  allowRemoteImages?: boolean
  wikiEnabled?: boolean
  // Transient (drag-resized outline width, not from collectConfigOptions).
  outlineWidth?: number
}

// The persisted Vditor preview blob (`saveVditorOptions`) spread into the init
// payload's `options` on top of the config. Kept loose — its `preview` shape is
// Vditor-owned and only re-merged authoritatively in vditor-options.ts.
export interface SavedVditorOptions {
  theme?: string
  mode?: string
  preview?: unknown
}

// Wiki context carried on the init `update` message and refreshed by `wiki-update`.
export interface WikiInit {
  enabled: boolean
  pageKeys?: string[]
  displayNames?: string[]
}

// One uploaded image: base64 bytes + the (timestamped, sanitised) target name.
export interface UploadFile {
  base64: string
  name: string
}

// ── Host → webview ──────────────────────────────────────────────────────────
export type HostMessage =
  | {
      command: 'update'
      content: string
      type?: 'init' | 'update'
      cdn?: string
      // The init payload spreads the saved Vditor blob over the config, so it is
      // wider than VmarkdConfigOptions alone.
      options?: VmarkdConfigOptions & SavedVditorOptions
      theme?: ThemeKind
      wiki?: WikiInit
    }
  | { command: 'set-theme'; theme: ThemeKind }
  // `theme` rides along when a content-theme switch flips the effective light/dark
  // mode (task 82) — was missing from the union though the host sends it and the
  // webview reads it (the drift this task closes).
  | {
      command: 'config-changed'
      options: VmarkdConfigOptions
      theme?: ThemeKind
    }
  | { command: 'reload-css'; id: string; css: string }
  | { command: 'get-cursor-offset' }
  | { command: 'diff-info'; changes: unknown[] }
  | { command: 'uploaded'; files: string[] }
  | { command: 'scroll-to-heading'; index: number }
  // `displayNames` was likewise sent + read but absent from the type.
  | { command: 'wiki-update'; pageKeys: string[]; displayNames?: string[] }

// ── Webview → host ──────────────────────────────────────────────────────────
export type WebviewMessage =
  | { command: 'ready' }
  | { command: 'edit'; content: string }
  | { command: 'save'; content: string }
  | { command: 'save-options'; options: SavedVditorOptions }
  | { command: 'save-outline-width'; width: number }
  | {
      command: 'docMode'
      blocks: number
      chars: number
      contentVisibility: boolean
      streaming: boolean
      incremental: boolean
    }
  | { command: 'cursor-offset'; line: number; lineText: string }
  | { command: 'upload'; files: UploadFile[] }
  | { command: 'open-link'; href: string }
  | { command: 'open-wikilink'; target: string }
  | { command: 'list-wiki-pages' }
  | { command: 'edit-in-vscode' }
  | { command: 'navigate-back' }
  | { command: 'open-settings' }
  // Observability pipe — host-side handlers exist; webview emitters are wired in
  // this task (item 3) to replace the console.* fallback.
  | { command: 'log'; text: string }
  | { command: 'info'; content: string }
  | { command: 'error'; content: string }
  // Host side of the planned Copy-as HTML/Markdown feature (task 53). Handlers are
  // wired (onCopyToClipboard); the webview emitter lands with that task. Declared
  // here so the protocol is complete and the typed dispatch map stays valid.
  | { command: 'copy-html'; content: string }
  | { command: 'copy-markdown'; content: string }

// The `acquireVsCodeApi()` handle, typed so every `vscode.postMessage` is checked
// against the WebviewMessage union (a bad command/field is now a compile error).
export interface VsCodeApi {
  postMessage(message: WebviewMessage): void
  getState<T = unknown>(): T | undefined
  setState<T>(state: T): T
}
