# Task 152 — Decompose the webview orchestrator + harden state ownership

> **Status:** 📋 TODO — created 2026-06-24 from a multi-agent whole-system architecture review.
> Maintainability / merge-contention debt — NOT a correctness landmine. Lowest urgency of the four
> review tasks; partly already underway (host side + D2 under [task 123](123-d2-pipeline-refactor.md)).
> **Source:** architecture review (2026-06-24), webview-orchestrator + state-dataflow lanes, verified.
> **Value / Risk:** 🟡 cohesion + state ownership + fewer merge conflicts / medium — large mechanical
> refactor; the leaf logic is already well-factored, so this is moving, not rewriting.
>
> **🟢 Items 3, 4, 5 DONE 2026-06-27 (the contained, correctness-relevant ones; tests + real-VS-Code):**
> - **3 (re-theme authority):** one `rethemeDiagrams(flags)` in main.ts now owns the live re-theme;
>   `handleSetTheme` passes all-true, `handleConfigChanged` passes the changed-flag subset. Split D2
>   out of the old `reThemePlantumlGraphviz` → `reThemeMonochromeGroup({mono,d2})`, so D2 fires ONCE
>   for `content || d2Layout || d2Theme` — killing the double-fire when a content + d2 change coincided
>   (the drift evidence). Verified: 14 real-VS-Code theme-flip specs green (d2/wavedrom/nomnoml/
>   flowchart/vega/echarts+mindmap live flip/graphviz/smiles).
> - **4 (persistence allow-list):** `saveVditorOptions` now persists ONLY `{mode}` (the user-chosen
>   editor mode) — dropped the whole config-derived `preview` blob + top-level `theme` that shadowed
>   live config (the lineNumber-stuck / stale-code-style class). buildVditorOptions' authoritative
>   re-merge stays as belt-and-suspenders for old saved blobs. Test: `save-vditor-options.test.ts`.
> - **5 (typed D2 globals owner):** `d2-config.ts` (`getD2Config`/`setD2Config`, typed window) replaces
>   the raw `(window as any).__vmarkd*` channel at main.ts (init + both flip sites) + custom-diagrams.ts
>   (renderD2 + geojson basemap). Hoisted the byte-identical `loadScript` into `load-script.ts` (used by
>   elk-layout + d2-wasm). Test: `d2-config.test.ts`.
>
> **⏳ Deferred — items 1, 2, 6, 7 (the large mechanical decomposition):** splitting main.ts's
> god-module into cohesive modules + the per-init session object (1, 2), the host extension.ts
> extraction (6), and the dead-code nits (7). These are pure maintainability moves (the task's "lowest
> urgency"), high-churn + webview-regression-risky, and best done as their own focused pass.

## Findings → work items

### 1. 🟠 `main.ts` is a god-module (~12 responsibilities, 1344 LOC, 0 exports, 55 imports)
`initVditor` spans `526-966` (config gating, serialize pipeline `582-620`, pending-edit drift-audit
`664-708`, wiki autocomplete, upload, a ~100-line `after()` hook `815-916`); `runFinishInit`
(`406-524`) repeats `disposeX?.(); disposeX = observeX(...)` **11 times**; module mutables
(`111-145` + `lastEditorRange` `159`) total **19**, several rebound from inside `initVditor` closures;
**13** `(window.vditor as any).vditor` chains + 21 `as any` couple the file to undocumented Vditor
internals not covered by the patch-drift tests.
- **Fix:** decompose into cohesive modules (`prerender-overlay`, `editor-caret`, `diagram-retheme`,
  `edit-sync` factory, `finish-init`, `message-handlers`), leaving `main.ts` thin wiring; extract the
  serialize/pending-edit subsystem (`582-708`) into a `createEditSync` factory and the
  wiki-hint/upload closures into `vditor-options`.

### 2. 🟠 Per-instance lifecycle lives in ~19 module-global mutables + 13 deep Vditor reaches
- **Fix:** collect the 19 mutables + the 11 dispose/reassign pairs into one **per-init session
  object** with a `Disposables` registry (re-init = `new session`, `oldSession.dispose()`);
  centralize the 13 `(window.vditor as any).vditor` reaches behind a typed `innerVditor()` accessor.

### 3. 🟠 Re-theme orchestration duplicated across `handleSetTheme` + `handleConfigChanged`
`handleSetTheme` (`main.ts:1016-1061`) runs the full set unconditionally; `handleConfigChanged`
(`1123-1230`) re-runs it behind per-option flags. `reThemePlantumlGraphviz` (`1101-1121`) already
bundles d2 (`:1117`), yet `handleConfigChanged` must call `reRenderD2` **separately** (`:1228-1229`)
because the grouped helper only fires on a content-theme change there — concrete evidence the two
sites have drifted. Every new offline renderer must touch both and keep gating consistent.
- **Fix:** one `rethemeDiagrams(theme, opts?)` authority in a `diagram-retheme` module; `handleSetTheme`
  passes all-true, `handleConfigChanged` passes the changed-flag set, D2/plantuml grouping in one place.
  (Pairs with [task 146](146-theming-coherence.md), the theming-coherence policy.)

### 4. 🟠 Persistence granularity too coarse — saved blob is a permanent competitor to live config
`saveVditorOptions` persists the **entire** `vditor.options.preview` object (`utils.ts:79-89`); init
spreads it ON TOP of `collectConfigOptions` every open (`extension.ts:887-890`); only
`preview.theme.current` + `hljs.style` + `hljs.lineNumber` are re-applied authoritatively AFTER
(`vditor-options.ts:46-66`). This already shipped two one-way-switch bugs (lineNumber stuck on, stale
code style) — the SSOT survives only by a **hand-maintained re-merge list** enforced by developer
memory, not architecture.
- **Fix:** persist only genuinely user-chosen, non-config-derived state (mode), OR strip
  config-derived keys before saving so they can never shadow live config; replace the whole-preview
  snapshot with an explicit **allow-list**, demoting the authoritative re-merge to belt-and-suspenders.
  (Memory: saved-Vditor-options-override-settings — this is the structural fix for that class.)

### 5. 🟡 D2 window globals have no typed owner *(overlaps [task 123](123-d2-pipeline-refactor.md))*
`window.__vmarkd*` is an untyped cross-module config channel; D2 globals (`__vmarkdD2Layout`,
`__vmarkdD2Theme`) are written raw inline with no owner module.
- **Fix:** a typed owner (`setD2Config`/`getD2Config`) mirroring `echarts-apply`/`mermaid-theme`; pass
  `{layout,theme}` explicitly into `reRenderD2`; declare all `__vmarkd*` keys on one `Window`
  augmentation; hoist the byte-identical `loadScript` into a shared helper.

### 6. 🟢 (LOW) Host `extension.ts` is a 1618-line god-file; echo-suppression is diffuse flag state
Activation + command-registration + status-bar + outline + free helpers + `EditorSession` (`665-1333`)
+ `MarkdownEditorProvider` (`1335-1618`); the `660-664` comment acknowledges the decomposition is
staged. Echo-suppression = five private fields + a `normalizeContent` compare duplicated across
`syncToEditor`/`postUpdate`/the change listener.
- **Fix (opportunistic):** continue the documented extraction (host-utils, status-bar, outline,
  EditorSession, MarkdownEditorProvider into own files); encapsulate the sync state machine behind a
  single `isEcho(content)` predicate. Lowest urgency.

### 7. 🟢 (LOW) Scattered dead-code / placement nits (free cleanup)
`MarkdownEditorProvider.findActivePanel` (`extension.ts:1341`) zero callers; `html-builder.ts`
import-time `readFileSync` IIFE (`:148-157`) + mid-file `node:fs/crypto/path` imports; `echarts-theme.ts`
+ `echarts-gallery.ts` sit in the host tree with a comment falsely claiming bidirectional use but have
**zero host importers** (webview-only → dead JS in `out/`); `findScroller` is a generic util housed in
the feature module `toolbar-scroll-guard.ts`. Remove/relocate opportunistically.

## Tests (per AGENTS)
- **unit** — `createEditSync` serialize/pending-edit in isolation; `rethemeDiagrams` fires the right
  subset per changed-flag set; the persistence allow-list never saves a config-derived key; session
  `dispose()` tears down all observers (no leak across re-init).

## See also
- `media-src/src/main.ts`, `utils.ts`, `extension.ts`, `media-src/src/{echarts-apply,mermaid-theme}.ts`.
- Tasks 123 (D2 pipeline god-module — items 5 + D2 decomposition overlap), 146 (theming policy — item 3),
  151 (the typed seams these modules expose). Memory: saved-Vditor-options-override-settings,
  callouts-observe-app-mount (the observer-lifecycle pattern item 2 generalizes).
