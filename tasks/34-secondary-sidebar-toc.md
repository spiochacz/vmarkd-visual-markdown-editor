# Task: TOC / outline in the secondary sidebar

> **Source:** vMark VS Code stable-API audit (secondary-sidebar outline)
> **Value / Risk:** 🟡 navigation feature / medium
> **Engines:** ⚠️ `^1.106` (`viewsContainers.secondarySidebar`) — free under the
> `^1.110` floor if task 33 is taken (see README engines note)

## Goal
A document outline / table of contents in the **secondary** sidebar, so it can sit
opposite the file explorer without stealing primary-sidebar space. Clicking a
heading scrolls the WYSIWYG editor to it.

## Steps
1. `package.json` → contribute a container under
   `contributes.viewsContainers.secondarySidebar` + a `views` entry (TreeView is
   lighter than a webview view for a heading list).
2. Build the outline from document symbols:
   `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)`
   against the active markdown document (built-in MD language features provide them).
   Refresh on `onDidChangeTextDocument` (debounced) and on active-editor change.
3. Wire click → reveal: post a `scroll-to-heading` message to the matching vMark
   webview; the webview scrolls Vditor to the heading. **Reuse / coordinate with the
   DOM→source mapping work** rather than duplicating heading-location logic.
4. Bump `engines.vscode` + `@types/vscode` to `^1.106` (or the task-33 `^1.110` floor).

## See also
- `07-settings-highlight-headings-outline-position.md`, `08-outline-width-show-by-default.md`,
  `13-outline-heading-flash.md` — the existing **in-webview** outline. Decide whether
  this secondary-sidebar TOC **replaces** or **complements** them; do not ship two
  competing outlines. Recommend: pick one outline home before building.
- `15-shared-dom-source-mapping.md` / `16-reveal-in-source.md` — heading↔source mapping.
- `33-themeicon-tab.md` — shared engines bump.

## Open decision
In-webview outline (tasks 07/08/13) vs native secondary-sidebar TOC (this task) —
**these overlap**. Resolve the UX direction before implementation.

## Verify
Open a markdown file with headings → secondary sidebar shows the outline; clicking a
heading scrolls the editor; outline updates as headings change.
