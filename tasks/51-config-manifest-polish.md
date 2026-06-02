# Task 51 — Config & manifest polish (settings UX)

**Status:** planned

## Problem

A pass over `package.json` config best-practices surfaced a few low-risk Settings-UI
improvements still missing. (Branch `feat/instant-preview-toggle` already did the
related work: prefix-grouped setting IDs `image./editor./theme./css./outline./advanced.`,
`advanced.instantPreview` toggle, and `css.custom` → `editPresentation: multilineText`
+ `markdownDescription`. This task is the remainder.)

## Scope — do

### 1. `enumDescriptions` for `theme.mermaid` (quick win)
The enum has 5 values (`auto`/`default`/`dark`/`forest`/`neutral`) with no per-value
help. Add `enumDescriptions` so the Settings dropdown explains each.
- Do NOT add for `theme.code` (~75 highlight.js styles — would be noise) or
  `outline.position` (left/right — self-evident).

### 2. `minimum`/`maximum` on `outline.width` (quick win)
`type: number`, default 200, no bounds. Add e.g. `"minimum": 100, "maximum": 800`
so the Settings UI validates and nonsense values are rejected.

## Scope — worth it, but needs code (separate, deliberate)

### 3. `scope: "resource"` on `css.custom` / `css.external` / `image.saveFolder`
Lets a repo override these per-project via `.vscode/settings.json` (project-specific
CSS / asset folder). **Requires a code change**: today config is read globally
(`MarkdownEditorProvider.config` = `getConfiguration('markdown-editor')`). For
`resource` scope to actually apply per-file, reads must pass the document URI
(`getConfiguration('markdown-editor', doc.uri)`). Declaring `scope` in package.json
WITHOUT changing the read path is a no-op (still uses the window/default value).
Thread the active document URI through the relevant reads (CSS aggregation,
`getAssetsFolder`) before declaring the scope.

## Scope — optional / defensive

### 4. `extensionKind: ["workspace"]`
Defensive for Remote-SSH / WSL / Dev Containers — the extension reads the local FS
(lute.min.js, images, wiki), so it must run on the workspace side. VS Code usually
infers this for a node extension with `main`, so this is belt-and-suspenders.

## Decided against (don't re-litigate)

- **`advanced.vditorOptions` escape-hatch** (arbitrary Vditor option passthrough):
  rejected. Conflicts with the options we control in `main.ts` (`cdn`, `upload`,
  `i18n`, `mode`, `cache`, `toolbar`, callbacks `after`/`input`/renderers) and the
  `sanitizeVditorOptions` cdn-strip; invites broken-editor support load. YAGNI — add
  a specific flag on demand instead. A whitelisted/sanitized version is possible but
  ~half a day for niche benefit; only if a concrete recurring request appears.
- Renaming setting IDs to prefixes — already done.
- `customCss` multiline editor — already done.
- `onDidChangeConfiguration` live reload — already exists (`postLiveConfig`).

## Minor (probably skip)

- `markdownDescription` on more settings (descriptions already adequate).
- `pattern` on `editor.fontSize` (code already falls back leniently).
- Slimming `activationEvents` (`onCommand`/`onCustomEditor` are redundant in VS Code
  1.74+) — but `manifest.test.ts` asserts their presence, so it'd need a test change
  for marginal gain.

## Verification

`package.json` valid JSON · `manifest.test.ts` green (extend it to assert the new
`enumDescriptions`/bounds) · `tsc` + `biome` + full vitest green.
