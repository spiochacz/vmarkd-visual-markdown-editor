# Task: Settings — highlightHeadings + outlinePosition

> **Status:** ✅ Done. `highlightHeadings` (body attr + CSS) + `outlinePosition` (Vditor `outline.position`). Unit (manifest + init options) + e2e (outline.spec). Shared panel with 08/13.
> **Source:** `masterofarbs-audiodub/better-markdown-editor` — §2
> **Derived from (removed plan):** `better-markdown-editor-port-plan.md`
> **Value / Risk:** 🟡 medium / low

## Goal
Add `markdown-editor.highlightHeadings` (themed background for h1–h6) and
`markdown-editor.outlinePosition` (`left`/`right`). Outline is already in the
toolbar (`toolbar.ts:171`).

## Steps
1. `package.json` → `contributes.configuration.properties`:
   ```jsonc
   "markdown-editor.highlightHeadings": {
     "type": "boolean", "default": false,
     "description": "Apply a themed background/foreground to headings (h1–h6) for easier scanning."
   },
   "markdown-editor.outlinePosition": {
     "type": "string", "enum": ["left", "right"], "default": "right",
     "description": "Which side the outline panel opens on."
   }
   ```
2. `src/extension.ts` → pass to webview (`options:` block, ~`extension.ts:318`):
   ```ts
   highlightHeadings: MarkdownEditorProvider.config.get<boolean>('highlightHeadings'),
   outlinePosition: MarkdownEditorProvider.config.get<string>('outlinePosition'),
   ```
3. `media-src/src/main.ts`:
   - `outlinePosition` → Vditor `outline.position`:
     ```ts
     if (msg.options && msg.options.outlinePosition) {
       defaultOptions = deepMerge(defaultOptions, { outline: { position: msg.options.outlinePosition } })
     }
     ```
   - `highlightHeadings` → body attribute (same pattern as `data-full-width`), on `init`:
     `document.body.setAttribute('data-highlight-headings', msg.options.highlightHeadings ? '1' : '0')`
4. `media-src/src/main.css`:
   ```css
   body[data-highlight-headings="1"] .vditor-reset h1,
   body[data-highlight-headings="1"] .vditor-reset h2 /* … h3–h6 */ {
     background: var(--vscode-textBlockQuote-background);
     padding: 0 .3em; border-radius: 3px;
   }
   ```
5. Rebuild the webview (`foy build`).

## See also
`08-outline-width-show-by-default.md` configures the **same** outline panel —
implement the panel config once.

## Verify
Toggle each setting → headings highlighted; outline opens on the chosen side.
