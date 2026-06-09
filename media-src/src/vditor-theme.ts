// The ONE place that knows how Vditor's theme API works (DIP boundary). Everything
// else asks for a light/dark mode + a code style; only this module knows Vditor's
// `setTheme` signature, that its UI-theme name is 'dark' for dark and 'classic' for
// light (≠ the mode string), and how the content-theme stylesheet path is built.
//
// Why we apply the theme through setTheme at all (vs constructor options): the
// `theme`/`preview.theme.current` constructor options alone do NOT reliably apply the
// content/code theme at init — that left a dark VS Code showing light content text +
// white tables. setTheme is the proven path, used by both init and live switching.
//
// Why the content-theme path is passed EXPLICITLY (4th arg) instead of letting
// setTheme fall back to `options.preview.theme.path`: that option is unreliable here —
// the host strips a stale baked path from saved options (the colors-401 fix), which
// would otherwise leave Vditor's setContentTheme with an empty path and make it a
// no-op, so the table/content theme never followed a live theme switch.

interface VditorThemeApi {
  setTheme: (
    uiTheme: string,
    contentMode: 'dark' | 'light',
    codeTheme: string,
    contentThemePath?: string,
  ) => void
}

/**
 * Apply the editor's light/dark mode + code-block highlight style to a Vditor
 * instance. `cdn` is the Vditor asset base (the content-theme CSS lives at
 * `${cdn}/dist/css/content-theme/{light,dark}.css`); undefined → no content-theme
 * path (setContentTheme no-ops, leaving the current stylesheet — used when a named
 * vMarkd content theme owns the palette).
 */
export function setVditorTheme(
  vditor: VditorThemeApi,
  mode: 'dark' | 'light',
  codeStyle: string,
  cdn: string | undefined,
): void {
  const contentThemePath = cdn ? `${cdn}/dist/css/content-theme` : undefined
  vditor.setTheme(
    mode === 'dark' ? 'dark' : 'classic',
    mode,
    codeStyle,
    contentThemePath,
  )
}
