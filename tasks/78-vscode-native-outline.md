# Task: VS Code native Outline view (DocumentSymbolProvider)

> **Status:** ⬜ Not started.
> **Value / Risk:** 🟢 high UX win (native Outline + Breadcrumbs + Go to Symbol) / low–medium.

## Why
VS Code's built-in **Outline** view (sidebar panel), **Breadcrumbs** bar, and
**Go to Symbol** (Ctrl+Shift+O) all rely on a `DocumentSymbolProvider`. The
built-in Markdown extension provides one, but when the user opens a `.md` file
in vMarkd (custom editor), that provider doesn't fire — the Outline pane is
empty, Breadcrumbs show nothing, and Ctrl+Shift+O is dead.

Registering our own `DocumentSymbolProvider` for markdown files gives vMarkd
users the same navigation they'd get in the text editor — plus it works
alongside the in-webview Vditor outline (task 07/08), not instead of it.

## Approach
Register a `vscode.languages.registerDocumentSymbolProvider` for
`{ language: 'markdown' }` that parses headings from the document text and
returns a nested `DocumentSymbol[]` tree (kind `SymbolKind.String` or
`SymbolKind.Key` — the Markdown convention).

### Parsing
ATX headings (`# … ######`) → depth 1–6. Each heading's range spans from the
heading line to the line before the next heading at the same or shallower depth
(or EOF). This gives proper nesting in the Outline tree.

Reuse the same document text the host already has (`document.getText()`). No
Lute needed — ATX heading regex is trivial and the built-in MD extension uses
the same approach.

### Sync with webview
On heading click in the native Outline → VS Code fires
`vscode.window.onDidChangeTextEditorSelection` → we can post a
`scroll-to-heading` message to the webview (reuse the task-13 flash +
scroll machinery). This gives bidirectional navigation: native Outline →
webview, and in-webview outline → source (task 16).

## Steps
1. `src/markdown-symbols.ts`: implement `DocumentSymbolProvider` with ATX
   heading parsing → nested `DocumentSymbol[]`.
2. Register in `activate()` with `languages.registerDocumentSymbolProvider(
   { language: 'markdown' }, provider)`.
3. Verify: Outline view, Breadcrumbs, Ctrl+Shift+O all populate.
4. Optional: on symbol-click in Outline while vMarkd is active, scroll the
   webview to the heading (post `scroll-to-heading` + flash).
5. Tests: unit for the parser (flat/nested headings, setext, edge cases).

## Gotchas
- The built-in Markdown extension already provides symbols for text editors.
  Our provider complements it for the custom editor case (both can coexist;
  VS Code merges/deduplicates by range).
- Setext headings (`===`/`---` underlines) — support is nice-to-have but
  ATX covers 99% of real usage.
- Large documents: the parser is O(lines), trivially fast. No debounce needed
  (VS Code calls the provider on demand, not on every keystroke).

## See also
- Task 07/08/13 — in-webview Vditor outline (complementary, not replaced).
- Task 34 — secondary-sidebar TOC (overlaps; this is the lighter, native approach).
- Task 16 — reveal-in-source (reusable scroll-to-heading machinery).
