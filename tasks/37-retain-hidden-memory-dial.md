# Task: retainContextWhenHidden memory dial

> **Source:** vMark performance audit (memory — highest-impact lever)
> **Value / Risk:** 🟥 HIGH memory win across many tabs / medium (re-show latency tradeoff)
> **Engines:** none
>
> **Status (2026-05-30):** ✅ Done — shipped **dispose-on-hide**
> (`retainContextWhenHidden: false`) in both places. Memory is freed for hidden
> editors. ⚠️ **Needs real-world testing:** confirm switching away/back reloads
> acceptably (cursor/scroll reset is expected) and that nothing breaks on reload.
> The bounded retain-cache (keep N most-recent) is deferred to **task 41** — only
> build it if the reload proves annoying.

## Problem (measured)
`retainContextWhenHidden: true` is set in **two** places — the
`registerCustomEditorProvider` `webviewOptions` (`extension.ts:127`) and
`getWebviewOptions` (`extension.ts:158`). Every opened markdown file therefore keeps a
**fully live** webview — DOM + a Vditor instance (the webview bundle is **308 KB, 94 %
of which is Vditor core**) + any renderers the document loaded — resident even when the
tab is hidden. Idle memory scales linearly with the number of open markdown tabs. VS
Code's own docs flag `retainContextWhenHidden` as memory-intensive and advise against
it unless necessary.

(The ~21 MB of Mermaid/KaTeX/etc. renderers are lazy-loaded per document content, so
they are **not** a baseline cost — the resident cost is the Vditor instance itself.)

## Goal
Stop paying full webview memory for hidden tabs, without a jarring UX regression.

## Options (pick after measuring)
- **A — drop `retain` + `getState`/`setState` (RECOMMENDED).** This is the officially
  preferred path: the VS Code webview guide calls `getState`/`setState` "the preferred
  way to persist state, as they have much lower performance overhead than
  `retainContextWhenHidden`". Expose it as a setting (`markdown-editor.retainHidden`)
  with a measured default. When off: drop `retainContextWhenHidden`; on re-show, re-init
  from the `TextDocument` (already the source of truth) and restore scroll/cursor via
  webview `getState`/`setState`. Pairs with task 38 (synchronous init) to keep re-show
  fast.
- **B — LRU retain:** keep the N most-recently-active webviews live, dispose older
  hidden ones; re-create on demand.
- Consolidate the duplicated option (set it once, not in both places).

> **Background (VS Code webview/custom-editor docs + microsoft/vscode#113507):** the
> flag is **binary** — `true` holds memory *indefinitely*, `false` tears the webview
> down on hide; there is no middle-ground auto-reclaim. Custom editors do **not**
> silently reload context despite `retain` (a common assumption that's false) — so
> `true` genuinely costs the memory; there is no free lunch. For users who keep only a
> few tabs open, `retain:true` may still be the better UX → hence the setting, not a
> hard removal.

## Measure first (Process Explorer)
`Developer: Open Process Explorer` → open ~10 markdown tabs → record webview-process RSS
with `retain:true` vs the chosen alternative; record re-show latency when switching back
to a disposed tab. Decide the default from real numbers.

## Tradeoff
`retain:true` = instant re-show, high memory. `retain:false` = low memory, re-init cost
on tab switch (mitigated by warm bundle cache + synchronous init from task 38).

## See also
- `38-inline-init-content.md` — synchronous init makes re-show after dispose much cheaper.

## Verify
With the memory-saving mode, 10 hidden md tabs consume materially less RSS (per Process
Explorer); switching back to a tab restores content + cursor/scroll correctly.
