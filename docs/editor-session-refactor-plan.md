# EditorSession refactor — plan

Branch: `refactor/editor-session` (separate PR, stacked on `review/solid-srp-kiss`).
Goal: dissolve the ~560-line `MarkdownEditorProvider.resolveCustomTextEditor`
god-method into a focused `EditorSession` class (one instance per open tab) —
fixing the main **SRP** debt and unlocking unit tests of the editor logic.

## Guard rails (verify after EVERY step)

1. `npx tsc --noEmit -p tsconfig.json` → 0
2. `npm run lint:ci` → clean (run `lint:fix` first)
3. `npm test` → all green (the backend tests drive 9 host commands through
   `panel._receiveMessage`, so they exercise the dispatch)
4. `node build.mjs` → builds
5. Commit the step. One step = one commit. If a step goes red, `git checkout --`
   the file and redo smaller.

## Known gotchas (these have already bitten)

- **`wiki` name collision**: `wiki` is both a variable AND an object key
  (`wiki: wikiInit`, `postMessage({..., wiki})`). A blind `\bwiki\b → this.wiki`
  rewrite corrupts the keys. Use `(?<!\.)\bwiki\b(?!\s*:)` or edit by hand.
- **Rename-by-reference**: `activeFsPath`/`activeUri` are reassigned by
  `onDidRenameFiles`; `scheduleDiffInfo` reads `activeFsPath` LAZILY so the diff
  follows a rename. As fields they must stay `this.activeFsPath` read at call
  time — never snapshot into a local that's captured once.
- **`this` binding**: handlers/listeners must be arrow methods or `.bind(this)`,
  else `this` is lost when VS Code invokes the callback.
- **decl-only typed locals** (`let x: T | undefined`) can't be regex-prefixed to
  `this.x: T` — remove the local line; the class field declares the type.
- **Field-declaration insertion** must land between the constructor `) {}` and the
  first method, with correct indentation (the step-2 break was a bad splice here).
- **dispose order**: overlay/watchers/timers/`activePanels.delete` order in
  `onDidDispose` must be preserved 1:1 (same class of bug as `fixDarkTheme`).
- biome rule `noUnusedPrivateClassMembers` does NOT count reads via a destructuring
  pattern (`const { x } = this`). Use explicit `const x = this.x`.

## Steps

- [x] **Step 1 — class skeleton.** Move the whole method body verbatim into
  `EditorSession.start()`; provider just does `new EditorSession(...).start()`.
  HTML builder injected; `_documentRange` moved onto the session. (commit 383b439)

- [x] **Step 2 — promote state to fields.** (commit 7b99e98) Rename-by-reference
  verified intact (scheduleDiffInfo reads this.activeFsPath lazily). The 13 closure vars
  (`activeUri`, `activeFsPath`, `suppressCloseDispose`, `textEditTimer`,
  `applyingWebviewEdit`, `pendingWebviewContent`, `lastSyncedContent`,
  `currentWatcher`, `externalCssWatcher`, `disposables`, `wiki`,
  `workspaceFolder`, `vditorBaseUri`, `panelEntry`) → `private` fields.
  Declarations → `this.x = …`; decl-only typed locals removed; references →
  `this.x` (mind `wiki`). Keep `document`/`webviewPanel` as local aliases.
  Do it in SMALL hand-edits or a guarded script, tsc after each chunk.

- [ ] **Step 3 — closures → methods.** Extract `postUpdate`, `syncToEditor`,
  `schedulePostUpdate`, `postExternalCss`, `postLiveConfig`,
  `refreshExternalCssWatchers`, `setupFileWatcher`, `scheduleDiffInfo` into
  `private` methods reading the fields. `start()` shrinks to: html + state init +
  build watchers + register listeners.

- [ ] **Step 4 — message handlers → methods.** The `messageHandlers` map entries
  become `private on<Command>(message)` methods; the map binds to them. `start()`
  no longer defines handler bodies.

- [ ] **Step 5 — tests (+ optional DI).** Add `test/backend/editor-session.test.ts`
  constructing an `EditorSession` with the vscode-mock and calling handler methods
  directly (assert `applyEdit`/`postMessage`). Optionally inject a `ConfigReader`
  to start paying down the DIP debt (static `config` global).

## Out of scope (future, separate)

- Moving `EditorSession` to its own file `src/editor-session.ts` — blocked on first
  relocating the shared module helpers/statics it uses (else circular import).
  Keep the class in `extension.ts` for now.
- Splitting `_getHtmlForWebview` into `webview-html.ts` (review finding #3).
