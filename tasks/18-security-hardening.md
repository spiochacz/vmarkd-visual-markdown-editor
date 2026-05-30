# Task: Security hardening (filesystem / CSS / CSP / logging)

> **Source:** `nebuk89/vscode-markdown-editor` — "restrict filesystem access, sanitize
> CSS, protect logging"
> **Derived from (removed plan):** `quick-fixes-and-hardening-plan.md` §2
> **Value / Risk:** 🟢 fixes real exposure / medium (2a can break resource loading)

Four independently shippable sub-items. **2a is the priority.** Test resource
loading carefully after 2a.

## 2a. Narrow `localResourceRoots` (the important one)
Today (`extension.ts:143-161`) the webview can load from the **entire filesystem**
(`Uri.file("/")` + every Windows drive A:–Z: via `getFolders()`). Scope to only:
- the extension's `media` dir (`extensionUri`),
- the document's workspace folder (or its own directory if no workspace),
- the configured image folder if it resolves outside the above.
```ts
const roots = [vscode.Uri.joinPath(this._context.extensionUri, 'media')]
const ws = vscode.workspace.getWorkspaceFolder(document.uri)
roots.push(ws ? ws.uri : vscode.Uri.file(NodePath.dirname(document.uri.fsPath)))
// localResourceRoots: roots
```
Make `getWebviewOptions` take the document URI. Drop `Uri.file("/")` and
`getFolders()`. ⚠️ Verify images still load (base href + `asWebviewUri` paths must
fall under a root). ⚠️ **Keep the extension `media` dir in the roots** — Vditor's local
`cdn` base (`media/vditor`, where Mermaid/KaTeX/etc. are self-hosted) is served via
`asWebviewUri` and silently 404s if narrowed out, breaking all diagram/math rendering.

> **Side benefit (free, no engines bump):** narrowing the roots also unblocks the
> automatic VS Code wins — resource **streaming** (1.118) for the heavy local assets
> (KaTeX/ECharts/Graphviz/abc.js + images) and **CSS anchor positioning** (1.119) for
> webview relayout. The whole-disk roots today blunt the streaming benefit; once
> scoped + served via `asWebviewUri`, newer VS Code applies both with zero code.

## 2b. Sanitize `customCss` injection
Today (`extension.ts:563`) `config.get('customCss')` is injected **raw** into a
`<style>` block — a `</style>` in the value closes the tag → script injection.
Strip `</style` (case-insensitive) before injection; optionally neutralize
`javascript:` / `expression(` / remote `@import url(...)`. Apply the same to
`externalCssFiles` (see `12-external-css-live-reload.md`).

## 2c. Add a Content-Security-Policy
`_getHtmlForWebview` emits no CSP `<meta>`. Add one scoped to `webview.cspSource`
(styles/scripts/img/font from the webview origin + `data:` for images), with a
nonce on our `<script>` tags. Pairs with 2a.

## 2d. Protect logging + proper logging channel
`debug()` (`extension.ts:18`) and `console.log('msg', msg)` (`main.ts:27`) log full
payloads — i.e. **document content** — always, to the dev console.

Two parts:
- **Security:** never log raw document content by default. Gate content-bearing logs
  behind a debug flag (`markdown-editor.debug` setting or `process.env`).
- **Infrastructure (analysis Part III §4):** replace `console.log`/`debug()` on the
  extension side with a `LogOutputChannel`:
  `vscode.window.createOutputChannel('vMark', { log: true })`. This gives levelled
  logs (`trace`/`debug`/`info`/`warn`/`error`) in the Output panel that respect the
  user's configured log level — so the debug flag above largely collapses into
  "log content only at `trace`/`debug` level". Dispose the channel via
  `context.subscriptions`.

## Verify
After 2a, test that images, custom CSS, and vditor assets still load. 2b/2c/2d are
low risk. 2c touches `_getHtmlForWebview`.
