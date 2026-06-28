# Task: Inline initial content into HTML (skip the `ready` roundtrip)

> **Source:** vMark performance audit (open latency — highest perceived win)
> **Value / Risk:** 🟥 HIGH perceived open latency / medium
> **Engines:** none
> **Status:** ✅ **DONE (2026-06-28).** Implemented + tested. The premise shifted — the *blank-flash*
> symptom is already handled by the prerender teaser, so the delivered win is **time-to-interactive**
> (boot Vditor without the serial `ready→init` host hop). Gates green: media-src + host typecheck,
> `npm test` (999), biome (only the 7 expected parity warnings), real-VS-Code e2e
> `inline-init.spec.ts`. (Unrelated: `custom-diagrams-render.spec.ts` fails identically on clean HEAD —
> a pre-existing headless flake, not from this change.)

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

## Findings (2026-06-28 code analysis)

Current flow (confirmed): `_getHtmlForWebview` (sync, has `this` + `content` + `theme`) →
`buildWebviewHtml`, which **already** turns `content` into a `preRenderedHtml` teaser
(`#vmarkd-prerender`, `instantPreview` default on) painted on the first frame → so the *blank flash*
the task described is **already largely mitigated**. The remaining cost is the serial roundtrip:
`html set` → main.js posts `ready` (main.ts:779) → host `onReady()` (async, builds wiki cache) →
`postUpdate({type:'init'})` → `handleUpdate`→`initVditor`. Until that completes Vditor isn't mounted
(the teaser is non-editable). **So the real win is time-to-interactive, not the flash.**

Feasibility (high, lower-risk than written):
- **content + options + theme + cdn are all available synchronously** at HTML-build time
  (`content` already passed for the teaser; `theme=effectiveThemeKind()`; options =
  `collectConfigOptions()` + `sanitizeVditorOptions(globalState)` + `outlineWidth`; cdn =
  `this.vditorBaseUri`, set at :1156 before html at :1390). → inline them directly.
- **CSP/nonce already wired** — `buildWebviewHtml` gets `nonce: getNonce()` and emits many
  `<script nonce>` tags; a `<script type="application/json" id="vmark-init" nonce>` is CSP-clean and
  non-executable (data island). Task's §2c concern already satisfied.
- **wiki pageKeys is the only async piece** (`getOrBuildCache`). Sidestepped by **gating inline to
  non-wiki files** — wiki files keep the `ready→init` path (which carries pageKeys at first render).

Gotchas found in the code (must handle):
1. `postUpdate` applies `escapeTableSpanPipes(content)` (#1904) — the inline payload must apply the
   SAME transform or inline-init ≠ postMessage-init.
2. The teaser **already embeds the rendered HTML** for the doc; inlining raw content too would ~double
   the HTML for big files → **gate inline on `content.length ≤ 100_000`** (large docs keep the
   `ready→init` + stream-render path).
3. `lastSyncedContent` must be set when inlining so the first external-edit diff works.
4. The host re-sends `init` after `ready` (onReady unchanged) → the webview must treat the **echo
   with identical content as a no-op** (skip the re-mount, which would reset caret/scroll).

## Implementation (2026-06-28)

- `src/html-builder.ts`: `HtmlBuildParams.initPayload?: string`; exported `serializeInitPayload()`
  (`JSON.stringify` + escape `<`→`<` so `</script>` can't break out); emit
  `<script type="application/json" id="vmark-init" nonce>…</script>` before the bundle scripts when
  present.
- `src/extension.ts` `_getHtmlForWebview`: build the init payload (gated: `content` defined &&
  `!isWikiFile(uri)` && `content.length ≤ 100_000`), serialize, pass as `initPayload`, set
  `this.lastSyncedContent = content`. `onReady` unchanged (sends the echo).
- `media-src/src/main.ts`: before posting `ready`, parse `#vmark-init` and run the init synchronously
  (`handleUpdate({command:'update', …payload})`), recording the content; the init branch skips the
  re-mount when the host's echo carries the same content. Falls back to `ready→init` when the payload
  is absent (large/wiki docs) or fails to parse.
- Tests: `test/backend/inline-init.test.ts` (escape round-trip + `buildWebviewHtml` emits/omits the
  tag) + `test/vscode-e2e/inline-init.spec.ts` (real webview: `#vmark-init` present, content rendered).
