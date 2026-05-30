# Task: Backend tests — vitest + vscode-mock

> **Source:** `masterofarbs-audiodub/better-markdown-editor` — §5 (SELECTED)
> **Derived from (removed plan):** `better-markdown-editor-port-plan.md`
> **Value / Risk:** 🟢 covers untested `extension.ts` / low-medium
>
> **Status (2026-05-30):** ✅ **Done** — shipped on `main` (PR #7). vitest +
> `test/backend/vscode-mock.ts`; 41 unit tests green (`npm test`); `extension.ts`
> ~51%, `wiki.ts` ~23%. `test:coverage` (v8) added. Playwright e2e untouched.
> Only the "+rename" part of step 5 is deferred → handled in task 14.

## Runner decision
better-markdown-editor's suite assumes **vitest** (`vscode-mock.ts` imports `vi`).
We run **node:test (unit) + Playwright (e2e)**. **Adopt vitest and consolidate** —
move our few `node:test` unit files (utils, debounce, deep-merge, format-timestamp)
into vitest. End state: **vitest (all unit) + Playwright (e2e)** — two runners.
Add `vitest`, `jsdom` devDeps + `test/vitest.config.ts`.

## Portability of their files
| File | Portability |
|---|---|
| `test/backend/vscode-mock.ts` (3.6 KB) | 🟢 Copy + extend. Add surfaces our provider touches: `tabGroups`, `onDidRenameFiles`, `createFileSystemWatcher`, `RelativePattern`, `TabInputText/Custom`. |
| `test/backend/manifest.test.ts` (2.3 KB) | 🟢 Copy almost as-is. Adjust to viewType `markdown-editor.editor` + our settings. Highest value / lowest cost. |
| `test/backend/webview-html.test.ts` (4.1 KB) | 🟡 Rewrite against our `_getHtmlForWebview` (base href, CSP, vditor icon script, customCss). |
| `test/backend/extension.test.ts` (11.7 KB) | 🔴 Rewrite from scratch for `resolveCustomTextEditor`: two-way sync guards (`applyingWebviewEdit`, `pendingWebviewContent`, `lastSyncedContent`), `ready`/`edit`/`save`, wiki init. |
| `test/backend/dispose.test.ts` (5.1 KB) | 🔴 Rewrite. Our equivalent: `onDidDispose` clears `textEditTimer` + drains `disposables` (`extension.ts:499-507`). |

## Steps
- [x] 1. Add `vitest` + `jsdom` devDeps, `test/vitest.config.ts`, `test`/`test:watch`
  scripts. (+`@vitest/coverage-v8` and `test:coverage`.)
- [x] 2. Copy + extend `vscode-mock.ts` for our provider's API surface.
- [x] 3. Copy `manifest.test.ts`, adapt (quick win).
- [x] 4. Migrate existing `node:test` unit files to vitest (consolidate).
- [x] 5. Write new `extension`/`dispose` tests against `MarkdownEditorProvider`.
  Rename tests (the "+rename" sub-item) deferred → task 14.
- [x] 6. Keep Playwright e2e untouched.

## See also
- `14-rename-tracking.md` — directly unit-testable here (fake `onDidRenameFiles`).
- `20-tree-shake-vditor-source-import.md` — take `test/perf/bundle-size.test.ts` with it.

## Verify
- [x] `npm test` (vitest) green — 41 tests.
- [x] existing e2e untouched and passing — 34 tests (19 table + 15 behaviours).
