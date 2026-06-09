# Changelog

All notable changes to this extension are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [1.1.0]

### Added

- Markdown **rendering themes** (`vmarkd.theme.content`): `auto` follows your VS Code
  theme's colours, or pick a fixed look that restyles the rendered markdown
  (background, headings, blockquotes, tables, code, scrollbars) regardless of the
  editor theme — **GitHub** light/dark, **Material Dark** (One Dark), and **VS Code
  Light/Dark Modern**. Replaces the old `vmarkd.theme.useVscodeColors` toggle.
- Code-block syntax highlighting **pairs automatically** with the chosen rendering
  theme when `vmarkd.theme.code` is `auto` (e.g. Material Dark → atom-one-dark, VS
  Code Dark Modern → vs2015); an explicit `vmarkd.theme.code` still wins.
- The editor **font size** follows GitHub's 16px reading size under a GitHub theme by
  default, and still honours an explicit `vmarkd.editor.fontSize`.

## [1.0.0]

### Added

- Search in the editor with `Ctrl/Cmd+F`.
- Outline panel: navigate by heading with click-to-flash, a configurable width and
  side (`vmarkd.outline.position`), open-by-default, and a heading-markers toggle.
- Markdown Outline in the Explorer sidebar: a clickable heading tree for the open
  file with click-to-scroll (`vmarkd.outline.treeView`), separate from the in-editor
  outline panel above.
- Wiki-style `[[page]]` links: rendered as clickable chips that navigate
  (Ctrl/Cmd+click, or a plain click in preview) and offer to create the page when
  it's missing. Typing `[[` opens an autocomplete list of workspace pages by their
  original-case name (path-qualified when names collide). Enable and scope it with
  `vmarkd.wiki.enabled` / `vmarkd.wiki.root`.
- Reveal-in-source: "Open source to the side" and the toolbar "open in VS Code"
  button jump to the cursor's line in the text editor.
- Git change bars (added/modified vs the last commit) in the editor gutter.
- Status bar: estimated reading time, live word count, a WYSIWYG/Source indicator,
  and a "Large md" marker for large documents.
- Open the visual editor to the side, reusing an existing vMarkd tab instead of
  opening duplicates.
- External CSS files with live reload; `vmarkd.css.custom` is applied last so it wins.
- Live theme switching (follows your VS Code colour theme) and live settings reload
  (changes apply without reopening the editor).
- Rename tracking — the editor follows files renamed or moved in the workspace.
- Undo/redo with `Ctrl/Cmd+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`.
- Appearance settings: highlight headings, heading-level markers, code-block line
  numbers, Mermaid theme, toolbar visibility, and a font size that follows VS Code's
  editor size by default.
- `vmarkd.theme.code` setting — pick the code-block highlight theme (73 highlight.js
  styles); `auto` follows your light/dark theme. Applies live.
- A Markdown icon on the editor tab; supported in untrusted and virtual workspaces.
- Opt-in editor for Markdown files: it never takes over `.md` files automatically —
  you choose when to use it.
- Configurable link-open behaviour (`vmarkd.editor.linkOpenWithModifier`): by
  default Ctrl/Cmd+click opens a link and a plain click edits it (in every editor
  mode).
- Image upload: images pasted or dropped into the editor are saved into the
  workspace (folder set by `vmarkd.image.saveFolder`, e.g. `${projectRoot}/assets`)
  and can be auto-converted to WebP and downscaled to a max width
  (`vmarkd.image.format` / `vmarkd.image.quality` / `vmarkd.image.maxWidth`).
- About dialogs (in English) for vMarkd and the bundled Vditor, showing engine
  versions.
- Native VS Code codicon icons throughout — the title-bar buttons and the in-editor
  toolbar.
- Heading-anchored scroll sync in Split view: the section centred in the source pane
  stays aligned with the same section in the rendered pane.
- Tab indents inside code blocks.
- Copy as HTML / Markdown through the host clipboard.

### Changed

- Removed Vditor's preview action bar (the Desktop/Tablet/Mobile width switch and
  the WeChat/Zhihu copy buttons) — irrelevant in a VS Code editor.
- Removed both theme pickers from the toolbar's "more" menu: VS Code manages the UI
  theme, and the code-block highlight theme is now the `vmarkd.theme.code` setting.
- Requires VS Code 1.110 or newer.

### Fixed

- Source Control diffs open as a normal text diff instead of the visual editor.
- The table editing panel floats over the content (no blank gap under the cursor)
  and opens at the clicked cell.
- Mermaid diagrams re-theme live when you change `vmarkd.theme.mermaid`, keeping
  your scroll position.
- Toolbar clicks keep the document scroll position, even when nothing is focused.
- Cursor and scroll position are kept when the underlying file changes on disk
  while you're editing.
- Editing one section leaves the rest of the document's formatting byte-for-byte
  unchanged — no stray whitespace or line-break churn elsewhere.
- Tables stay intact: a `|` inside inline math or code doesn't break the row, and
  editing one cell doesn't reformat the others.
- Ctrl/Cmd+S always saves the latest content, even right after a fast edit.
- Pasting code-like text is recognised and wrapped in a code block.
- A malformed math (KaTeX) formula shows an inline error instead of breaking the
  rendered document.
- Toggling a task-list checkbox no longer crashes the editor.

### Security

- Hardened webview: sandboxed with a strict Content-Security-Policy and minimal
  privileges, custom CSS is sanitised, and file access is scoped to the workspace.
- Remote images are off by default (`vmarkd.image.allowRemoteImages`) to prevent
  tracking or data exfiltration through external image URLs.
- Supply chain: bumped `esbuild` (0.21 → 0.28) to clear a dev-server advisory, and
  CI fails the build on moderate-or-higher dependency vulnerabilities (`npm audit`).

### Performance

- Instant preview on open: the document appears immediately as a read-only preview,
  then swaps to the live editor seamlessly. Toggle with `vmarkd.advanced.instantPreview`.
- Large documents stay responsive while editing — only the section you change is
  reprocessed, not the whole file.
- Stream very large files (~700 KB+) into the editor in chunks for a responsive
  open; read-only with a spinner while it fills in. Auto-activates by size; toggle
  with `vmarkd.advanced.streamLargeFiles`.
- Free memory from hidden editor tabs with `vmarkd.advanced.retainHidden`.
- Smaller package and faster startup: dropped unused MathJax (~6.5 MB; math uses
  KaTeX) and narrowed activation.

### Engine & build

- Built on Vditor 3.11.2.
- Lute markdown engine vendored and pinned at an explicit commit — ahead of the
  version Vditor bundles.
- Built with `node build.mjs` (plain Node ESM, npm).
- Vditor is tree-shaken from source — webview bundle ~310 → 261 KB.
- Dependency bumps: TypeScript 5.9, `@types/node` 22, Vitest 4.1.8; requires
  Node ≥ 22 (`.nvmrc`).

### Tests

- Backend/host logic and pure webview helpers are unit-tested with Vitest.
- A Playwright end-to-end harness exercises webview behaviour (table-editing
  hotkeys, outline, wiki links, and more) in a real browser.
- Tests drive the editor with native `KeyboardEvent` dispatch.

### Removed

- Runtime dependencies: jQuery, jquery-confirm, lodash, date-fns,
  `@testing-library/user-event`, `@testing-library/dom`, `@babel/runtime-corejs3`.
- Build tooling: `foy`, `ts-node`.
- Dead dependencies: `sharp` and the `media-src` TypeScript dev-dependency.
