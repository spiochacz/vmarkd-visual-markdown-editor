# Changelog

All notable changes to this extension are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Callouts / GitHub Alerts**: `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` /
  `[!CAUTION]` blockquotes render as styled callout boxes with per-type accents and
  icons — GitHub- and Obsidian-compatible (Obsidian's `> [!note]-`/`+` fold suffix is
  accepted and rendered as a normal callout). When the caret is outside, the callout
  shows its rendered preview; placing the caret inside reveals the raw markdown for
  editing. Display-only and round-trip safe — the saved markdown is untouched. In WYSIWYG
  mode the callout shows a styled title, and you pick its type — plus an optional custom
  title — from a dropdown in the block's native popover, the way you set a code block's
  language.
- **ECharts chart themes** (`vmarkd.theme.echarts`): `auto` (default) pairs ` ```echarts `
  charts with the rendering theme's palette (the same pairing mermaid uses), or pick an
  explicit look — light, dark, the ECharts gallery themes (vintage, macarons,
  infographic, roma, shine, tech-blue) or vintage-dark. Charts re-theme live when the
  theme changes.
- **VS Code mermaid palettes**: `vmarkd.theme.mermaid` adds `vscode-light-2026` and
  `vscode-dark-2026`, and `auto` pairs them with the matching VS Code 2026 rendering
  theme — so ` ```mermaid ` diagrams match VS Code's own colours.
- **Flowchart diagrams follow the theme**: ` ```flowchart ` (flowchart.js) diagrams draw
  in the rendering theme's text colour with transparent boxes — instead of fixed black,
  which was invisible on dark themes — and re-draw when you switch themes.
- **HTML comments visible in the editor**: `<!-- … -->` blocks show their content as
  muted italic text in IR, WYSIWYG and the full Preview — so you can see comments
  without clicking into them. Placing the caret inside reveals the raw markdown for
  editing, without a code-panel background.
- **Live code highlighting while editing (WYSIWYG)**: code inside a fenced block is
  syntax-coloured as you type in WYSIWYG mode — full colour, bold and italic from the
  highlight.js theme — instead of plain monospace text.
- **Scroll position preserved across Edit ⇄ Preview**: switching between the editor
  (IR/WYSIWYG) and the full Preview keeps your place in the document, in both directions
  — anchored on the nearest block, so you no longer land mid-section or at the top.

### Changed

- **Diagrams adapt to the editor width**: mermaid, ECharts charts, mindmaps, markmap,
  Graphviz, abc music notation and SMILES chemical structures scale to fit the rendering
  column — in the editor (IR/WYSIWYG) and the full Preview — and shrink as you narrow the
  window, instead of overflowing the column or staying a fixed size. markmap tracks the
  window smoothly as you drag, rather than snapping once you stop. Wide-by-nature
  diagrams (mermaid, Graphviz) keep their natural size when there's room rather than being
  stretched. Mindmaps size to their content (no large empty margins around a small tree),
  and both ECharts charts and mindmaps render without an entry animation. Editing a chart
  or mindmap's source shows an edit field sized to the code, not to the diagram's render
  box. SMILES structures also render in WYSIWYG mode (not just the Preview/IR surfaces),
  sit directly on the page background, and follow the theme — the molecule is drawn in a
  light or dark palette to match the rendered background and re-draws when you switch
  themes.
- **VS Code rendering themes are now "2026"**: the `vmarkd.theme.content` values
  `vscode-light-modern` / `vscode-dark-modern` become `vscode-light-2026` /
  `vscode-dark-2026`, retargeted to VS Code 1.123's default "Light/Dark 2026" palette so
  the rendered Markdown mirrors VS Code's own preview (background, text, links, inline
  code, blockquotes, tables, horizontal rules). Update the setting if you pinned the old
  value.
- Bundled **ECharts upgraded 5.5.1 → 6.1.0** (the version Vditor ships is pinned at
  5.5.1; vMarkd vendors the newer build), picking up upstream chart fixes and renderers.
- **Editing a code block looks exactly like its render**: the editable source carries
  the same highlight.js theme styling (font size, padding, background panel) as the
  rendered block on every theme — no size or colour shift when entering or leaving
  edit, and no preview flash when clicking inside the block.
- **Seamless open**: the instant preview hands off to the live editor without a visible
  jump or colour flash — code blocks hold their height and colours through
  highlight.js loading, and the rendering theme applies from the very first paint.
- **Arrow-key navigation between adjacent blocks** (code↔code, quote↔code) no longer
  scatters blank lines through the document (a Vditor quirk): the in-between paragraph
  appears when you arrow into the gap — type to keep it, move on and it cleans itself
  up.
- Settings: all theme settings now live in a dedicated **Themes** group, with the
  rendering theme (`vmarkd.theme.content`) first — it drives the code, mermaid and
  echarts pairings.

## [1.2.0]

### Added

- **Mermaid diagram themes** (`vmarkd.theme.mermaid`): 15 named palettes (GitHub
  light/dark, Dracula, Nord, Tokyo Night, Catppuccin, Solarized, One Dark, Zinc, …)
  rendered via mermaid's customisable base theme, alongside mermaid's built-ins. `auto`
  pairs the palette to your rendering theme (`vmarkd.theme.content`) — GitHub → GitHub,
  Material Dark → One Dark, VS Code Light/Dark Modern → Zinc light/dark — and an explicit
  palette still wins. Diagrams re-theme live when you switch the rendering theme, not just
  the VS Code light/dark theme. Palette colours from
  [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) (MIT).

### Changed

- Bundled **Mermaid upgraded 11.6.0 → 11.15.0** (the version Vditor ships is pinned at
  11.6.0; vMarkd vendors the newer same-major build), picking up upstream diagram fixes
  and rendering improvements.

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
