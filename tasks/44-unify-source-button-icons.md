# Task: Unify the toolbar/chrome icons on codicons

> **Status:** ✅ Done (2026-06-01). Scope grew from "unify the two source buttons"
> to a full codicon restyle of the editor's icons.
> **Source:** user request (2026-06-01).
> **Value / Risk:** ⚪ visual consistency / low–medium (icon swap + a webview icon
> override script).
> **Engines:** none.

## What shipped
The editor drew icons from three different worlds: VS Code **codicons** (some
title-bar buttons), **raw SVG files** (other title-bar buttons), and Vditor's
**`ant`** icon set (the in-webview toolbar). Now everything reads as one codicon
family.

### 1. Chrome (`package.json` `contributes.commands`)
- `openEditor` → `$(markdown)` (was `media/open-markdown-{light,dark}.svg`).
- `openTextEditor` → `$(go-to-file)` (was `media/open-editor-{light,dark}.svg`).
- `openSettings` `$(settings-gear)`, `openInSplit` `$(split-horizontal)`,
  `openSourceToSide` `$(go-to-file)` — already codicons, unchanged.
- Deleted the now-dead SVGs: `open-markdown-{light,dark}.svg`,
  `open-editor-{light,dark}.svg`, plus the never-referenced `markdown.svg` and
  `md_editor.svg`.

### 2. Our own webview-toolbar icons (`media-src/src/toolbar.ts`)
Inline SVGs (codicons aren't available as a font inside the iframe, so the path
data is inlined): `save`→`save`, `edit-in-vscode`→`go-to-file`,
`wiki-pages`→`book`, `navigate-back`→`arrow-left`, `settings`→`settings-gear`.

### 3. Vditor's built-in toolbar icons (the `ant` set)
Restyled to codicons via a single **build-time merged sprite** (was: load ant.js +
mutate at runtime; consolidated 2026-06-01 for one file + no runtime DOM work):
- **Source of truth:** `media-src/icons/<name>.svg` — 30 codicon-style glyphs,
  where `<name>` maps to Vditor's `vditor-icon-<name>` symbol id.
- **Generator:** `media-src/build-icon-sprite.mjs` (run by `build.mjs` after the
  Vditor asset sync) reads `ant.js` **plus** our overrides and emits
  `media/vditor-icons.js` — Vditor's full ant symbol set with our 30 swapped for
  codicons (53 symbols: 30 codicon + 23 ant kept verbatim for table-panel
  align/insert/delete, resize, trashcan, …).
- **Wiring:** `src/extension.ts` loads that one file under
  `id="vditorIconScript"`, which makes Vditor **skip loading its own ant.js**
  (it guards by that id). The sprite injects all symbols via `insertAdjacentHTML`,
  exactly like ant.js — no runtime mutation, one ~41 KB file instead of ant.js
  (42 KB) + a 23 KB override.

**Mapping (24 official codicons + 6 hand-drawn in codicon style):**
- Direct codicon: bold, italic, strike→`strikethrough`, link, list→`list-unordered`,
  ordered-list→`list-ordered`, check→`checklist`, quote, code, line→`horizontal-rule`,
  table, emoji→`smiley`, upload→`cloud-upload`, undo→`discard`, redo, edit, more→`ellipsis`,
  both→`split-horizontal`, code-theme→`paintcan`, content-theme→`jersey`,
  preview→`open-preview`, devtools→`bug`, info, help→`question`.
- **Custom (no good codicon → drawn at 16×16 in codicon style, modeled on the ant
  shape):** `headings` (an "H"), `indent`/`outdent` (list-unordered-weight lines +
  a direction triangle), `inline-code` (the `code` chevrons, no slash),
  `insert-before`/`insert-after` (thin bar + up/down arrow).

## Notes
- codicons are MIT-licensed; path data lifted from the codicon source repo.
- Custom glyph geometry deliberately matches neighbouring codicons (1px rounded
  capsule lines like `list-unordered`; chevrons lifted from `code`).
- To re-tune a custom glyph: edit `media-src/icons/<name>.svg`, then `node build.mjs`.
- After a Vditor bump the override still applies (it targets stable symbol ids); if
  Vditor ever renames a `vditor-icon-*` id, update the file name in `media-src/icons/`.

## Verify
Open a `.md` in vMarkd → the whole toolbar + title-bar buttons read as one codicon
set. Title-bar `openEditor` shows the markdown glyph, `openTextEditor`/source
buttons show go-to-file. The webview toolbar's bold/italic/list/etc. are codicons;
headings/indent/outdent/inline-code/insert-before/after are the codicon-style
customs. No icon renders blank.
