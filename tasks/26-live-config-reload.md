# Task: Live config reload (onDidChangeConfiguration)

> **Status:** ✅ Done. `onDidChangeConfiguration` → posts `config-changed` (body-attr options via `live-config.ts` `applyBodyOptions`) + `reload-css` (custom + external) with no Vditor re-init. Vditor-init-only settings (outlinePosition/showOutlineByDefault) still need reopen. Unit (config-reload posts) + e2e (applyBodyOptions/swapStyle).
> **Source:** vMark VS Code stable-API audit (live config via `onDidChangeConfiguration`)
> **Value / Risk:** 🟡 medium / low

## Problem
`markdown-editor.*` settings are read **once at init** (the `ready` handler in
`extension.ts` builds `options` from config; the webview applies them in the
`init` branch of `media-src/src/main.ts`). Changing `customCss`, `enableFullWidth`,
or `useVscodeThemeColor` requires closing and reopening the editor to take effect.

Note: `imageSaveFolder` is already live — `getAssetsFolder` re-reads config on every
upload (`extension.ts:511`), so it needs no change here.

## Goal
Apply setting changes to already-open editors immediately, without reopening.

## Steps
1. `src/extension.ts`, in `resolveCustomTextEditor`: register
   `vscode.workspace.onDidChangeConfiguration`, push to per-editor `disposables`.
   Guard with `e.affectsConfiguration('markdown-editor')`.
2. On change, re-read config and `postMessage` the affected pieces:
   - `enableFullWidth` / `useVscodeThemeColor` → webview toggles the existing
     `data-full-width` / `data-use-vscode-theme-color` body attributes
     (`main.ts:137-147`) — no re-init.
   - `customCss` → swap a dedicated `<style id="custom-css">` node in the webview
     (today `customCss` is baked into the HTML at `extension.ts:563`; move it to an
     id'd `<style>` so it can be replaced). **Reuse the `reload-css` swap mechanism
     from `12-external-css-live-reload.md`** rather than inventing a second one.
3. `media-src/src/main.ts`: handle the new message(s) to set body attributes / swap
   the custom-css node without destroying Vditor.
4. Dispose the listener in `onDidDispose`.

## See also
- `12-external-css-live-reload.md` — shares the `<style>`-swap mechanism; do that
  one and this together if possible.
- `18-security-hardening.md` §2b — sanitize `customCss` before injecting on reload too.
- `25-theme-live-switch.md` — same listener-in-resolve pattern.

## Verify
With an editor open, change `customCss`, `enableFullWidth`, and `useVscodeThemeColor`
in settings → each applies live without reopening. Confirm Vditor content (cursor /
scroll) is preserved for the attribute toggles.
