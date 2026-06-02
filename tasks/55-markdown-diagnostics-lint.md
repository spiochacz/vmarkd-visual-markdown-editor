# Task 55 — Markdown diagnostics / lint (Problems + squiggles in WYSIWYG)

**Status:** planned (idea — needs design before building)

## Origin

Spotted in the `phfsantos/vscode-markdown-editor` fork (branch
`feature/vscode-obsidian-release`, an "Obsidian-like" rebuild). It adds a markdown
linter in two halves:

- **Host** `src/diagnostics/MarkdownDiagnosticProvider.ts` (~5 KB): a
  `languages.createDiagnosticCollection('markdown-editor')` that scans the document
  on open/change and emits diagnostics (squiggles in the text editor + the Problems
  panel) for: broken links, malformed table rows, missing image alt-text.
- **Webview** `packages/media/src/diagnostic-visualizer.ts` (~88 KB!): a
  `DiagnosticVisualizer` that mirrors those diagnostics *inside* the Vditor WYSIWYG
  surface — underlining the offending token/span, with tooltips/quick-fixes, token→
  span caching, overlap tracking, and a lot of "focus-aware" machinery to avoid
  moving the caret while the user types.

The idea is good: surface markdown problems both the normal VS Code way AND in the
visual editor. **Do not copy their implementation** — borrow the concept, write our
own (see "Why not port theirs").

## Why not port theirs

- **Host is naive.** `isValidFilePath()` always returns `true` (their own comment:
  "you could add actual file existence check here"), so the broken-link rule never
  catches actually-missing files — only malformed URLs. The table rule
  (`cells.length < 3`) false-positives on any line containing a single `|` (prose
  `a | b`, inline code, separator rows). The "debounce" is a bare `setTimeout(…,500)`
  with no `clearTimeout`, so every keystroke schedules another full re-analysis.
- **Webview is over-engineered.** 88 KB of defensive code ("CRITICAL: prevent
  overlapping", "prevent cursor jumping", hashing to skip re-applies) — the inherent
  pain of decorating a `contenteditable`. We can do far less.

## Scope (proposed — design first)

### Part A — host-side lint → DiagnosticCollection (the valuable half)
- A `MarkdownLintProvider`: one `DiagnosticCollection`, fed from a set of **pure,
  unit-testable rule functions** `(text, uri) => Diagnostic[]`.
- Real rules, not heuristics:
  - **broken relative link / image** — resolve `[..](path)` / `![..](path)` against
    the doc dir and actually `fs.stat` it (file scheme + trusted only; skip
    http(s)/anchors/mailto). This is the rule with real value.
  - **missing image alt-text** — `![](...)` empty alt → Information (a11y). Cheap,
    accurate.
  - Reuse our existing markdown parse (Lute / `lute-host.ts`) or a token pass rather
    than line regexes, so tables/links inside code fences aren't flagged.
- Scope to our docs: gate on the custom editor / supported extensions, debounce
  **properly** (cancel the prior timer), and only for `file`-scheme + trusted (matches
  `ensureCanWriteFiles` posture). Live-config flag `vmarkd.lint.enable` (default ?).

### Part B — mirror squiggles into the WYSIWYG editor (optional, harder)
- Only after Part A. Drive it off our existing `media-src/src/source-map.ts`
  (offset↔block↔line) so a diagnostic's range maps to a block/inline span — much
  lighter than their 88 KB visualizer.
- Underline the mapped span (a class + tooltip), recompute on the same
  `config-changed` / content-update path. Must not disturb the caret (the hard part —
  why Part B is optional and second).

## Out of scope / decisions to make

- Full markdownlint rule set (heading levels, list style, line length, …) — separate,
  larger; this task is link/image/a11y correctness, not style.
- Quick-fixes / code actions — defer; diagnostics first.
- **Decide:** is Part A even wanted given users already get the Problems panel from
  other markdown extensions? The differentiator is Part B (lint in the *visual*
  editor), which is also the expensive half. Sequence accordingly.

## Verification

- Unit: each rule fn over fixtures (broken vs ok link, missing vs present alt, link
  inside a code fence is NOT flagged, table row not mis-flagged).
- Backend: provider sets/clears the collection on open/change/close; debounce cancels.
- (Part B) e2e: a known-broken link gets an underline on the right block; typing
  doesn't move the caret.
- `tsc` + `biome` + full vitest (+ Playwright for Part B) green.
