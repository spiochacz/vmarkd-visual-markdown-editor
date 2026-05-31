# Task: Scope webview privileges (enableCommandUris + stop overwriting options)

> **Status:** ✅ Done. (1) The call site now spreads `getWebviewOptions()` over the
> existing `webview.options` (augment, not replace), preserving VS Code's defaults.
> (2) Audited the webview/HTML/Vditor output — navigation is 100% `postMessage`
> (`open-link`/`navigate-back`/…), zero `command:` URIs — so `enableCommandUris` is
> now `false`. `retainContextWhenHidden` (panel-level, set at registration, task 37)
> dropped from the webview options where it was dead. Host-side, +2 unit tests (98
> total). Pairs with 18 §2c — confirm rendering in the same live pass.
> **Source:** vMark `src` security audit (webview options privilege)
> **Value / Risk:** 🟢 reduces webview privilege / low

Two small, related hardening changes to the webview options. Pairs with the CSP work
in `18-security-hardening.md` §2c and depends on the narrowed roots in §2a.

## 1. Stop overwriting the custom-editor default options (Finding #2)
`resolveCustomTextEditor` does `webviewPanel.webview.options =
MarkdownEditorProvider.getWebviewOptions()` (`extension.ts:186`), which **replaces**
the sensible defaults VS Code provides for custom editors (incl. the 1.119
`localResourceRoots` defaults: extension dir + workspace) with our own object.

After `18 §2a` narrows the roots, **augment** rather than wholesale-replace: start
from the existing `webviewPanel.webview.options` and only set what we need
(`enableScripts`, the narrowed `localResourceRoots`), so VS Code's defaults are not
silently discarded.

## 2. Scope `enableCommandUris` (Finding #3)
`getWebviewOptions` sets `enableCommandUris: true` (`extension.ts:159`), allowing
**any** `command:` URI from the webview. Navigation actually goes through
`postMessage` (`navigate-back`, `open-link`, `edit-in-vscode`, …), not `command:`
links.

- Audit the rendered HTML and Vditor output for any real `command:` URI usage.
- If none → set `enableCommandUris: false`.
- If some are genuinely needed → set it to a `readonly string[]` of our own command
  ids only (the API accepts `boolean | readonly string[]`).

## See also
- `18-security-hardening.md` §2a (narrow roots — do first), §2c (CSP).

## Verify
Editor still opens; toolbar, links, wiki links, navigate-back, image loading, and
custom/external CSS all keep working. No `command:` link silently breaks.
