# Architectural Refactor: HTML Builder, Protocol Types, initVditor Split

**Date:** 2026-06-06
**Priority:** Safety & testability over aesthetics
**Scope:** 3 targeted changes — no broad restructuring

## Context

`extension.ts` (1743 LOC) and `main.ts` (948 LOC) are the two largest files.
Deep architectural analysis identified 3 changes with real value; the rest was
refactoring for refactoring's sake and was explicitly rejected.

## Change A: HTML Builder Extraction

### Problem

`_getHtmlForWebview()` (190 LOC) is a private method on `MarkdownEditorProvider`.
It builds the CSP header, prerender overlay, inline scroll-capture script, body
attrs, and the full HTML shell. It is **security-critical** (CSP misconfiguration
= XSS) but untestable in isolation — existing tests go through the full
`resolveCustomTextEditor()` integration path.

### Design

New file `src/html-builder.ts` exports one pure function:

```typescript
export function buildWebviewHtml(params: {
  toUri: (relativePath: string) => string
  baseHref: string
  cspSource: string
  nonce: string
  theme: 'dark' | 'light'
  config: {
    showToolbar: boolean
    useVscodeThemeColor: boolean
    enableFullWidth: boolean
    highlightHeadings: boolean
    showHeadingMarkers: boolean
    fontSize: string
    instantPreview: boolean
    allowRemoteImages: boolean
    customCss: string
    externalCss: string
  }
  preRenderedHtml: string | undefined
  savedMode: 'ir' | 'wysiwyg' | 'sv'
  i18nLang: string
}): string
```

Parameters are **primitives and strings**, not VS Code API objects. This means
tests don't need the vscode mock at all — pass strings, assert on the HTML
output.

`sanitizeCss()` moves into html-builder.ts. `MarkdownEditorProvider.sanitizeCss`
becomes a re-export so existing test imports keep working.

`_getHtmlForWebview()` becomes a ~30 LOC thin adapter: reads VS Code state,
calls `renderForMode()`, delegates to `buildWebviewHtml()`.

### Tests

New `test/backend/html-builder.test.ts`:
- CSP: remote images on/off → img-src directive
- CSP: nonce on every script tag and in script-src
- CSP: frame-src/object-src/base-uri hardening
- Prerender: undefined → no overlay; string → overlay with content
- Prerender: mode-aware wrapper class (ir vs wysiwyg)
- Body attrs: config flags → correct data-attributes
- sanitizeCss: `</style>` stripping

Existing tests (webview-html.test.ts, webview-overlay.test.ts) pass unchanged —
they still test through `resolveCustomTextEditor()`.

### Risk

Medium. The HTML output must be byte-identical before and after extraction.
Existing integration tests (277 + 91 LOC) are the safety net.

## Change B: Protocol Types (Webview Only)

### Problem

The webview's `messageHandlers` map is `Record<string, (msg: any) => void>`.
Handlers read `msg.content`, `msg.options`, `msg.theme` without type checking.

### Design

New file `media-src/src/protocol.ts` (~60 LOC) with a discriminated union:

```typescript
export type HostMessage =
  | { command: 'update'; content: string; type?: 'init' | 'update'; ... }
  | { command: 'set-theme'; theme: 'dark' | 'light' }
  | { command: 'config-changed'; options: Record<string, unknown> }
  | { command: 'reload-css'; id: string; css: string }
  | { command: 'get-cursor-offset' }
  | { command: 'diff-info'; changes: unknown[] }
  | { command: 'uploaded'; files: string[] }
  | { command: 'scroll-to-heading'; index: number }
  | { command: 'wiki-update'; pageKeys: string[] }
```

`messageHandlers` type changes to `Record<string, (msg: HostMessage) => void>`.
Handlers that use deep Vditor internals keep `as any` casts internally.

Webview-only — no shared import, no build pipeline changes. Host side already
has named methods (onEdit, onOpenWikilink) which are self-documenting.

### Tests

None — compile-time only. Existing tests must pass (zero runtime changes).

### Risk

Zero. Types only, no runtime changes.

## Change C: initVditor Named Sub-Functions

### Problem

`initVditor()` is 430 LOC with inline closures, two execution paths (streaming
vs non-streaming), and 6 distinct concerns mixed together.

### Design

Break into named functions **in the same file** (main.ts):

- `createSerializePipeline(msg)` — incrementalIr, serializeForHost, pendingEdit,
  reportDocMode, syncUndoDelay
- `buildVditorOptions(msg, codeStyle)` — theme/option merging
- `setupAfterInit(msg, deps)` — the after() callback body

`initVditor()` becomes a ~50 LOC orchestrator calling these. All functions
remain in main.ts, closure-capture module state as before. No EditorState
class (rejected as false encapsulation in the critical review).

### Tests

None new — existing 136 e2e tests cover initVditor paths (wiki, streaming,
prepaint-scroll, width, split-scroll). This is a structural refactor, not an
API change.

### Risk

Low. Same closure scope, same module state. 136 e2e tests catch regressions.

## Execution Order

1. HTML builder extraction (highest value — testable security)
2. Protocol types (low effort, prevents future bugs)
3. initVditor split (readability, lowest priority)

Each step is one commit. 628 tests must pass after each.
