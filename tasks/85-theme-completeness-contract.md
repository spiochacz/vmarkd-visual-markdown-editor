# Task: Theme-completeness contract + own the content palette

> **Status:** ✅ Done (2026-06-09) — as the **completeness contract**, NOT as "B2".
> The audit found B2 (disabling Vditor's `vditorContentTheme` link) is **ineffective**:
> Vditor's full palette also lives in its base `index.css` (bundled into main.css,
> structural, can't be disabled), so the link is a redundant copy — removing it leaves
> the base palette shadowing. The real fix is the completeness contract: each theme
> explicitly OWNS every rendered element on `.vditor-reset`. Implemented + documented
> (`DEVELOPMENT.md` → "Content-theme completeness contract"), with the genuine bugs it
> surfaced fixed: **`hr` rendered as a light bar on dark themes** (themes set
> `border-color`, but Vditor draws `hr` via `background-color`) and **table row
> backgrounds** inheriting Vditor's github-ish palette (incl. the zebra rule whose
> `tbody`-scoped selector out-specifies the themes'). Per-theme + the contract table
> are covered by e2e (`content-theme.spec.ts` "hr + table row backgrounds").
> **Source:** theme-architecture SOLID analysis (2026-06-09), items "LSP/contract" +
> "B2". After task 84 (registry) the metadata is single-sourced; this addressed the
> *palette* cohesion + the substitutability contract.
> **Value / Risk:** 🟡 cohesion / fidelity — touched every theme file; verified per
> theme against the real webview baseline.

## Update (2026-06-09): now CSS-variable driven
Superseded the per-theme `.vditor-reset … !important` overrides with a clean
**custom-property** approach (the "droga 2" prototype, then full migration). The build
(`build.mjs` → `varifyVditorPalette`) rewrites Vditor's content-theme palette
declarations to `var(--vmarkd-*, <default>)`; `main.css` does the same for its
blockquote-bg neutraliser + dark inline-code rule. Each theme now just sets the
`--vmarkd-*` variables on `body.markdown-body` — **no `!important`, no specificity
matching**. `auto` sets none → Vditor defaults. Contract documented in `DEVELOPMENT.md`
("How content themes control the palette"). The `html-builder` `<link>` reorder stays
(github's verbatim `.markdown-body` rules still win ties by load order).

## Outcome vs the original plan
- **B2 (disable Vditor's content-theme) — DROPPED.** Audit (`media/dist/main.css`):
  `.vditor-reset hr/blockquote/table tr/td/th` + colours are in Vditor's BASE
  `index.css`, duplicated in `content-theme/{light,dark}.css`. Disabling the link
  removes only the duplicate; the base remains. So themes must out-rank Vditor in the
  cascade (the existing reorder + `.vditor-reset … !important` pattern), not rely on
  turning it off.
- **Completeness contract — DONE.** Documented in `DEVELOPMENT.md` (the element table
  + the specificity/inheritance gotchas) and enforced by e2e. `auto` is untouched.
- **Bugs fixed:** dark-theme `hr` light bar (material, vscode-dark); table row +
  zebra backgrounds now owned by every theme (github/material/vscode).

## Problem
1. **No completeness contract (LSP-like).** Themes are not equally complete: github =
   ~309 rules, fully owns its palette; material/vscode = ~16 rules and **silently
   inherit** the rest (tables, kbd, hr, base inline-code) from Vditor's bundled
   `content-theme/{light,dark}.css`. So "a theme" has no defined contract of *what it
   must specify* — the inline-code bug we fixed (material/vscode needed extra
   `!important`) was a symptom.
2. **Palette has 5 owners (low cohesion).** A theme's appearance = theme file +
   `main.css` named-theme bridge + Vditor base + Vditor content-theme + VS Code
   injected default, resolved by cascade ORDER. Fragile (see memory
   `vditor-content-theme-shadows-markdown-body`).

## Goal
A named theme's palette comes from ONE place (its file + the shared bridge), not from
Vditor's content-theme. Then the cascade stops depending on link order/cdn-matching.

## Approach (B2)
1. **Disable Vditor's content-theme when a named theme is active.** `setContentTheme`
   no-ops on an empty path (verified: `media-src/node_modules/vditor/src/ts/ui/setContentTheme.ts`).
   - `media-src/src/vditor-theme.ts` (`setVditorTheme`): pass `cdn`/path = undefined
     when `isNamedTheme(contentTheme)` (registry helper already exists), so live +
     init switching doesn't load Vditor's palette.
   - Vditor `initUI` also calls `setContentTheme(options.preview.theme.current,
     options.preview.theme.path)` — set `preview.theme.path = ''` in
     `vditor-options.ts` when a named theme is active so init no-ops too.
   - `html-builder.ts` prerender `vditorContentTheme` <link>: emit `disabled` when
     `isNamedTheme(contentTheme)` so the teaser doesn't apply Vditor's palette either.
2. **Completeness contract.** Define the properties a theme file MUST set on
   `.vditor-reset` (bg, color, link, h1/h2 border, blockquote, inline code, code
   block, table tr/td/th, hr, kbd). Audit material-dark + vscode-*-modern and fill the
   gaps they currently inherit from Vditor (esp. tables, hr, kbd). github files are
   already complete.
3. Once Vditor's palette is off for named themes, the `html-builder` link **reorder**
   (task 82 follow-up) and most `!important` in the theme files become unnecessary —
   simplify, but keep a regression test first.

## Tests (per AGENTS)
- Extend the e2e "real webview baseline" (`installRealWebviewBaseline`) to assert each
  named theme fully specifies the contract properties (tables, hr, kbd, code) against
  the baseline — i.e. nothing falls back to a Vditor colour.
- Assert `setVditorTheme`/options pass no content-theme path for a named theme.
- Verify `auto` is unchanged (still loads Vditor's content-theme).

## Risk / why deferred
material/vscode currently look correct *because* they inherit Vditor's palette for
unspecified elements. Turning that off without first completing their files = visible
regression (uncolored tables/hr). Do step 2 (audit + fill) BEFORE step 1 (disable),
behind tests, theme by theme.

## See also
- `84-theme-registry.md` — the metadata half (done); `isNamedTheme()` lives there.
- `82-custom-editor-themes.md`; memory `vditor-content-theme-shadows-markdown-body`.
