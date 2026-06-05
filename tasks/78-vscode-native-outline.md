# Task: Markdown Outline tree view

> **Status:** ✅ DONE (2026-06-05). Implemented as a **sidebar TreeView**, NOT a
> `DocumentSymbolProvider` — see "Why not native" below.
> **Value / Risk:** 🟢 sidebar outline + click-to-scroll for vMarkd editors / low.

## Why
VS Code's built-in **Outline** view relies on a `DocumentSymbolProvider`. When a
`.md` file is open in vMarkd (a custom editor), the built-in Outline is empty
("cannot provide outline information") — there's no document-structure nav.

## Why NOT native (DocumentSymbolProvider)
Verified: **VS Code does not query `DocumentSymbolProvider` while a custom editor
is active** (microsoft/vscode#97095, closed as out-of-scope). Registering one has
no effect for our editor — Outline / Breadcrumbs / Go-to-Symbol stay empty. A
proposed `CustomEditorOutlineProvider` API (PR #304909) is open but unmerged. The
only reliable path today is a self-managed `TreeView`.

## Implementation
- `src/outline-tree.ts`:
  - `parseHeadings(document)` — ATX headings, **skips fenced code blocks** (``` / ~~~)
    so a `# comment` inside a fence isn't a false heading. Each heading carries a
    0-based `index` = its ordinal, which lines up with the Nth rendered `<h1-6>` in
    the webview.
  - `MarkdownOutlineProvider implements TreeDataProvider<HeadingItem>` — builds a
    nested tree (deeper headings nest under shallower). Each `HeadingItem` carries
    the `vmarkd.outlineReveal` command.
- `package.json`: contributes a `vmarkd.outline` view in the **Explorer** container,
  gated on a `vmarkd.hasOutline` context key (set true when the active doc is markdown).
- `src/extension.ts`:
  - `updateOutline()` resolves the active markdown doc (via `getCommandTarget()` +
    `workspace.textDocuments`) and refreshes the provider + context key.
  - Wired into `refreshContexts`, a debounced `onDidChangeTextDocument`, and — crucially
    — each panel's `onDidChangeViewState` (custom editors DON'T fire
    `onDidChangeActiveTextEditor`, so this is the reliable active-editor signal) plus a
    one-shot refresh at the end of `resolveCustomTextEditor`.
  - `vmarkd.outlineReveal` command → posts `{command:'scroll-to-heading', index}` to the
    matching panel; falls back to revealing the source line if no webview is open.
- `media-src/src/main.ts`: `scroll-to-heading` handler scrolls the Nth heading into
  view + flashes it (reuses task-13 `FLASH_CLASS`).

## Known limitations
- **Can't sit above the built-in Outline** in the Explorer — VS Code has no view-order
  API; contributed views always append after built-ins (#91947). The user can drag it
  above once (persisted). Decided to keep it in Explorer.
- Index alignment assumes the webview renders exactly the parsed headings — fenced-code
  skipping keeps this true for normal docs. Setext headings (`===`/`---`) not parsed.

## Tests
- `test/backend/outline-tree.test.ts` — parser (fences, levels, indices, closing `#`)
  + tree nesting + provider uri/clear + reveal command wiring. 8 unit tests.

## See also
- Task 07/08/13 — in-webview Vditor outline (complementary).
- Task 75 — outline drag-resize (the in-webview panel).
- Task 16 — reveal-in-source (the fallback path).
