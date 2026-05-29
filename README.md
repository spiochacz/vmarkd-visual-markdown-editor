# Markdown Editor — Extended Settings

Standalone fork of [zaaack/vscode-markdown-editor](https://github.com/zaaack/vscode-markdown-editor) with a substantially expanded feature set, updated bundled editor runtime, and fork-specific workflow improvements.

Original project: https://github.com/zaaack/vscode-markdown-editor

## Demo

![demo](./media/hero.png)

## What This Fork Adds

This fork keeps the original custom Markdown editor workflow, then extends it with practical VS Code integration and editor customisation features that are not described in the upstream README.

- **Mermaid diagrams**: Added Mermaid diagrams render directly inside the custom editor.
- **Live sync**: Changes stay in sync with the underlying Markdown file while you edit.
- **Return to text editor**: You can jump back to the normal VS Code text editor from the toolbar or command palette.
- **Remembered editor preferences**: The editor keeps your preferred layout and UI options, and includes a reset action when you want to start fresh.
- **Layout and theme control**: The editor can follow the active VS Code theme, switch to a full-width layout, and accept custom CSS overrides.
- **Configurable image saving**: Uploaded, pasted, or dropped images can be saved to a configurable folder.
- **Extended toolbar actions**: The toolbar adds copy Markdown, copy HTML, and improved link insertion actions.
- **VS Code link handling**: Links opened from the editor are handed off through VS Code.
- **Wiki links for wiki folders**: Markdown files inside a `wiki` folder recognise `[[page-name]]` links and resolve them to other wiki pages.
- **IR table controls**: IR mode includes extra table editing controls.
- **Responsive tables**: Tables now stretch with the width of the hosting editor window instead of staying at a fixed width.

## Features

- WYSIWYG Markdown editing with Vditor
- Multiple editing modes: IR, WYSIWYG, and split-view/source-oriented workflows provided by Vditor
- Auto-sync with the underlying Markdown file when either side changes
- Save directly from the editor toolbar
- Copy rendered HTML or raw Markdown from the editor
- Uploaded, pasted, or drag-dropped images are written to disk automatically
- Mermaid, KaTeX, Graphviz, ECharts, abc.js, and other Vditor-supported embedded content
- Offline/local runtime assets for the webview editor, including Mermaid support
- Responsive table layout that follows the current editor width
- Explorer and editor-tab context menu integration
- Wiki page detection with a toolbar wiki button inside the custom editor for Markdown files inside a `wiki` folder
- Wiki-style `[[page-name]]` links that open other Markdown pages from the same wiki tree
- Keyboard shortcuts for opening the custom editor and returning to the text editor

For the broader editing/rendering feature set exposed by Vditor, see [vditor](https://github.com/Vanessa219/vditor).

## Install

This fork is packaged independently. Install the generated VSIX directly:

```bash
code --install-extension ./artifacts/markdown-editor-extended-settings-0.2.35.vsix

```

## Usage

### Open the custom editor

Use the Explorer right-click context menu on a Markdown file:

- Explorer context menu on a Markdown file

Markdown files no longer auto-switch into the custom editor when opened normally.

### Return to the text editor

Use any of the following while the custom editor is active:

- Command Palette: `markdown-editor: Edit in Text Editor`
- Editor tab title menu
- Shortcut: `Ctrl+Alt+E` on Windows/Linux, `Cmd+Ctrl+E` on macOS
- Toolbar button inside the custom editor

### Wiki links

Markdown files located anywhere under a folder named `wiki` are treated as wiki pages.

- The custom editor toolbar shows a `Wiki` button for recognised wiki files.
- `[[page-name]]` links are rendered as clickable wiki chips inside the custom editor.
- Wiki links resolve against Markdown files under the same `wiki` folder tree.

## Configuration

The fork adds and documents these settings under the `markdown-editor` namespace:

### `markdown-editor.imageSaveFolder`

Controls where uploaded images are stored. The default is `assets`, relative to the current Markdown file.

Supported template variables:

- `${projectRoot}`
- `${file}`
- `${fileBasenameNoExtension}`
- `${dir}`

Examples:

```json
{
	"markdown-editor.imageSaveFolder": "assets"
}
```

```json
{
	"markdown-editor.imageSaveFolder": "${projectRoot}/assets"
}
```

```json
{
	"markdown-editor.imageSaveFolder": "${dir}/${fileBasenameNoExtension}-assets"
}
```

### `markdown-editor.useVscodeThemeColor`

Uses the current VS Code theme background color for the editor surface.

```json
{
	"markdown-editor.useVscodeThemeColor": true
}
```

### `markdown-editor.enableFullWidth`

Enables the fork's full-width layout instead of the narrower centered layout.

```json
{
	"markdown-editor.enableFullWidth": true
}
```

### `markdown-editor.customCss`

Injects custom CSS directly into the webview. This is useful for typography, spacing, or layout overrides.

```json
{
	"markdown-editor.customCss": ".vditor-ir pre.vditor-reset { line-height: 32px; }"
}
```

## Toolbar Extensions

In addition to the standard Vditor controls, this fork adds or customises:

- `Save`
- `Edit In VS Code`
- `Copy Markdown`
- `Copy HTML`
- `Reset config`
- Smarter Markdown link insertion

## Supported Syntax

See the Vditor demo article for the underlying Markdown feature coverage:

[demo article](https://ld246.com/guide/markdown)

## Acknowledgement

- [vscode](https://github.com/microsoft/vscode)
- [vditor](https://github.com/Vanessa219/vditor)

## License

MIT
