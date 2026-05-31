# Task: Unify editor font size with VS Code

> **Status:** ✅ Done. Setting `markdown-editor.fontSize` (`"editor"` default →
> follows `--vscode-editor-font-size`, `"vditor"` → 16px, or a px number). Driven
> live via `--me-font-size` (resolveFontSize / applyBodyOptions) + a `.vditor-reset`
> rule; headings scale (em-relative). Unit + e2e covered.
> **Source:** user request (2026-05-31) — editor text reads larger than the rest
> of VS Code.
> **Value / Risk:** 🟡 visual consistency / low (CSS, opt-out-able).
> **Engines:** none.

## Problem
Vditor sets a fixed content font size — `.vditor-reset { font-size: 16px }`
(`media/vditor/dist/index.css`). VS Code's editor/UI font is typically smaller
(~13–14px), so markdown text in the editor looks **bigger** than everywhere else
in VS Code. We already make the **font family** follow VS Code
(`.vditor .vditor-reset { font-family: var(--vscode-editor-font-family) }` in
`main.css`) — this completes the pairing for **size**.

Headings are `em`-relative (`h1 1.75em … h6 1em`), so they scale automatically
once the base size changes — no per-heading work.

## Goal
Make the editor's base font size follow VS Code, so content matches the rest of
the UI. Keep it configurable (some users may want the larger reading size).

## Approach (decide during implementation)
1. **Follow VS Code (recommended default).** `media-src/src/main.css`:
   ```css
   .vditor-reset { font-size: var(--vscode-editor-font-size, 14px) !important; }
   ```
   (`--vscode-editor-font-size` is injected into the webview; fall back to
   `--vscode-font-size` / a literal.)
2. **Setting** `markdown-editor.fontSize` — e.g. `"editor"` (follow VS Code) |
   `"vditor"` (keep Vditor's 16px) | a number (explicit px). Wire host→webview
   like the other options (body attr or CSS var). Default `"editor"`.
3. Confirm code blocks / inline code (which may set their own size) stay sensible
   relative to the new base.

## Tests (per AGENTS)
- **Unit:** manifest setting (if added) + init option passes through.
- **E2e:** computed `.vditor-reset` font-size follows the configured value (set
  `--vscode-editor-font-size` in the harness, assert the reset picks it up).

## Verify
Editor text size matches VS Code's editor font; headings scale proportionally;
toggling the setting switches between VS Code size and Vditor's default.
