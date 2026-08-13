# 520 — `css.external` never live-reloads (the watcher can never fire)

**Status:** ✅ FIXED 2026-08-13 — bug, found by QA journey · **Impact:** 🟠 a documented feature does nothing:
edit your external stylesheet and the editor ignores it until you reopen the tab ·
**Found:** 2026-08-13 implementing [task 516](516-qa-journey-coverage-plan.md) journey D4.

## Symptom

Point `vmarkd.css.external` at a stylesheet and open a document — the CSS **is** applied at open,
so the feature looks wired. Then edit that stylesheet on disk: **nothing happens**, no matter how
long you wait. Reopening the editor picks up the change.

## Root cause

`resolveExternalCssPaths` (`src/platform/editor-config.ts`) returns **absolute filesystem paths**
(it deliberately resolves workspace-relative entries against the workspace root).

`PanelConfig.refreshExternalCssWatchers` (`src/webview-host/panel-config.ts`) then passes each one
straight to `vscode.workspace.createFileSystemWatcher(p)` — as a plain **string** `GlobPattern`.

VS Code matches a string glob against **workspace-relative** paths. An absolute path (`/home/…/x.css`)
matches nothing, so the watcher never fires. It still *constructs* successfully and returns a
disposable, which is exactly why the wiring reads as correct on inspection and why this survived:
`refreshExternalCssWatchers()` is called at panel open, returns a real disposable, and everything
looks connected.

Watching one specific file requires a relative pattern:

```ts
new vscode.RelativePattern(vscode.Uri.file(path.dirname(p)), path.basename(p))
```

which also works for files **outside** any workspace folder — the case the current code silently
cannot support at all.

## Measured, so nobody re-litigates it

| Leg | Result |
|---|---|
| CSS file inside the opened workspace folder, edited via `fs.writeFileSync` (separate process) | **no reload** |
| Same file, written via `vscode.workspace.fs.writeFile` **from inside the extension host** | **no reload** |
| CSS applied at editor open | works |
| `css.custom` (inline setting, a different mechanism — config-change listener) | works, covered by `settings-live-apply.spec.ts` |

The in-host write is the decisive control: it removes cross-process inotify delivery from the
question entirely. Both legs failing puts the fault in our wiring, not the environment (this was
first suspected to be a WSL2/inotify quirk — it is not).

## Fix — DONE

- [x] Build the watcher from a `RelativePattern` per file, as above (`panel-config.ts`).
- [x] The out-of-workspace case is now reachable too: an absolute path to a stylesheet outside every
  workspace folder is a legitimate configuration (`resolveExternalCssPaths` explicitly supports
  absolute paths) and should also live-reload once the pattern is right.
- [ ] `onDidCreate`/`onDidDelete` (stylesheet created later, or removed) are wired and unit-covered, but not exercised end-to-end — left as follow-up.

## Regression coverage

- `test/vscode-e2e/settings-live-d-tier.spec.ts` → D4 asserts BOTH write legs live-reload. It was
  first landed pinning the broken behaviour (`false`/`false`) and flipped to `true`/`true` by this
  fix, so it is known to fail without it.
- `test/backend/panel-config.test.ts` → asserts the watcher is built from a `RelativePattern`, not
  a bare string. This is the assertion that was MISSING: every other unit test in that file passed
  throughout the bug, because they fire the mock watcher's events directly and so never depended on
  the pattern being able to match anything. The mock now records the pattern for this purpose.

## Verification

- Editing the external stylesheet restyles the open editor without reopening, for a file inside
  the workspace AND one outside it.
- D4's two assertions flipped to `true` and green.
- `css.custom` still applies live (unchanged path, but it shares the post-CSS plumbing).
