# Tasks — fork analysis backlog

Atomic, independently-actionable tasks. One file = one task. Ordered roughly
quick-wins → larger features.

These tasks are the **single source of truth** — the original per-fork analysis
plans were consolidated into them and removed. Each file is self-contained (source
fork, goal, steps with file refs, verification); the `> Source:` line names the
upstream fork the task derives from.

## Quick wins (low risk, fast)
- [x] [01 — Search Ctrl+F keybinding](01-search-keybinding.md) — ✅ done
- [ ] [02 — Word count](02-word-count.md) — 🟢 one Vditor option
- [ ] [03 — Code-block line numbers (setting)](03-codeblock-line-numbers-setting.md) — 🟢 additive
- [ ] [04 — IR heading-level indicator CSS](04-ir-heading-level-indicator-css.md) — 🟡 cosmetic
- [ ] [05 — Code-block dark-theme CSS](05-codeblock-dark-theme-css.md) — 🟡 cosmetic
- [x] [06 — Table-panel contentEditable fix](06-table-panel-contenteditable-fix.md) — ✅ done

## Settings & polish
- [ ] [07 — highlightHeadings + outlinePosition](07-settings-highlight-headings-outline-position.md)
- [ ] [08 — outlineWidth + showOutlineByDefault](08-outline-width-show-by-default.md)
- [ ] [09 — Toolbar hide setting](09-toolbar-show-setting.md)
- [ ] [10 — Open in Split command](10-open-in-split-command.md)
- [x] [11 — Perf: debounce + drop onLanguage](11-perf-debounce-activation.md) — ✅ done
- [ ] [12 — External CSS files + live reload](12-external-css-live-reload.md)
- [ ] [25 — Live theme switching (follow VS Code theme)](25-theme-live-switch.md) — 🟢 fixes stale-theme bug
- [ ] [26 — Live config reload (onDidChangeConfiguration)](26-live-config-reload.md) — 🟡 pairs with 12

## Features
- [ ] [13 — Outline navigation + heading flash](13-outline-heading-flash.md)
- [ ] [14 — Rename tracking (onDidRenameFiles)](14-rename-tracking.md)
- [ ] [15 — Shared DOM→source mapping](15-shared-dom-source-mapping.md) — prerequisite for 16 & 17
- [ ] [16 — Reveal-in-Source](16-reveal-in-source.md) — needs 15
- [ ] [17 — Git gutters](17-git-gutters.md) — needs 15
- [ ] [22 — Image resize (drag handles)](22-image-resize.md) — spike first
- [ ] [23 — Wikilinks resolution](23-wikilinks-resolution.md)
- [ ] [32 — Link/image path autocomplete](32-link-image-autocomplete.md) — 🟡 findFiles + watcher, no engines bump
- [ ] [35 — Status bar (reading time + mode)](35-status-bar-reading-time-mode.md) — 🟡 shares count with 02
- [ ] [36 — Tab-group awareness (open-beside / no dup tabs)](36-tabgroups-awareness.md) — 🟡 overlaps 10

## Security
- [ ] [18 — Security hardening (fs / CSS / CSP / logging)](18-security-hardening.md) — 2a is the priority
- [ ] [27 — Scope webview privileges (enableCommandUris + stop overwriting options)](27-scope-webview-privileges.md) — needs 18 §2a

## Marketplace / publication
- [x] [28 — Extension identity (publisher/name/author/repo)](28-extension-identity.md) — ✅ manifest done (vmarkd / spiochacz); publisher still needs `vsce login spiochacz`
- [ ] [29 — Declare capabilities (untrusted / virtual workspaces)](29-capabilities-declaration.md) — 🟢 no engines bump

## Pro / i18n (engines bump — see note)
- [ ] [30 — Localization (l10n + package.nls.json)](30-localization-l10n.md) — ⚠️ ~^1.73
- [ ] [31 — Opt-in telemetry (createTelemetryLogger)](31-opt-in-telemetry.md) — ⚪ ~^1.75, only if metrics wanted

## Engines-bump features (tradeoff: cuts older VS Code)
- [ ] [33 — ThemeIcon on the editor tab](33-themeicon-tab.md) — ⚠️ ^1.110 (highest floor — dominates)
- [ ] [34 — Secondary-sidebar TOC](34-secondary-sidebar-toc.md) — ⚠️ ^1.106; overlaps 07/08/13 (decide outline home)

## Performance (open latency + memory)
- [ ] [37 — retainContextWhenHidden memory dial](37-retain-hidden-memory-dial.md) — 🟥 HIGH memory; measure first
- [ ] [38 — Inline init content (skip `ready` roundtrip)](38-inline-init-content.md) — 🟥 HIGH perceived latency
- [ ] [39 — Lean Vditor init (gate renderers on content)](39-lean-vditor-init.md) — 🟧 MED; feeds VSIX trim
- [x] [40 — Drop unused MathJax (~6.5 MB)](40-drop-unused-mathjax.md) — ✅ done (KaTeX-only; guard in Foyfile + test)
- See also: **20** (bundle is 94 % Vditor), **24 §5/§5b** (VSIX trim + Vditor asset-sync hazard), **11** (activation), **18 §2a** (streaming + keep media root)

## Infra / refactor
- [x] [19 — Replace user-event with native keyboard](19-replace-user-event-native-keyboard.md) — ✅ done in 0.2.33
- [ ] [20 — Tree-shake Vditor source import](20-tree-shake-vditor-source-import.md) — separate branch
- [x] [21 — Backend tests (vitest + vscode-mock)](21-backend-tests-vitest.md) — ✅ done (vitest + vscode-mock, 41 tests)
- [ ] [24 — Proper CI/CD pipeline](24-ci-cd-pipeline.md) — PR test gate; one release path; deliberate version bump

## Dependencies between tasks
- **15 → 16, 17** — build the shared mapping module first.
- **07 / 08 / 13** — all touch the same outline panel; implement the panel config once.
- **12 ↔ 18 (2b)** — apply CSS sanitization to external CSS too.
- **12 ↔ 26** — share the `<style>`-swap reload mechanism; do them together.
- **18 §2a → 27** — narrow `localResourceRoots` before augmenting/scoping webview options.
- **25 / 26** — share the "register listener in `resolveCustomTextEditor` + postMessage" pattern.
- **14 → 21** — rename tracking becomes unit-testable once the vscode mock exists.
- **20 → 21** — `bundle-size.test.ts` ships with the tree-shake work.
- **32 ↔ 23** — generalizes the wiki `pageKeys` suggestion plumbing to links/images.
- **34 vs 07/08/13** — secondary-sidebar TOC overlaps the in-webview outline; pick one outline home first.
- **35 ↔ 02** — reading time derives from the word count; share it, don't recompute.
- **36 vs 10** — both add "open beside"; resolve the overlap before building (fold reuse/dedup into 10 or layer it).
- **33 → 30, 31, 34, 18 §2d** — taking ThemeIcon raises the engines floor to `^1.110`, making those bumps free (see Engines floor note).
- **37 ↔ 38** — synchronous init (38) makes dispose-on-hide (37) affordable; pair them.
- **39 → 40** — confirming MathJax is never fetched (KaTeX default) unlocks the 6.5 MB cut.
- **40 ↔ 24 §5** — MathJax drop is the largest item in the VSIX-hygiene cleanup.
- **18 §2a ↔ Vditor cdn** — narrowing roots must keep `media/` (Vditor's local asset base) or rendering breaks.

## Engines floor note
Current `engines.vscode` / `@types/vscode` = `^1.64`. The bump-requiring tasks have
**nested floors**, so the highest one selected sets the manifest minimum and makes
the rest free:

| Task | Min version |
|---|---|
| 30 — l10n | ~^1.73 |
| 18 §2d — LogOutputChannel | ~^1.74 |
| 31 — telemetry | ~^1.75 |
| 34 — secondary sidebar | ^1.106 |
| **33 — ThemeIcon** | **^1.110 (dominant)** |

If task **33** ships, set `engines`/`@types/vscode` to `^1.110` **once**; tasks 30, 31,
34, and 18 §2d then need no further bump. Verify the ~1.73/1.74/1.75 numbers against
the API docs before committing.

## Deferred / watch (blocked on upstream)
- **Visual Markdown diff** — `customEditorDiffs`
  (`resolveCustomEditorInlineDiff` / `…SideBySideDiff`), `documentDiff`
  (`workspace.getTextDiff`), and `diff/mergeEditorPriority` are **proposed API**, which
  the Marketplace rejects (`enabledApiProposals` is disallowed). The most attractive
  direction (WYSIWYG diff) is out of reach until these finalize. Watch
  [microsoft/vscode#138525](https://github.com/microsoft/vscode/issues/138525) and
  [#315174](https://github.com/microsoft/vscode/issues/315174); revisit when stable.

## Not split out (decisions carried over from the analysis)
- **aqz236 §5 (bun / i18n / restructure)** — "not a standalone task"; fold in
  organically. Skip bun (conflicts with task 20's esbuild `build.mjs`).
- **aqz236 §3 outline / better-md §2 outlinePosition** — merged into tasks 07 + 08.
- **Encoding / Text Encodings API (1.100)** — **not needed.** The editor persists via
  `WorkspaceEdit`/`applyEdit` + `document.save()` and reads via `document.getText()`,
  so VS Code already honors the document encoding (no `fs.writeFile(string)` path
  exists). Only revisit if new wiki pages must inherit a non-UTF-8 sibling encoding.
- **navigator/Node 22 (1.101), require.main/allocator (1.94)** — no env-detection in
  code; `sharp` is dev-only → not applicable.
- **Export HTML, image-folder picker (`showOpenDialog`), QuickPick `prompt` (1.108),
  side-by-side `supportsMultipleEditorsPerDocument`** — reviewed, deliberately not
  scheduled this round.
