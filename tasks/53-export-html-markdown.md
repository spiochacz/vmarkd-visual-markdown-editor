# Task 53 — Export HTML / Markdown

**Status:** planned

## Problem

Today the only "get the output out" feature is **Copy HTML** / **Copy Markdown**
(toolbar → `navigator.clipboard.writeText(vditor.getHTML()/getValue())`). There is
no way to open the rendered HTML as a document you can review/save. "Export HTML"
(open the rendered HTML as an untitled `.html` doc the user saves themselves) is a
concrete, commonly-wanted feature.

## Scope

### Primary — Export HTML (net-new)
- Toolbar item **Export HTML** (alongside Copy HTML) and/or a palette command
  `vmarkd.exportHtml`.
- Flow: webview posts `export-html` with `vditor.getHTML()` → host
  `workspace.openTextDocument({ content, language: 'html' })` +
  `window.showTextDocument(doc)`. Opens as an untitled HTML doc; user saves where
  they want. (No fs writes → no trust/virtual-workspace gate needed.)
- **Decide:** raw Vditor fragment vs a standalone wrap (`<!doctype html>` + the
  content-theme CSS so it renders the same standalone). Lean standalone — a bare
  fragment is less useful as an exported file. Reuse the content-theme CSS the
  overlay/live editor already link.

### Optional — Export Markdown
- Same mechanism with `vditor.getValue()` + `language: 'markdown'`. Lower value
  (the source file already *is* the markdown), so only if cheap — useful mainly to
  get the normalized/round-tripped markdown.

### Optional — action-button toast (#4 from the request)
- `showTextDocument` already opens the doc, so a "Open" toast is redundant for the
  untitled-doc path. The toast pattern (`showInformationMessage('Exported', 'Open',
  'Reveal')` → act on the choice) only earns its keep if we add a **save-to-file**
  variant (write `.html` next to the source, then offer "Open"/"Reveal in Explorer").
  Defer unless save-to-file is wanted. (Pattern already used: wiki "Create Page".)

### Optional — move Copy to host clipboard (#1 from the request)
- `navigator.clipboard.writeText` in the webview works (covered by e2e) but is
  focus/permission-sensitive in an iframe. While here, optionally route Copy HTML /
  Copy Markdown through the host: webview posts `copy-html`/`copy-markdown` →
  `env.clipboard.writeText(...)` (rock-solid). Small robustness win; one round-trip.

## Out of scope

- `window.withProgress` for export — HTML render is instant; not worth a progress
  bar (would only matter for a slow export path, which we don't have).
- PDF / other formats.

## Approach notes

- New webview→host message(s) wired through the existing `messageHandlers` map in
  `resolveCustomTextEditor` (now `EditorSession`) — add `onExportHtml` etc.
- New toolbar items mirror `copy-html`/`copy-markdown` in `media-src/src/toolbar.ts`.
- Localize new labels in `media-src/src/lang.ts` (`exportHtml`, …).

## Verification

- e2e: clicking Export HTML posts `export-html` with the rendered HTML.
- backend: the host handler opens an untitled `html` doc with that content
  (assert via the vscode-mock `openTextDocument`/`showTextDocument` calls — add to
  the mock if missing).
- `tsc` + `biome` + full vitest + Playwright e2e green.

## Related — already shipped (trace)

From the same "export / clipboard / links" idea list, one item was done separately:

- **External links → `env.openExternal`** (#5): `onOpenLink` now routes `http(s)`
  to the OS browser via `vscode.env.openExternal` (local/relative still
  `vscode.open`). Shipped in **PR #40** (`fix/open-external-links`). Not part of
  this task — recorded here only so the idea-list item has a trail.

Other items from that list: `withProgress` (#3) — skipped (renders are instant);
host-side clipboard for Copy (#1) — captured above as optional within this task.
