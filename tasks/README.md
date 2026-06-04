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
- [x] [44 — Unify the toolbar/chrome icons on codicons](44-unify-source-button-icons.md) — full codicon restyle: chrome `$(…)`, toolbar via icon-override sprite (24 codicons + 6 codicon-style customs)

## Features
- [x] [13 — Outline navigation + heading flash](13-outline-heading-flash.md)
- [x] [14 — Rename tracking (onDidRenameFiles)](14-rename-tracking.md)
- [x] [15 — Shared DOM→source mapping](15-shared-dom-source-mapping.md) — exact Lute-caret offset (prose too); prerequisite for 16 & 17
- [x] [16 — Reveal-in-Source](16-reveal-in-source.md) — jump to the caret's line in the text editor
- [x] [17 — Git gutters](17-git-gutters.md) — added/modified bars vs git HEAD
- [ ] [49 — Streaming / incremental render for large docs](49-streaming-incremental-render.md) — chunked webview render (approach B) + referenced-only ref injection; kills the multi-second freeze on big files. Benchmarks done, design locked.
- [ ] [46 — Side-by-side rendered diff view](46-rendered-diff-view.md) — two-pane rendered original-vs-modified comparison (inspired by phfsantos fork); not scheduled yet
- [ ] [22 — Image resize (drag handles)](22-image-resize.md) — spike first
- [ ] [23 — Wikilinks resolution](23-wikilinks-resolution.md)
- [ ] [32 — Link/image path autocomplete](32-link-image-autocomplete.md) — findFiles + watcher, no engines bump
- [x] [35 — Status bar (reading time + mode)](35-status-bar-reading-time-mode.md) — reading time + WYSIWYG/Source indicator
- [x] [36 — Tab-group awareness (open-beside / no dup tabs)](36-tabgroups-awareness.md) — dedup vMarkd tabs + open-source-to-side with reuse
- [x] [48 — Line-anchored split-view scroll sync](48-split-view-line-scroll-sync.md) — heading-anchored centre sync in `sv` mode (replaces Vditor's proportional drift)

## Security
- [x] [18 — Security hardening (fs / CSS / CSP / logging)](18-security-hardening.md) — scoped roots, CSS sanitize, CSP+nonce, levelled logging (live-verified)
- [x] [27 — Scope webview privileges (enableCommandUris + stop overwriting options)](27-scope-webview-privileges.md) — augments options; command URIs off (audited postMessage-only)
- [ ] [47 — Render inline-HTML / data-URI images](47-render-inline-html-data-uri-images.md) — Vditor sanitizer strips `<img data:…>` (CSP already allows it); investigate or document as limitation
- [ ] [67 — Webview CSP + Lute Sanitize hardening](67-webview-csp-sanitize-hardening.md) — 🟡 remote script-exec already blocked; close the CSS/image exfil channel (`img-src https:` + inline `style`) + add `frame-src/object-src/base-uri 'none'`; optional esbuild patch adding iframe/embed/base to Sanitize skip-list.

## Marketplace / publication
- [ ] [28 — Extension identity (publisher/name/author/repo)](28-extension-identity.md)
- [x] [29 — Declare capabilities (untrusted / virtual workspaces)](29-capabilities-declaration.md)

## Pro / i18n (engines bump — see note)
- [ ] [30 — Localization (l10n + package.nls.json)](30-localization-l10n.md) — ⏸ **parked** (unblocked; do only if PL UI wanted)
- [ ] [31 — Opt-in telemetry (createTelemetryLogger)](31-opt-in-telemetry.md) — ⏸ **parked** (unblocked; counter to privacy posture)

## Engines-bump features (tradeoff: cuts older VS Code)
- [x] [33 — ThemeIcon on the editor tab](33-themeicon-tab.md) — engines floor now ^1.110
- [ ] [34 — Secondary-sidebar TOC](34-secondary-sidebar-toc.md) — ^1.106; overlaps 07/08/13 (decide outline home)

## Tooling, tests & refactor
- [x] [19 — Replace user-event with native keyboard](19-replace-user-event-native-keyboard.md)
- [x] [20 — Tree-shake Vditor source import](20-tree-shake-vditor-source-import.md) — import from source; main.js 310→261 KB (−16%)
- [x] [21 — Backend tests (vitest)](21-backend-tests-vitest.md)
- [ ] [24 — CI/CD pipeline](24-ci-cd-pipeline.md) — Part A (PR gate `ci.yml`) ✅ done; Part B (single release path / version policy) open
- [x] [45 — Build toolchain (drop foy/ts-node)](45-build-toolchain.md) — landed on plain Node + npm: `build.mjs` run by `node`, no `foy`/`ts-node`/Bun (tried Bun, reverted to minimise tooling)
- [x] [49 — Adopt Biome (lint + format)](49-biome-lint-format.md) — single-tool lint+format, tuned to existing style, wired into CI (`biome ci`)

## Performance (open latency + memory)
- [x] [37 — retainContextWhenHidden memory dial](37-retain-hidden-memory-dial.md)
- [ ] [41 — Bounded retain-cache for hidden webviews (keep N)](41-retain-hidden-webview-cache.md) — ⏸ **parked** (only if dispose-on-hide proves annoying)
- [ ] [38 — Inline init content (skip `ready` roundtrip)](38-inline-init-content.md)
- [ ] [39 — Lean Vditor init (gate renderers on content)](39-lean-vditor-init.md)
- [x] [40 — Drop unused MathJax (~6.5 MB)](40-drop-unused-mathjax.md)
- [x] [42 — Rendering profiling harness](42-rendering-profiling-harness.md) — init-latency investigation; finding in task file
- [ ] [68 — IR edit/paste latency on large docs](68-ir-edit-serialize-perf.md) — 🟢 A (no double serialize) + C2 (widen `undoDelay` for large docs so the super-linear full-doc reserialize fires off the active-typing path) done, unit+e2e. C1 (auto-SV for huge) / C3 (incremental serialize) open.
- [ ] [69 — Incremental IR serialization (C3)](69-incremental-ir-serialize.md) — 🟢🟢/⚠️ re-serialize only the edited block (O(block) not O(doc)) → removes the large-doc edit freeze entirely; high risk (context-sensitive serialization + block remap). Build as fast-path + full-serialize fallback + drift self-heal. Spike first; composes with 61.
- See also: **20** (bundle is 94 % Vditor), **24 §5/§5b** (VSIX trim + Vditor asset-sync hazard), **11** (activation), **18 §2a** (streaming + keep media root)

## Vditor-fork-derived (2026-06-03 fork analysis)
Cross-referenced from a Vditor fork survey against our code. Each task is self-contained (source fork/commit, `file:line` evidence, steps, repro/verify). Listed roughly cheap→large so the decision set is in one place.
- [x] [56 — Vditor `listToggle` bugfixes](56-vditor-listtoggle-bugfixes.md) — null-deref crash fixed (`?.remove()` esbuild patch, unit+e2e+guarded). Sibling-scope **parked by decision**: accept Vditor's whole-list toggle as-is (no per-item split rewrite).
- [x] [57 — KaTeX error resilience](57-katex-error-resilience.md) — `strict:false`/`throwOnError:false` injected via esbuild patch (unit+e2e, in bundle). #1915 is a Lute issue, out of scope.
- [x] [58 — Flush pending edit on Ctrl/Cmd+S](58-flush-pending-edit-on-save.md) — flush posts the live `getValue()` on Ctrl/Cmd+S (e2e caught that Vditor's ~800ms input throttle made "flush-if-pending" still save stale). Unit+e2e.
- [ ] [59 — Live re-theme Mermaid](59-mermaid-live-retheme.md) — 🟡 code follows theme live, mermaid doesn't; completes task 25 (tuanpmt). Medium.
- [ ] [60 — Table-cell space-trimming fidelity](60-table-cell-space-trimming-fidelity.md) — 🟡 leading space before inline markers trimmed in our vendored Vditor (tuanpmt); reproduce first.
- [ ] [61 — Minimal-diff write-back](61-minimal-diff-writeback.md) — 🟢🟢 any edit reserializes the whole doc → noisy git diff; write only changed ranges (tuanpmt). Largest, highest value.

### Bug-hunt (2026-06-03) — confirmed against our `vditor@3.11.2`
Bugs verified to still exist in the Vditor source we ship (`media-src/node_modules/vditor/src/ts/...`), found in fork fix-commits. Each task carries its own `file:line` evidence and repro steps.
- [x] [62 — IR link click is dead in the webview](62-ir-link-click-webview.md) — UX change, now **configurable + aligned** (`vmarkd.editor.linkOpenWithModifier`, default Ctrl/Cmd+click opens, plain click edits) across IR/WYSIWYG/SV via a runtime policy read by the IR+WYSIWYG patches and `fixLinkClick`. ⚠️ Premise was off — not a dead click. Unit+e2e (both modes × both policies).
- [ ] [63 — WYSIWYG tab+text → code block](63-wysiwyg-tab-text-codeblock.md) — 🟡 **paste done** (PR #1921 content-based detection, esbuild patch + e2e — fixes #1917/#1914). Tab-indent case **parked** (CommonMark-correct indented-code; suppressing it is a risky heuristic).
- [ ] [64 — Image empty-alt protective rewrite missing](64-image-empty-alt.md) — 🟡 no `alt=""`→`alt="img"` (GongXunSS); vanish is runtime-dependent — reproduce first.
- [ ] [65 — Repro batch: unverified editing bugs](65-editing-bug-repro-batch.md) — 🟡 WizTeam/Ficus core-handler bugs (backspace-soft-linebreak corruption, code-newline cursor jump, heading-Enter, select-all deselect, …) needing runtime repro → split off fixes.
- _Already fixed upstream (no task):_ code copy-button expanding a collapsed block — `codeRender.ts:48` already has `stopPropagation`.
- **Export (V4):** already tracked as [53 — Export HTML/Markdown](53-export-html-markdown.md). Best technique source: tuanpmt `getFullyRenderedHTML` (standalone HTML, inline CSS/fonts/SVG, awaits mermaid+math).
- Already covered by our architecture (no task needed): offline mermaid/i18n/CDN, host-clipboard, image paste→disk, image paths via `<base href>`, capture-phase key interception, outline focus, IR table popover, live theme.

### Dependency / engine (2026-06-03)
- [x] [66 — Upgrade the Lute markdown engine](66-lute-engine-upgrade.md) — 🟡 vditor ships Lute v1.7.6 (2023); `master` is +515 commits ahead with a `Sanitize` security fix + table/math/inline + direct vditor fixes. API verified compatible (one `New()` signature change). Vendor the prebuilt `lute.min.js` + `build.mjs` step; main risk is round-trip fidelity drift.
