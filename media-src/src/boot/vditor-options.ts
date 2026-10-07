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

import { resolveCodeStyle } from '../../../src/shared/theme-registry'
import { deepMerge } from '../util/deep-merge'

// Resolve the code-block highlight style: the explicit `codeTheme` setting, or — when
// 'auto'/unset — the style paired with the content theme (registry: material-dark →
// atom-one-dark, vscode-* → vs/vs2015, github → github/github-dark), else github/
// github-dark by the effective mode (which follows the content theme via
// effectiveThemeKind, host-side). Pairing lives in the single-source registry (task 84).
export function codeHljsStyle(theme: 'dark' | 'light', options: any): string {
  // Task 431: the rule itself lives in the shared registry (resolveCodeStyle) because the HOST now
  // resolves the same style to emit `#vditorHljsStyle` in the initial HTML — and Vditor tears the link
  // down and re-adds it if the two hrefs differ by a byte. This is the webview-side adapter, not a
  // second copy of the rule.
  return resolveCodeStyle(theme, options?.codeTheme, options?.contentTheme)
}

export function buildVditorOptions(msg: any): any {
  let opts: any = msg.cdn ? { cdn: msg.cdn } : {}
  const codeStyle = codeHljsStyle(
    msg.theme === 'dark' ? 'dark' : 'light',
    msg.options,
  )
  if (msg.theme === 'dark') {
    opts = deepMerge(opts, { theme: 'dark' })
  }
  opts = deepMerge(opts, msg.options, {
    preview: { math: { inlineDigit: true }, actions: [] },
  })
  // The content-theme MODE is AUTHORITATIVE and must be merged AFTER msg.options (same
  // pattern as hljs below, set for BOTH modes): saveVditorOptions persists the whole
  // `preview` blob, so a `theme.current` saved in a previous session (e.g. 'light' from
  // a light-mode session) would otherwise win here. Vditor's constructor (initUI) then
  // calls setContentTheme with that STALE mode — reloading the content-theme stylesheet
  // to the WRONG file over the correct one the initial HTML shipped — and after()'s
  // setTheme reloads it BACK, leaving a ~100 ms window where neither sheet is loaded:
  // the visible colour flash (text/hr/inline-code/code-panel) on every fresh open.
  opts = deepMerge(opts, {
    preview: { theme: { current: msg.theme === 'dark' ? 'dark' : 'light' } },
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
      // Task 187: snappier sv/preview refresh than Vditor's 1000 ms default. Lives in
      // the config-derived LAST merge so a stale `preview.delay` from a previously
      // saved options blob can never pin the old value (same rule as hljs.style).
      delay: 500,
      // Task 528: Vditor 3.11.3 turned NATIVE callouts on by default (they rewrite the DOM and the
      // saved bytes). We keep OUR callouts (callouts.ts), so force the native node off here, in the
      // last merge, so no saved options blob can switch it on. patchLuteHook also forces
      // `SetCallout(false)` on every Lute instance.
      markdown: { callout: false },
      hljs: {
        style: codeStyle,
        lineNumber: msg.options?.codeBlockLineNumbers === true,
      },
    },
  })
  // Task 212: Vditor's image preview overlay closes through inline onclick handlers.
  // CSP blocks those handlers in the real VS Code webview, leaving body scrolling locked.
  // A later image-zoom task owns a safe replacement; until then disable this broken overlay.
  opts = deepMerge(opts, { image: { isPreview: false } })
  opts = deepMerge(opts, {
    outline: {
      enable: msg.options?.showOutlineByDefault === true,
      position: msg.options?.outlinePosition === 'left' ? 'left' : 'right',
    },
  })
  // Task 282 — the configured open mode, resolved host-side. Merged LAST for the same reason as
  // hljs/content-theme above: saveVditorOptions persists `mode`, and buildInitOptions spreads those
  // saved options ON TOP of the config, so anything set earlier would be pinned by whatever mode the
  // previous session happened to end in — the setting would look like it did nothing.
  // Absent = 'remember', which is precisely "leave the saved mode alone", so this only ever fires
  // when the user asked for a specific mode. 'preview' is not a Vditor mode: it boots ir and toggles
  // the Preview overlay after init (vditor-init.ts), so it maps to ir here.
  const openMode = msg.options?.defaultMode
  if (openMode) {
    opts = deepMerge(opts, { mode: openMode === 'preview' ? 'ir' : openMode })
  }
  return opts
}
