# Task: Image resize (drag handles)

> **Status:** 📋 TODO — spike-first, separate branch.
> **Source (original):** `aqz236/vscode-markdown-editor` — their unique feature.
> - File: [`media-src/src/features/image/imageResize.ts`](https://github.com/aqz236/vscode-markdown-editor/blob/master/media-src/src/features/image/imageResize.ts) (~609 LOC)
> - Introduced in commit [`227a6cd`](https://github.com/aqz236/vscode-markdown-editor/commit/227a6cd47f97ce18089dfec966a6eba4e4fc9343) (`feat(image): 添加图片调整大小功能` — "add image resize"); also touches `core/editorInit.ts`, `main.ts`, `styles/main.css`, `custom.d.ts`.
> - Later refined in [`b2aabae`](https://github.com/aqz236/vscode-markdown-editor/commit/b2aabaea8010e2ec15330f792410d5d8d7a5990b), [`582fe8d`](https://github.com/aqz236/vscode-markdown-editor/commit/582fe8d17507dd111da7dcfee4af93d804f24e4c), [`df77f30`](https://github.com/aqz236/vscode-markdown-editor/commit/df77f304dbde4a2e9f791e6e18104f820cb35f7a) (size-adjust tuning + scrollbar/display polish).
> **Derived from (removed plan):** `aqz236-port-plan.md` §1
> **Value / Risk:** 🟢 high / unique — medium-high (DOM-heavy, no automated coverage)
>
> ⚠️ **Don't copy verbatim** — aqz236 calls `setValue()` on every resize-end (full re-render).
> See §1a for the in-place-DOM rewrite that fits vMarkd's two-way sync.

Take the idea, rewrite the two weak spots. **Spike first**, separate branch.
Gate behind setting `markdown-editor.imageResize` (default **off**).

## 1a. Persistence — avoid `setValue()` full re-render
aqz236 calls `setValue()` on every resize-end → full re-render. We have two-way sync
(`extension.ts`: `applyingWebviewEdit`, `pendingWebviewContent`, `lastSyncedContent`).
Plan: on resize-end set the `<img>` `width`/`height` attributes **in the DOM in
place**, let Vditor's normal `input` flow + our debounced `edit` sync to source — no
`setValue()`.

> ⚠️ **Spike before building UI:** does Lute serialize an inline `<img width height>`
> back into `getValue()` round-trip-stably on 3.11? If it strips attributes, fall
> back to writing source ourselves via `applyEdit` (extension side), still no `setValue`.

## 1b. Markdown syntax
Markdown has no native width syntax. **Recommendation: A** — rewrite to HTML
`<img src alt width height>` (works everywhere), gated behind the `imageResize`
setting so users wanting pristine `![]()` aren't surprised by HTML tags.

## 1c. UI
Port the 8-direction handle overlay + `MutationObserver` rebinding. Constrain to the
active mode element (`vditor.vditor[currentMode].element`), not hard-coded
`.vditor-ir`. Keep aspect-ratio locking on corner handles. New module
`media-src/src/features/image-resize.ts` + CSS in `main.css`.

## Verify
Manual test across IR/WYSIWYG/SV; must survive mode switches and content updates.
No automated coverage (DOM-drag behavior).
