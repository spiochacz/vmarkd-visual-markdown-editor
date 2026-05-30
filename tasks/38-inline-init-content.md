# Task: Inline initial content into HTML (skip the `ready` roundtrip)

> **Source:** vMark performance audit (open latency — highest perceived win)
> **Value / Risk:** 🟥 HIGH perceived open latency / medium
> **Engines:** none

## Problem
Opening a file pays a serial host↔webview roundtrip before anything renders:
1. webview loads the 308 KB bundle,
2. posts `{ command: 'ready' }` (`media-src/src/main.ts`),
3. the host replies with `{ command: 'update', type: 'init', content, options, theme, wiki }`
   (the `ready` handler in `extension.ts`),
4. only then does `initVditor` run.

The user sees an empty editor until the roundtrip completes (a visible blank flash on
slower machines / large files).

## Goal
Initialize Vditor synchronously on first paint, with no roundtrip for the initial state.

> **Background (VS Code custom-editor docs):** each custom editor gets its own
> `WebviewPanel` and pays full creation + init on every open (the `TextDocument` is
> shared, the view is not), so the `ready` handshake is pure per-open latency worth
> removing. Risk: the inlined JSON must satisfy the CSP `script-src` (nonce/hash) —
> verify against the policy from `18-security-hardening.md` §2c, or the payload is
> blocked.

## Steps
1. `src/extension.ts` `_getHtmlForWebview`: embed the initial payload (content, options,
   theme, wiki pageKeys) as a single
   `<script type="application/json" id="vmark-init" nonce="...">…</script>` node.
   **HTML-escape** the JSON (or base64-encode it) so document content cannot break out of
   the script tag — coordinate with the CSP/nonce work in `18-security-hardening.md` §2c.
2. `media-src/src/main.ts`: on load, if `#vmark-init` is present, parse it and call
   `initVditor` immediately; otherwise fall back to the current `ready`→`update` path.
   Keep the `postMessage` path for **subsequent** updates (file watcher, theme/config
   changes) — only the *initial* state moves inline.
3. Make the wiki `pageKeys` lookup (currently done lazily in the `ready` handler) either
   inline-able or deferred so it doesn't reintroduce a blocking roundtrip.

## Measure
`Developer: Open Webview Developer Tools` → Performance: record an open before/after;
compare time from navigation start to first Vditor paint. `console.time('vditor-init')`
around `initVditor` for a quick number.

## See also
- `18-security-hardening.md` §2c — inline JSON must be CSP/nonce-safe and escaped.
- `37-retain-hidden-memory-dial.md` — synchronous init makes dispose-on-hide affordable.

## Verify
Open a large markdown file: no blank-editor flash; content is present on first paint;
subsequent external edits / theme changes still propagate via postMessage.
