# Task: Live theme switching (follow VS Code color theme)

> **Source:** vMark VS Code stable-API audit (live theme follow via `--vscode-*` CSS vars)
> **Value / Risk:** 🟢 fixes a real UX bug / low

## Problem
The webview CSS already binds to `--vscode-*` variables (`media-src/src/main.css`),
so background/foreground **do** follow the active theme live. But Vditor's own
light/dark *mode* (the `theme: 'dark'` option + `preview.theme.current` +
`hljs.style` + the `vditor--dark` class) is set **once at init** from `msg.theme`
(`media-src/src/main.ts:30`), and `extension.ts` has **no
`onDidChangeActiveColorTheme` listener**.

Result: switch the VS Code theme while the editor is open → the background updates
(CSS var) but Vditor's syntax highlighting and dark/light mode stay stale → mixed,
broken-looking state until the editor is reopened.

## Goal
When the VS Code color theme changes, re-theme the open editor(s) **live**, without a
full destroy/re-init (which would lose cursor/scroll).

## Steps
1. `src/extension.ts`, in `resolveCustomTextEditor`: register
   `vscode.window.onDidChangeActiveColorTheme`, push to the per-editor `disposables`
   (disposed in `onDidDispose`). On fire, compute the theme kind exactly like the
   `init` branch (Dark/HighContrast → `'dark'`, else `'light'`) and
   `webviewPanel.webview.postMessage({ command: 'set-theme', theme })`.
   - Only post while the panel is alive; each open editor registers its own listener.
2. `media-src/src/main.ts`: handle a new `case 'set-theme'` in the message listener.
   Call Vditor's `setTheme(...)` API to switch mode + content theme + code theme
   instead of re-initialising:
   - dark → `vditor.setTheme('dark', 'dark', 'atom-one-dark-reasonable')`
   - light → `vditor.setTheme('classic', 'light', <light hljs style>)`
   Keep the `--vscode-*`-driven chrome as-is (it already reacts via CSS).
3. Factor the "compute theme from `activeColorTheme.kind`" logic into a small helper
   in `extension.ts` so `init` and `set-theme` stay in sync.

## See also
- `26-live-config-reload.md` — same listener-in-resolve + postMessage pattern.

## Verify
Open a markdown file in the editor, toggle VS Code between a light and a dark theme
(and High Contrast): Vditor's mode, syntax highlighting, and chrome all switch live,
cursor/scroll position preserved, no reopen needed. Test with a split / multiple
editors open simultaneously.

Also verify under the **new default "Modern" themes** ("Light Modern" / "Dark Modern",
default for new users since VS Code 1.113): `useVscodeThemeColor` and any `customCss`
still render correctly, since the `--vscode-*` values differ from the legacy defaults.
