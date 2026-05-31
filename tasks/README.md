# Tasks — backlog

Atomic, independently-actionable tasks. One file = one task. Ordered roughly
quick-wins → larger features. Each file is self-contained (source fork, goal,
steps with file refs, verification).

**This index is informative.** Each task file is the **single source of truth for
its own status** — open the task file for progress/partial detail. A box is
checked here **only when the task is fully complete**.

## Quick wins (low risk, fast)
- [x] [01 — Search Ctrl+F keybinding](01-search-keybinding.md)
- [x] [02 — Word count](02-word-count.md)
- [x] [03 — Code-block line numbers (setting)](03-codeblock-line-numbers-setting.md)
- [x] [04 — IR heading-level indicator CSS](04-ir-heading-level-indicator-css.md)
- [x] [05 — Code-block dark-theme CSS](05-codeblock-dark-theme-css.md)
- [x] [06 — Table-panel contentEditable fix](06-table-panel-contenteditable-fix.md)

## Settings & polish
- [x] [43 — Unify editor font size with VS Code](43-unify-font-size-with-vscode.md) — `fontSize` setting follows VS Code's editor size by default
- [x] [07 — highlightHeadings + outlinePosition](07-settings-highlight-headings-outline-position.md)
- [x] [08 — outlineWidth + showOutlineByDefault](08-outline-width-show-by-default.md)
- [x] [09 — Toolbar hide setting](09-toolbar-show-setting.md)
- [x] [10 — Open in Split command](10-open-in-split-command.md) — open the visual editor beside (ViewColumn.Beside)
- [x] [11 — Perf: debounce + drop onLanguage](11-perf-debounce-activation.md)
- [x] [12 — External CSS files + live reload](12-external-css-live-reload.md)
- [x] [25 — Live theme switching (follow VS Code theme)](25-theme-live-switch.md)
- [x] [26 — Live config reload (onDidChangeConfiguration)](26-live-config-reload.md) — pairs with 12

## Features
- [x] [13 — Outline navigation + heading flash](13-outline-heading-flash.md)
- [x] [14 — Rename tracking (onDidRenameFiles)](14-rename-tracking.md)
- [ ] [15 — Shared DOM→source mapping](15-shared-dom-source-mapping.md) — prerequisite for 16 & 17
- [ ] [16 — Reveal-in-Source](16-reveal-in-source.md) — needs 15
- [ ] [17 — Git gutters](17-git-gutters.md) — needs 15
- [ ] [22 — Image resize (drag handles)](22-image-resize.md) — spike first
- [ ] [23 — Wikilinks resolution](23-wikilinks-resolution.md)
- [ ] [32 — Link/image path autocomplete](32-link-image-autocomplete.md) — findFiles + watcher, no engines bump
- [x] [35 — Status bar (reading time + mode)](35-status-bar-reading-time-mode.md) — reading time + WYSIWYG/Source indicator
- [x] [36 — Tab-group awareness (open-beside / no dup tabs)](36-tabgroups-awareness.md) — dedup vMarkd tabs + open-source-to-side with reuse

## Security
- [ ] [18 — Security hardening (fs / CSS / CSP / logging)](18-security-hardening.md) — §2a is the priority
- [x] [27 — Scope webview privileges (enableCommandUris + stop overwriting options)](27-scope-webview-privileges.md) — augments options; command URIs off (audited postMessage-only)

## Marketplace / publication
- [ ] [28 — Extension identity (publisher/name/author/repo)](28-extension-identity.md)
- [x] [29 — Declare capabilities (untrusted / virtual workspaces)](29-capabilities-declaration.md)

## Pro / i18n (engines bump — see note)
- [ ] [30 — Localization (l10n + package.nls.json)](30-localization-l10n.md) — ~^1.73
- [ ] [31 — Opt-in telemetry (createTelemetryLogger)](31-opt-in-telemetry.md) — ~^1.75, only if metrics wanted

## Engines-bump features (tradeoff: cuts older VS Code)
- [x] [33 — ThemeIcon on the editor tab](33-themeicon-tab.md) — engines floor now ^1.110
- [ ] [34 — Secondary-sidebar TOC](34-secondary-sidebar-toc.md) — ^1.106; overlaps 07/08/13 (decide outline home)

## Tooling, tests & refactor
- [x] [19 — Replace user-event with native keyboard](19-replace-user-event-native-keyboard.md)
- [ ] [20 — Tree-shake Vditor source import](20-tree-shake-vditor-source-import.md)
- [x] [21 — Backend tests (vitest)](21-backend-tests-vitest.md)
- [ ] [24 — CI/CD pipeline](24-ci-cd-pipeline.md)

## Performance (open latency + memory)
- [x] [37 — retainContextWhenHidden memory dial](37-retain-hidden-memory-dial.md)
- [ ] [41 — Bounded retain-cache for hidden webviews (keep N)](41-retain-hidden-webview-cache.md)
- [ ] [38 — Inline init content (skip `ready` roundtrip)](38-inline-init-content.md)
- [ ] [39 — Lean Vditor init (gate renderers on content)](39-lean-vditor-init.md)
- [x] [40 — Drop unused MathJax (~6.5 MB)](40-drop-unused-mathjax.md)
- [x] [42 — Rendering profiling harness](42-rendering-profiling-harness.md) — init-latency investigation; finding in task file
- See also: **20** (bundle is 94 % Vditor), **24 §5/§5b** (VSIX trim + Vditor asset-sync hazard), **11** (activation), **18 §2a** (streaming + keep media root)
