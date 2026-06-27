# Task 151 — Type-safe & fail-loud host↔webview boundary

> **Status:** 📋 TODO — created 2026-06-24 from a multi-agent whole-system architecture review.
> The dominant *systemic* pattern across lanes (typed-by-declaration, not by-enforcement; failures
> silent across the seam).
> **Source:** architecture review (2026-06-24), types/errors/state lanes, adversarially verified.
> **Value / Risk:** 🟠 turns silent cross-seam breakage into compile/CI/Output-channel signals / low —
> typing + error-routing, behaviour-preserving for the happy path.
>
> **🟢 In progress 2026-06-27 — items 1, 2, 3, 4, 7 DONE (with tests, all gates green):**
> - **1 (typed protocol):** SSOT moved to `src/protocol.ts` (host imports `./protocol`, webview
>   `../../src/protocol` — same cross-tree pattern as `mermaid-palettes`). Completed `HostMessage`
>   (`config-changed.theme`, `wiki-update.displayNames`) + new `WebviewMessage` union + `VsCodeApi`.
>   Both dispatch maps are keyed by the discriminant (`Extract<>` per command), every handler dropped
>   `any`, both dispatchers log an unhandled command. `copy-html`/`copy-markdown` declared as the
>   host side of planned task 53 (kept, not deleted).
> - **2 (fail-loud write-back):** `syncToEditor` checks `applyEdit`'s boolean — on `false` it does NOT
>   advance `lastSyncedContent`, clears `pendingWebviewContent`, `debug()`s + `showError`s.
>   `onDidReceiveMessage` wrapped in try/catch → Output channel + showError. `document.save()` guarded.
> - **3 (observability pipe):** `media-src/src/webview-log.ts` (`logToHost`/`reportError`) posts
>   `{command:'log'|'error'}`; wired at the init-failure catch, the task-69 drift warn, the dispatch
>   else-branch, and the faithful-fallback helper (replacing `console.*`).
> - **4 (shared config type):** `VmarkdConfigOptions` in protocol.ts; `collectConfigOptions` annotated;
>   `lastInitMsg`/`initVditor` typed (`InitPayload`); `live-config.BodyOptions` derived via `Pick<>`.
> - **7 (faithful fallback):** `media-src/src/faithful-render.ts` (`faithfulRender`) renders into an
>   offscreen-attached stage and swaps into the wrapper ONLY on success; on failure keeps raw source +
>   stamps `data-<lang>-error` + logs. Applied to wavedrom + vega (were clear-before-render → blanked
>   on a throw). Tests: `faithful-render.test.ts` (3), `webview-log.test.ts` (4).
>
> **🟢 Item 5 DONE 2026-06-27:** elkjs ships NO `.d.ts`, so hand-wrote the minimal ELK JSON-graph
> interfaces (`ElkNode`/`ElkEdge`/`ElkPort`/`ElkLabel`/`ElkEdgeSection`/`ElkPoint`/`ElkInstance`) in
> `elk-layout.ts` and replaced every `any` in the graph build/walk; typed `d2-wasm.ts`'s window
> boundary (`Go`/`d2compile`) + the compile result (`D2CompileFn`/`D2CompileResult`). `d2-render.ts`
> was already `any`-free (cleared by the earlier typecheck pass). All three d2 files now carry zero
> `any` types; `any` survives only at the (narrowed-on-read) window global. Typecheck + build + 929
> unit + lint all green.
>
> **⏳ Remaining — item 6 only:**
> - **6 (strict flags) — BLOCKED as written:** flipping `strictNullChecks`+`noImplicitAny` on the
>   media-src program yields **~1688 errors of which ~1550 are in Vditor's own source** (`vditor/src/index`
>   is imported AS SOURCE, so it gets checked). Our files only have ~25-30. So a global flip is
>   impractical; needs a design decision (a scoped sub-config that stubs the Vditor import, or
>   opportunistic per-file fixes without the global flag). Deferred pending that decision.

## Findings → work items

### 1. 🟠 Typed message protocol is unenforced AND stale at both `postMessage` seams
`protocol.ts:3-20` declares an 8-variant `HostMessage` union, but every handler is `(msg:any)`
(`main.ts:973,1016,1123,1232,1238,1260,1266,1281`) and the map is `Record<string, …>` — `any` is
bivariant so narrowing is **never exercised**. The union has already **drifted from the wire**:
`config-changed.theme` (sent `extension.ts:825`, read `main.ts:1175`) and `wiki-update.displayNames`
(sent `extension.ts:871`, read `main.ts:1306-1308`) are absent from the type. There is **no
`WebviewMessage` type** for the outbound direction (`vscode:any` at `utils.ts:15,18`); host dispatch is
also `Record<string,(message:any)>` (`extension.ts:1175`).
- **Fix:** type the maps `{[K in HostMessage['command']]: (m: Extract<HostMessage,{command:K}>)=>void}`,
  drop `any` from every handler so TS narrows per command; **complete the union**
  (`config-changed.theme`, `wiki-update.displayNames`, `update.wiki.displayNames` + reply messages);
  add a mirrored `WebviewMessage` union and type `vscode` with it; add an `else` branch on BOTH
  dispatchers logging unhandled commands.

### 2. 🟠 Critical write-back discards `applyEdit`'s failure signal; dispatch has no error boundary
`extension.ts:744-751`: `await vscode.workspace.applyEdit(edit)` **ignores the returned boolean**
(applyEdit *resolves false*, doesn't throw, when the doc changed underneath); the `try` has a `finally`
but **no `catch`**; then `lastSyncedContent = document.getText()` is set unconditionally → a failed
write **advances state** while disk keeps old content and reconciliation never re-pushes
(data-loss-class). Dispatch `await messageHandlers[...]?.(message)` (`:1300`) has no catch; `document
.save()` (`:949`) is unguarded; `showError` exists but isn't applied at the boundary.
- **Fix:** check the `applyEdit` return; on false do NOT advance `lastSyncedContent`, `debug()`-log +
  `showError`. Wrap both dispatchers in try/catch routed to `debug()`/`showError`; guard `document.save()`.

### 3. 🟠 Webview→host log/error/info observability pipe is wired host-side but never invoked
Host registers `log→logger.appendLine` (`extension.ts:1183`), `info→showInformationMessage` (`:1178`),
`error→showError` (`:1179`), `copy-html/copy-markdown` (`:1193-1194`), but a repo-wide grep finds
**zero** webview emitters. The webview falls back to `console.warn/error/log`
(`main.ts:698,984,988`) incl. the init-failure catch — directly contradicting the documented
Output-channel observability rule (memory: debug-metrics-to-Output-channel).
- **Fix:** a webview log helper posting `{command:'log',text}` used at all catch sites; route
  user-facing failures through the existing `error` handler; remove/wire the dead `copy-*` handlers.

### 4. 🟠 No shared type for the config-options payload across the boundary (3 hand-maintained shapes)
Producer `collectConfigOptions` (`extension.ts:1483-1515`) returns an inferred anonymous literal, no
exported interface; `vditor-options.ts:26,63` reads `msg.options.*` as any; `live-config.ts:13-21`
`BodyOptions` is a **separate partial mirror** that already diverges (carries `outlineWidth`,
which `collectConfigOptions` doesn't return); `main.ts` keeps the live copy in `let lastInitMsg: any`.
A key rename compiles cleanly while silently breaking readers.
- **Fix:** one exported `VmarkdConfigOptions` interface; annotate `collectConfigOptions`' return; type
  `msg.options`/`lastInitMsg`; derive `BodyOptions` as `Pick<>` so a rename propagates as compile errors.

### 5. 🟠 Engine→IR producers (ELK + dagre) are pervasively `any`-typed at the most error-prone seam
The Layout IR is cleanly typed (`d2-render.ts:381-409`) but BOTH producers translate through untyped
graphs: `elk-layout.ts:23,25,60,103,230` + `d2-render.ts:498,554,575` + `d2-wasm.ts:11,80` — exactly
where x↔y coordinate mistakes are easiest to make. The recent typecheck pass cleared errors but left
the `any` sprawl.
- **Fix:** model the ELK/dagre graph/node/edge shapes (elkjs + @dagrejs ship usable types) and type
  `compileD2`'s result; keep `any` only at the window-global read, narrowing immediately.

### 6. 🟡 `media-src` compiles with `strict:false` — the enabling condition for items 1,4,5
`media-src/tsconfig.json:7` `strict:false` (vs host root `strict:true`). e.g. `utils.ts:68`
`fileToBase64` has an implicit-any param + dereferences `evt.target.result` with no null guard.
- **Fix:** enable at least `strictNullChecks` + `noImplicitAny` for `media-src`; burn down with
  per-file `// @ts-nocheck` escape hatches so the webview gets the host's guarantees. (Foundation —
  do alongside 1/4/5.)

### 7. 🟡 Faithful-by-construction enforced loudly only for D2 → generalize *(builds on [task 142](142-renderer-feature-parity-audit.md))*
D2 is the gold standard (classified `data-d2-error` + single `unsupportedReason` gate + raw-source
fallback). But `wavedrom`/`vega` clear the source **before** a throwing render → a render-time failure
**blanks the wrapper** (subtly-wrong, not loud-raw). Lift D2's pattern (render into a detached node,
swap only on success, stamp `data-<lang>-error` + post a log on catch) into a shared helper applied to
wavedrom/vega. Reconcile into the task-142 family with a regression test.

## Tests (per AGENTS)
- **unit** — handler maps reject an unknown command (logged, not thrown); `applyEdit`→false does NOT
  advance `lastSyncedContent`; a webview catch posts a `log`; `VmarkdConfigOptions` round-trips
  producer→consumer; the shared faithful-fallback helper keeps raw source on a throwing render.

## See also
- `media-src/src/protocol.ts`, `main.ts:1292-1316`, `extension.ts:1175-1195/744-751`, `utils.ts`,
  `media-src/src/{custom-diagrams,live-config,vditor-options}.ts`, `media-src/tsconfig.json`.
- Tasks 142 (renderer faithful-fallback family — item 7), 148 (the same boundary, security angle).
  Memory: debug-metrics-to-Output-channel, saved-Vditor-options-override-settings.
