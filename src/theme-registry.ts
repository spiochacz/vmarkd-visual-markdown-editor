// Single source of truth for the content (markdown-rendering) themes — task 84.
//
// Theme knowledge used to be scattered across ~6 sites (the manifest enum,
// CONTENT_THEME_FILES, effectiveThemeKind, codeHljsStyle, two font-size resolvers,
// bodyClass), each an if/else ladder keyed on the theme string. Adding a theme meant
// editing all of them, and they drifted. This module holds the table; every site
// derives from it (OCP: add a row, not an `if`).
//
// Intentionally dependency-free and isomorphic so BOTH build units can import it:
// the host (`src/`, tsc/CommonJS) directly, and the webview (`media-src/`,
// esbuild/ESM) via `../../src/theme-registry` — esbuild bundles it inline, which is
// why the two font-size resolvers can finally collapse into one (DRY).

export interface ThemeDef {
  /** The `vmarkd.theme.content` enum value. */
  value: string
  /** Stylesheet path (host side, fed to toUri) → the `ct-<value>` <link>. */
  file: string
  /** Effective editor light/dark mode the theme pins (effectiveThemeKind). */
  mode: 'dark' | 'light'
  /** highlight.js style paired with this theme for an `auto` code theme. */
  code: string
  /**
   * Default reading font-size (px) when the `fontSize` setting is unset/"editor".
   * null → follow the VS Code editor font size (the default for VS Code-flavoured
   * themes). GitHub themes read at GitHub's own 16px.
   */
  fontDefaultPx: number | null
  /**
   * Diagram palette id (see `mermaid-palettes.ts`) auto-paired with this content theme —
   * the SHARED layer-1 mapping reused by every diagram renderer (mermaid, task 86; echarts,
   * task 90). Each engine has its own translation of the palette DATA into its theme format.
   * undefined → no pairing (the engine falls back to its own light/dark).
   */
  palette?: string
}

// Order here is the order the `ct-<value>` <link>s are emitted; `auto` is implicit
// (no row → no link, no markdown-body class, the VS Code-colour path).
export const CONTENT_THEMES: readonly ThemeDef[] = [
  {
    value: 'github-light',
    file: 'media/markdown-themes/github-markdown-light.css',
    mode: 'light',
    code: 'github',
    fontDefaultPx: 16,
    palette: 'github-light',
  },
  {
    value: 'github-dark',
    file: 'media/markdown-themes/github-markdown-dark.css',
    mode: 'dark',
    code: 'github-dark',
    fontDefaultPx: 16,
    palette: 'github-dark',
  },
  {
    value: 'material-dark',
    file: 'media/markdown-themes/material-dark.css',
    mode: 'dark',
    code: 'atom-one-dark',
    fontDefaultPx: null,
    palette: 'one-dark',
  },
  {
    value: 'vscode-light-2026',
    file: 'media/markdown-themes/vscode-light-2026.css',
    mode: 'light',
    code: 'vs',
    fontDefaultPx: null,
    palette: 'vscode-light-2026',
  },
  {
    value: 'vscode-dark-2026',
    file: 'media/markdown-themes/vscode-dark-2026.css',
    mode: 'dark',
    code: 'vs2015',
    fontDefaultPx: null,
    palette: 'vscode-dark-2026',
  },
]

const BY_VALUE = new Map<string, ThemeDef>(
  CONTENT_THEMES.map((t) => [t.value, t]),
)

/** All named theme values (i.e. every `theme.content` value except `auto`). */
export const NAMED_THEME_VALUES: readonly string[] = CONTENT_THEMES.map(
  (t) => t.value,
)

/** The theme def for a value, or undefined for `auto`/unknown. */
export function themeDef(value: string | undefined): ThemeDef | undefined {
  return value ? BY_VALUE.get(value) : undefined
}

/** True for any named theme (not `auto`/unset) — i.e. one that gets markdown-body. */
export function isNamedTheme(value: string | undefined): boolean {
  return !!value && value !== 'auto' && BY_VALUE.has(value)
}

const EDITOR_FONT_SIZE = 'var(--vscode-editor-font-size, 14px)'

/**
 * Resolve the `fontSize` setting into a CSS value for `--me-font-size`. Shared by the
 * host (initial body style) and the webview (live applyBodyOptions) so they can't
 * diverge. "editor"/unset → the theme default (GitHub 16px, else the VS Code editor
 * size); "vditor" → 16px; a positive number → px; anything else → the default. An
 * explicit number/"vditor" always wins, so the setting still scales a GitHub theme.
 */
export function resolveFontSize(
  value: string | number | undefined,
  contentTheme?: string,
): string {
  const px = themeDef(contentTheme)?.fontDefaultPx
  const def = px ? `${px}px` : EDITOR_FONT_SIZE
  if (value === undefined || value === '' || value === 'editor') return def
  if (value === 'vditor') return '16px'
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) && n > 0 ? `${n}px` : def
}

/**
 * The highlight.js style for an `auto` code theme: the content theme's paired style,
 * else github/github-dark by the effective mode (which itself follows the content
 * theme via effectiveThemeKind). An explicit `codeTheme` is handled by the caller.
 */
export function autoCodeStyle(
  mode: 'dark' | 'light',
  contentTheme: string | undefined,
): string {
  return (
    themeDef(contentTheme)?.code ?? (mode === 'dark' ? 'github-dark' : 'github')
  )
}

/**
 * The diagram palette auto-paired with a content theme — the SHARED layer-1 mapping for
 * every diagram renderer (mermaid task 86, echarts task 90). undefined when the content
 * theme has no pairing (e.g. `auto`/VS Code colours), so the caller falls back to the
 * engine's own light/dark. Unlike `autoCodeStyle` there's no binary palette fallback here.
 */
export function pairedPalette(
  contentTheme: string | undefined,
): string | undefined {
  return themeDef(contentTheme)?.palette
}
