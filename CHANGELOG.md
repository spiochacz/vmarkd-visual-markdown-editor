# Changelog

All notable changes to this extension are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow
[SemVer](https://semver.org/). This log covers the **fork** (renamed 2025-12-15);
versions ≤ 0.1.x are inherited from the upstream `zaaack/vscode-markdown-editor`
project and summarized at the bottom.

> Versioning policy: do **not** bump the version per change. Accumulate work under
> `[Unreleased]` and bump once, at release time.

## [Unreleased]

Work accumulated since 0.2.32 — not yet released under a version number.

### Added
- True opt-in default editor for Markdown files (custom editor registered as
  `option`, not forced default).
- Playwright e2e harness covering the 9 table-editing hotkeys (`media-src/e2e/`).

### Changed
- Fix the editor code to fully support Vditor 3.11 (the dependency was already
  bumped to 3.11.2 in 0.2.7; this release makes the integration actually work).
- Replace `@testing-library/user-event` keyboard simulation with a native
  `KeyboardEvent` dispatcher (`media-src/src/table-hotkey.ts`).
- Replace jQuery with native DOM; replace jquery-confirm with a native `<dialog>`.
- Replace lodash with tested native helpers (`debounce`, `deep-merge`).
- Replace date-fns with a native `formatTimestamp` helper.

### Fixed
- Vditor 3.11: provide `customWysiwygToolbar` to stop the init crash.
- Vditor 3.11: drop unsupported Lute reverse renderers and correct lute access.
- Skip the wiki custom renderer for non-wiki files.
- Position the table panel at the clicked cell instead of pinned far-left.
- Remove an unused `t` import in `main.ts`.

### Removed
- Runtime dependencies: jQuery, jquery-confirm, lodash, date-fns,
  `@testing-library/user-event`, `@testing-library/dom`, `@babel/runtime-corejs3`.

### Documentation
- Fork ecosystem analysis consolidated into an actionable task backlog in `tasks/`
  — 23 independently-actionable tasks + `tasks/README.md` (priority order,
  dependencies, status). The intermediate per-fork plan documents were folded into
  these tasks and removed.

> ⚠️ Most backlog features (image resize, Vditor tree-shake, word count, search
> keybinding, code-block line numbers, git gutters, reveal-in-source, etc.) are
> **planned, not yet implemented**. See `tasks/README.md` for status.

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
