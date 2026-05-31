# Task: Code-block styling in dark theme (CSS + hljs)

> **Status:** ✅ Done. Dark code theme → `github-dark`, light → `github`
> (explicit matched pair in init + setTheme); dark code-block preview
> bottom-padding fix. `media-src/src/main.ts` + `media-src/src/main.css`.
> **Source:** `Inferno214221/vscode-markdown-editor` — quick-fixes §5
> **Derived from (removed plan):** `quick-fixes-and-hardening-plan.md`
> **Value / Risk:** 🟡 cosmetic / none. Adopt only if you prefer the look.

## Goal
Optionally improve dark-theme code-block appearance. We currently set
`hljs.style: 'atom-one-dark-reasonable'` only in the dark branch (`main.ts:38-40`).

## Steps (optional, taste-based)
1. Switch the dark hljs style to `github-dark` (compare both).
2. `media-src/src/main.css` — fix dark code-block preview padding:
   ```css
   .vditor--dark .vditor-reset pre.vditor-ir__preview code { padding-bottom: 9.9px; }
   ```
3. Rebuild the webview (`foy build`).

## Verify
Dark-theme code blocks render with the preferred style/padding.
