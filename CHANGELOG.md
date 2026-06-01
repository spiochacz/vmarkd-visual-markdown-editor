# Changelog

All notable changes to this extension are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow
[SemVer](https://semver.org/). This log covers the **fork** (renamed 2025-12-15);
versions ≤ 0.1.x are inherited from the upstream `zaaack/vscode-markdown-editor`
project and summarized at the bottom.

> Versioning policy: do **not** bump the version per change. Accumulate work under
> `[Unreleased]` and bump once, at release time.

## [Unreleased]

Work accumulated since 0.2.32 (the 0.3.x line) — not yet cut into a dated release.

### Added
- Search in the editor: `Ctrl/Cmd+F` wired to the webview find.
- Word count (opt-in `markdown-editor.wordCount`) — live word/character count.
- Outline panel: navigation with click-to-flash, configurable width and side
  (`outlinePosition`), open-by-default, and a heading-level markers toggle.
- Reveal-in-source: "Open source to the side" and the toolbar "open in vs code"
  button jump to the caret's line in the text editor (exact Lute-caret mapping).
- Git gutters: added/modified change bars vs git HEAD in the visual editor.
- Status bar: reading-time estimate + a WYSIWYG/Source mode indicator.
- Open the visual editor to the side (`Open with markdown editor to the side`).
- External CSS files with live reload; `customCss` is injected last so it wins.
- Live theme switching (follows the VS Code colour theme) and live config reload
  (settings apply without reopening the editor).
- Rename tracking — the editor follows files renamed/moved in the workspace.
- Tab-group awareness: dedupe vMarkd tabs and reuse on open-to-side.
- Undo/redo: intercept `Ctrl/Cmd+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` in the webview
  and route them to Vditor's history engine.
- Appearance settings: highlight headings, heading-level markers, code-block line
  numbers, Mermaid theme, toolbar visibility, and a font size that follows VS
  Code's editor size by default.
- Code-block line numbers (opt-in) and a dark-theme code-block style.
- ThemeIcon on the editor tab; declared workspace-trust / virtual-workspace
  capabilities.
- True opt-in default editor for Markdown files (custom editor registered as
  `option`, not forced default).
- Playwright e2e harness covering the 9 table-editing hotkeys (`media-src/e2e/`).

### Changed
- Hide Vditor's preview action bar (`preview.actions: []`) — drops the
  Desktop/Tablet/Mobile device-width switch and the China-specific "copy for
  WeChat 公众号 / Zhihu" buttons, irrelevant in a VS Code markdown editor.
- Unified icons on VS Code codicons: title-bar buttons use `$(markdown)` /
  `$(go-to-file)`; the in-webview Vditor toolbar is restyled to codicons via a
  generated override (24 codicons + 6 codicon-style customs for glyphs codicons
  lack — headings, indent/outdent, inline-code, insert-before/after).
- Split view (`sv`) scroll sync is heading-anchored instead of proportional:
  the section at the centre of the source pane stays aligned with the same
  section in the rendered pane (Vditor's proportional sync drifts).
- Tree-shake Vditor from source — webview bundle main.js ~310→261 KB (−16%).
- Native `KeyboardEvent` dispatch replaces `@testing-library/user-event`.
- Backend tests on vitest (host + pure webview helpers).
- Build toolchain: drop `foy` + `ts-node`; the build is now `node build.mjs`
  (plain Node ESM) with npm as the package manager. (Bun was trialled and reverted
  to keep tooling minimal.)
- Dev dependencies: TypeScript → 4.9.5, `@types/node` → 22 (matches the VS Code
  host's Node 22), vitest + coverage → 4.1.8. Declared `engines.node >=22` + `.nvmrc`.
- Vditor 3.11 integration brought fully working (the dependency is on 3.11.2).
- Minimum VS Code raised to ^1.110.

### Fixed
- Source Control diffs open the built-in **text diff** again instead of the visual
  editor: ship a `configurationDefaults` association routing `git`-scheme markdown
  to `default` (VS Code has no API for "default editor except in diff mode").
- Reveal-in-source: the caret lands on the correct source line (content-matched,
  robust to Vditor reflow) instead of the file start.
- Editing gap: the table panel no longer reserves flow space under the caret.
- Vditor 3.11: provide `customWysiwygToolbar` to stop the init crash; drop
  unsupported Lute reverse renderers and correct lute access.
- Position the table panel at the clicked cell instead of pinned far-left.
- Skip the wiki custom renderer for non-wiki files.

### Security
- Bump `esbuild` 0.21 → 0.28 — clears the dev-server advisory
  (GHSA-67mh-4wv8-2f99; we were never exposed since the e2e harness uses its own
  `http.createServer`, not `esbuild.serve()`). CI now fails on moderate+
  vulnerabilities (`npm audit --audit-level=moderate` gate).
- Hardening: scoped filesystem roots, sanitized custom CSS, CSP + nonce on the
  webview, and levelled logging.
- Scope webview privileges (command URIs off; postMessage-only, audited).

### Performance
- `retainContextWhenHidden` memory dial (`retainHiddenEditors`).
- Drop unused MathJax (~6.5 MB) from the shipped Vditor assets (KaTeX is used).
- Debounce activation; drop the broad `onLanguage` activation event.

### Removed
- Runtime dependencies: jQuery, jquery-confirm, lodash, date-fns,
  `@testing-library/user-event`, `@testing-library/dom`, `@babel/runtime-corejs3`.
- Build tooling: `foy`, `ts-node` (and a brief Bun trial).

### Documentation / packaging
- Fork ecosystem analysis turned into an actionable `tasks/` backlog
  (`tasks/README.md` — priority order, dependencies, status).
- VSIX hygiene: internal docs/tests excluded from the package (455→402 files).
- Adopt Biome (lint + format) — single-tool, tuned to the existing style, gating
  CI (`biome ci`).

## [0.2.32] — 2026-04-17

### Added
- Syntax-highlighting style for Vditor; improved toolbar button click handling.
- Wiki: additional toolbar options and commands; Karpathy-style wiki support.

### Changed
- Remove the wiki status command and its SVG icons.
- Remove the auto-open feature.
- CI: automate Marketplace publishing, build the extension before publish, and
  exclude local secrets from the VSIX package.

### Fixed
- Correct JSON syntax in `package.json`.
- Set `moduleResolution: bundler` in `tsconfig.json`.

## [0.2.25] — 2026-04-15

### Documentation
- Add the wikilinks resolution plan.

## [0.2.24] — 2026-03-30

### Changed
- Remove auto-open.

### Documentation
- Add publishing and updating instructions.

## [0.2.11] — 2026-03-25

### Added
- Handle non-file documents; update the toolbar icon.

### Fixed
- Working-tree handling issues.

## [0.2.10] — 2026-03-19

### Added
- CDN support for Vditor.
- Responsive table adjustments (CSS + utility functions).
- CSS variables for better theming; updated installation instructions.

### Fixed
- Toolbar/command icons.

## [0.2.7] — 2026-03-13

### Added
- Edit button in the editor.

### Fixed
- HTTP link handling.
- Cursor/scroll jumping.

## [0.2.0] — 2025-12-15

First release under the new fork identity.

### Changed
- Fork and rename the project; new project icon; package as VSIX.
- Detach from the upstream source project.

### Added
- Color references (2025-12-16).

---

## Upstream baseline (≤ 0.1.14)

Inherited from `zaaack/vscode-markdown-editor` and contributors. Highlights:

- **0.1.13** (2025-01-06) — fix assets on Windows.
- **0.1.12 / 0.1.11** (2024-07-29) — build fixes; `addCustomCSS` (RobinDev, PR #85);
  `${fileBasenameNoExtension}` for asset paths (kiliansinger, PR #78).
- **0.1.10** (2021-06-24) — fix image save folder.
- **0.1.9** (2021-06-09) — fix open local file link (#17), cannot cut (#16).
- **0.1.8** (2021-06-04) — fix click link.
- **0.1.7 – 0.1.5** (2021-05) — language/tips direction and math fixes.

[Unreleased]: #unreleased
[0.2.32]: #0232--2026-04-17
[0.2.25]: #0225--2026-04-15
[0.2.24]: #0224--2026-03-30
[0.2.11]: #0211--2026-03-25
[0.2.10]: #0210--2026-03-19
[0.2.7]: #027--2026-03-13
[0.2.0]: #020--2025-12-15
