# Task: Single-source theme registry (collapse scattered theme metadata)

> **Status:** ✅ Done (2026-06-09). `src/theme-registry.ts` is the single source of
> truth (`CONTENT_THEMES` + `resolveFontSize`/`autoCodeStyle`/`themeDef`), imported by
> BOTH build units (host directly; webview via `../../src/theme-registry`, esbuild
> bundles it inline). Rewired: `CONTENT_THEME_FILES`, `effectiveThemeKind`,
> `resolveFontSizeCss` (now an alias), `codeHljsStyle`, `resolveFontSize` (the host↔
> webview duplicate is gone), and a manifest↔registry sync test. Shipped together with
> the Vditor theme-API adapter (`media-src/src/vditor-theme.ts`, DIP) and the main.css
> "named content-theme bridge" comment cohesion pass. Adding a theme = one row + the
> CSS file. Remaining SOLID work (theme-completeness contract + disabling Vditor's own
> palette) split out to **task 85**.
> **Source:** theme-architecture analysis (2026-06-09, task 82 follow-up). Adding a
> content theme used to mean editing ~6 places that each held a slice of the same
> theme knowledge; they drifted (e.g. a theme added without its code-pairing or
> dark/light classification).
> **Value / Risk:** 🟡 maintainability / **medium** — host + webview are separate
> bundles; the registry lives in `src/` (dependency-free) so both reach it.

## Problem
Theme knowledge is spread across (and must be kept in sync by hand):

| Location | What it holds |
|---|---|
| `package.json` `vmarkd.theme.content` enum + enumDescriptions | the list of values |
| `src/html-builder.ts` `CONTENT_THEME_FILES` | value → CSS file |
| `src/extension.ts` `effectiveThemeKind()` | dark/light classification |
| `media-src/src/vditor-options.ts` `codeHljsStyle()` | `auto` code-theme pairing |
| `src/extension.ts` `resolveFontSizeCss()` + `media-src/src/live-config.ts` `resolveFontSize()` | GitHub 16px default |
| `src/html-builder.ts` `bodyClass` | (now `!== 'auto'`, but historically github-only) |

Adding a theme = touch all of them; forgetting one is a silent bug (wrong code
theme, wrong dark/light mode, wrong default size).

## Goal
One declarative table is the single source of truth; every site above reads from
it. Adding a theme = one row.

```ts
// shared module (reachable by BOTH the host tsc build and the media-src esbuild build)
export interface ThemeDef {
  value: string
  file: string            // media/markdown-themes/<file> (CONTENT_THEME_FILES)
  mode: 'dark' | 'light'  // effectiveThemeKind
  code?: string           // codeHljsStyle pairing for an `auto` code theme
  fontDefault?: number    // resolveFontSize default (e.g. 16 for github), else editor size
  description: string     // package.json enumDescription
}
export const CONTENT_THEMES: ThemeDef[] = [ /* one row per theme */ ]
```

Derive from it: `CONTENT_THEME_FILES`, `effectiveThemeKind`, `codeHljsStyle`,
`resolveFontSize*`, and (ideally) a generator/validator for the `package.json`
enum + enumDescriptions so the manifest can't drift from the registry.

## Investigate (decide during implementation)
1. **Shared-module placement.** Host (`src/`, tsc/CommonJS) and webview
   (`media-src/`, esbuild/ESM) are separate build units that today duplicate
   logic precisely because they can't import each other (see the twin
   `resolveFontSizeCss`/`resolveFontSize`). Options: a small `shared/` dir included
   in both tsconfig/esbuild entry resolution; or a generated constants file. Confirm
   the build (`node build.mjs`) picks it up in both bundles.
2. **package.json sync.** Either generate the enum block from the registry at build
   time, or add a unit test that asserts the manifest enum === registry values (cheap,
   no build step). Prefer the test.
3. **Keep the per-theme CSS files** (`media/markdown-themes/*.css`) as-is — the
   registry is metadata, not styling.

## Tests (per AGENTS)
- Unit: each derived function (`effectiveThemeKind`, `codeHljsStyle`,
  `resolveFontSize*`) returns the registry's value for every theme; manifest enum
  matches registry; an unknown theme falls back sanely.
- No new e2e needed (behaviour unchanged) — the existing theme e2e proves the
  derived output still renders correctly.

## Non-goals
- Disabling Vditor's bundled content-theme for named themes (separate, deferred —
  see analysis "B2"): current reorder + per-file overrides work and are tested.

## See also
- `82-custom-editor-themes.md` — the feature whose growth created the duplication.
- Memory: `vditor-content-theme-shadows-markdown-body` — the cascade the registry
  does NOT change (it only centralises metadata).
