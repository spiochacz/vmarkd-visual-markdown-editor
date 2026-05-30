# Visual Markdown Editor (vMarkd)

A standalone fork of [zaaack/vscode-markdown-editor](https://github.com/zaaack/vscode-markdown-editor), substantially extended with new VS Code integration and editor-customisation features.

> 🚧 **Under active development.** The feature set is growing; some planned features are still on the roadmap rather than shipped.

## Demo

![demo](./media/hero.png)

## Features

- WYSIWYG Markdown editing with Vditor, in IR, WYSIWYG, and split-view modes
- Live two-way sync with the underlying Markdown file as either side changes
- Save directly from the editor toolbar
- Copy rendered HTML or raw Markdown from the editor
- Configurable image saving: uploaded, pasted, or drag-dropped images are written to a configurable folder
- Mermaid, KaTeX, Graphviz, ECharts, abc.js, and other Vditor-supported embedded content (with offline/local runtime assets)
- Layout and theme control: follow the active VS Code theme, switch to a full-width layout, and inject custom CSS
- Remembered editor preferences, with a reset action to start fresh
- Extended toolbar actions: copy Markdown, copy HTML, and smarter link insertion
- Responsive tables that follow the current editor width
- Extra table-editing controls in IR mode
- Links opened from the editor are handed off through VS Code
- Explorer and editor-tab context menu integration
- Keyboard shortcut for returning to the VS Code text editor (`Ctrl+Alt+E` / `Cmd+Ctrl+E`)

For the broader editing/rendering feature set exposed by Vditor, see [vditor](https://github.com/Vanessa219/vditor).

## Install

This fork is packaged independently. Install the generated VSIX directly:

```bash
code --install-extension ./artifacts/vmarkd-0.4.4.vsix

```

## Usage

### Open the custom editor

- **Explorer**: right-click a Markdown file → **Open with markdown editor**.
- **Open editor tab**: from a `.md` file, run **Open with…** and pick the markdown editor.
- **Command Palette**: run `markdown-editor: Open with markdown editor`.

### Return to the plain text editor

- Click **Edit In VS Code** in the editor toolbar, or
- press `Ctrl+Alt+E` (`Cmd+Ctrl+E` on macOS), or
- run `markdown-editor: Edit in Text Editor` from the Command Palette.

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
