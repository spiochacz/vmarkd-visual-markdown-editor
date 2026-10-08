// Task 532 §D — the configuration matrix of the parity gate. A configuration is a bundle of VS Code
// settings; the gate captures every stage under it and compares the stages with each other (never
// across configurations). The chromium harness runs all of them; the real-VS-Code spec runs the
// `fast` one in the routine tier and all of them in the full tier.

import {
  CONTENT_THEMES,
  resolveAutoContentTheme,
  resolveContentTheme,
  themeDef,
} from '../../src/shared/theme-registry'

export interface ParityConfig {
  /** Stable id; also the `theme` key of an allow-list entry. */
  id: string
  /** The routine-tier configuration (1 boot): the user's — `auto` under the default Dark Modern. */
  fast?: boolean
  /** Fully-qualified VS Code settings written (pinned) before the open. */
  settings: Readonly<Record<string, unknown>>
}

// Everything a configuration does not vary is pinned the same way, so a leaked setting from an
// earlier spec (the suite shares one profile — vmarkd-testing skill) cannot move a measurement.
const BASE_SETTINGS = {
  'vmarkd.editor.fullWidth': true,
  'vmarkd.editor.headingMarkers': false,
  'vmarkd.editor.reflowLineBreaks': false,
  'vmarkd.editor.defaultMode': 'ir',
  'vmarkd.editor.fontSize': 'editor',
  'vmarkd.theme.code': 'auto',
} as const

const DARK_MODERN = 'Default Dark Modern'

const named = (value: string): ParityConfig =>
  value === 'vscode-dark-2026'
    ? {
        // `auto` under Default Dark Modern RESOLVES to vscode-dark-2026 (resolveAutoContentTheme), so
        // this spelling IS that theme's row — and it is exactly the out-of-box / user configuration.
        id: value,
        fast: true,
        settings: {
          ...BASE_SETTINGS,
          'vmarkd.theme.content': 'auto',
          'workbench.colorTheme': DARK_MODERN,
        },
      }
    : {
        id: value,
        settings: {
          ...BASE_SETTINGS,
          'vmarkd.theme.content': value,
          'workbench.colorTheme': DARK_MODERN,
        },
      }

const DARK_2026 = (extra: Record<string, unknown>) => ({
  ...BASE_SETTINGS,
  'vmarkd.theme.content': 'auto',
  'workbench.colorTheme': DARK_MODERN,
  ...extra,
})

export const PARITY_CONFIGS: readonly ParityConfig[] = [
  // One row per registered content theme — a new CONTENT_THEMES row is in the matrix automatically.
  ...CONTENT_THEMES.map((t) => named(t.value)),
  // No content theme at all: Vditor's own / default profile.
  {
    id: 'auto-monokai',
    settings: {
      ...BASE_SETTINGS,
      'vmarkd.theme.content': 'auto',
      'workbench.colorTheme': 'Monokai',
    },
  },
  // The VS Code-variables path with high-contrast colours.
  {
    id: 'auto-high-contrast',
    settings: {
      ...BASE_SETTINGS,
      'vmarkd.theme.content': 'auto',
      'workbench.colorTheme': 'Default High Contrast',
    },
  },
  // Three variants on the user's theme: the marker glyph (reflow), the narrow column (the second
  // gutter expression), and heading markers + an explicit code theme (code-box geometry).
  {
    id: 'vscode-dark-2026+reflow',
    settings: DARK_2026({ 'vmarkd.editor.reflowLineBreaks': true }),
  },
  {
    id: 'vscode-dark-2026+narrow',
    settings: DARK_2026({ 'vmarkd.editor.fullWidth': false }),
  },
  {
    id: 'vscode-dark-2026+markers+monokai-code',
    settings: DARK_2026({
      'vmarkd.editor.headingMarkers': true,
      'vmarkd.theme.code': 'monokai',
    }),
  },
]

/** What the host's `effectiveContentTheme` / `effectiveThemeKind` resolve a configuration to. */
export interface ResolvedParityConfig {
  contentTheme: string
  themeKind: 'dark' | 'light'
  codeTheme: string
  fullWidth: boolean
  headingMarkers: boolean
  reflow: boolean
}

const LIGHT_WORKBENCH = /light/i

export function resolveParityConfig(c: ParityConfig): ResolvedParityConfig {
  const s = c.settings
  const workbench = String(s['workbench.colorTheme'] ?? '')
  const workbenchKind: 'dark' | 'light' = LIGHT_WORKBENCH.test(workbench)
    ? 'light'
    : 'dark'
  const configured = resolveContentTheme(String(s['vmarkd.theme.content']))
  const contentTheme =
    configured !== 'auto'
      ? configured
      : resolveAutoContentTheme(workbench, workbenchKind)
  return {
    contentTheme,
    themeKind: themeDef(contentTheme)?.mode ?? workbenchKind,
    codeTheme: String(s['vmarkd.theme.code']),
    fullWidth: s['vmarkd.editor.fullWidth'] === true,
    headingMarkers: s['vmarkd.editor.headingMarkers'] === true,
    reflow: s['vmarkd.editor.reflowLineBreaks'] === true,
  }
}
