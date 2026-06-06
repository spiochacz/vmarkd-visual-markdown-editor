export type ThemeKind = 'dark' | 'light'

export type HostMessage =
  | {
      command: 'update'
      content: string
      type?: 'init' | 'update'
      cdn?: string
      options?: Record<string, unknown>
      theme?: ThemeKind
      wiki?: { enabled: boolean; pageKeys?: string[] }
    }
  | { command: 'set-theme'; theme: ThemeKind }
  | { command: 'config-changed'; options: Record<string, unknown> }
  | { command: 'reload-css'; id: string; css: string }
  | { command: 'get-cursor-offset' }
  | { command: 'diff-info'; changes: unknown[] }
  | { command: 'uploaded'; files: string[] }
  | { command: 'scroll-to-heading'; index: number }
  | { command: 'wiki-update'; pageKeys: string[] }
