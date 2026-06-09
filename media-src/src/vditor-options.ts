// Build the Vditor constructor options from the host's init/update message.
// Extracted from main.ts so the option mapping (theme, code highlight style,
// code-block line numbers, outline) is unit/e2e testable in isolation.
//
// Why this matters: `msg.options` carries BOTH the config-derived settings
// (collectConfigOptions) AND the webview's previously-SAVED Vditor options
// (saveVditorOptions persists the whole `preview` object). Config-derived
// settings must therefore be applied as the FINAL, authoritative merge so a
// stale saved value can't override the current setting — otherwise a setting
// becomes a one-way switch (e.g. line numbers that turn on but never off).

import { autoCodeStyle } from '../../src/theme-registry'
import { deepMerge } from './deep-merge'

// Resolve the code-block highlight style: the explicit `codeTheme` setting, or — when
// 'auto'/unset — the style paired with the content theme (registry: material-dark →
// atom-one-dark, vscode-* → vs/vs2015, github → github/github-dark), else github/
// github-dark by the effective mode (which follows the content theme via
// effectiveThemeKind, host-side). Pairing lives in the single-source registry (task 84).
export function codeHljsStyle(theme: 'dark' | 'light', options: any): string {
  const ct = options?.codeTheme
  if (ct && ct !== 'auto') return ct
  return autoCodeStyle(theme, options?.contentTheme)
}

export function buildVditorOptions(msg: any): any {
  let opts: any = msg.cdn ? { cdn: msg.cdn } : {}
  const codeStyle = codeHljsStyle(
    msg.theme === 'dark' ? 'dark' : 'light',
    msg.options,
  )
  if (msg.theme === 'dark') {
    opts = deepMerge(opts, {
      theme: 'dark',
      preview: { theme: { current: 'dark' } },
    })
  }
  opts = deepMerge(opts, msg.options, {
    preview: { math: { inlineDigit: true }, actions: [] },
  })
  // Config-derived hljs options are AUTHORITATIVE: apply them LAST so they override
  // any stale `preview.hljs.*` spread in from msg.options above — the webview's
  // saveVditorOptions persists the WHOLE preview object, so a value saved in a past
  // session would otherwise win over the current setting:
  //   - lineNumber: set explicitly true AND false, else a saved `true` pins the
  //     gutter on forever, making `codeLineNumbers` a one-way switch (the "always
  //     there" bug).
  //   - style: the `codeTheme` setting (codeHljsStyle) must win over a saved style,
  //     else the constructor carries a stale theme and the first paint flashes the
  //     wrong code colours before main.ts's init setTheme corrects it.
  opts = deepMerge(opts, {
    preview: {
      hljs: {
        style: codeStyle,
        lineNumber: msg.options?.codeBlockLineNumbers === true,
      },
    },
  })
  opts = deepMerge(opts, {
    outline: {
      enable: msg.options?.showOutlineByDefault === true,
      position: msg.options?.outlinePosition === 'left' ? 'left' : 'right',
    },
  })
  return opts
}
