# Task: Bounded retain-cache for hidden webviews (N most-recent)

> **Source:** follow-up to task 37 (dispose-on-hide decision)
> **Value / Risk:** 🟧 perf/UX balance / medium — touches webview lifecycle
> **Engines:** none
> **Status:** deferred — only build this if dispose-on-hide proves annoying.

## Background
Task **37** shipped `retainContextWhenHidden: false` (dispose-on-hide): hidden
editors free their webview, minimising memory. Cost: switching away and back
**reloads** the webview (cursor/scroll reset, brief re-render).

This task is the middle ground requested originally: keep the **N most-recently
active** editors retained, dispose the rest — so frequent switches between a few
docs stay instant while a large fan of open editors doesn't blow up memory.

## ⚠️ Constraint (why this is non-trivial)
`retainContextWhenHidden` is a **panel-creation option and is immutable after
creation** — you cannot "un-retain" the (N+1)th editor without disposing its
panel (which closes the editor). So an LRU over the live option is not possible
directly. Viable approaches:

1. **getState/setState cache (recommended).** Keep `retainContextWhenHidden:
   false`, but on hide persist a lightweight snapshot (scroll position, cursor,
   maybe the rendered HTML) via `webview.setState`, and restore it on the next
   `ready` for that document. Bound the in-memory snapshot map to N entries
   (LRU by last-active). This gives "instant-feeling" restore for the last N
   without retaining full webviews.
2. **Selective retain at open.** Decide at `resolveCustomTextEditor` time whether
   this editor is "hot" (e.g. among the last N opened) and create it retained;
   but you still can't downgrade it later, so this drifts as usage changes.

Prefer (1).

## Steps (approach 1)
1. Provider-level LRU map `documentUri -> snapshot`, capped at N (default 3),
   evict least-recently-active.
2. Webview: on `visibilitychange`/blur, `vscode.setState({ scroll, cursor })`;
   on `init`/`ready`, if a snapshot is provided, restore scroll/cursor after
   Vditor mounts.
3. Setting `markdown-editor.retainHiddenEditors` (number, default 3) to size N
   (0 = pure dispose-on-hide = current behaviour).
4. Dispose/evict the snapshot on `onDidDispose`.

## ⚠️ Verify (needs real-world testing)
- Open 5+ markdown editors, switch around: memory stays bounded (heap snapshot),
  and the last N switch back **without** a visible reload; the rest reload.
- Cursor/scroll restored for cached editors; no stale content after external edits.
- Setting `= 0` matches task 37's plain dispose-on-hide.
