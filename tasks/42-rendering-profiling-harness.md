# Task: Rendering profiling harness (confirm bottleneck hypotheses)

> **Source:** vMarkd performance audit — instrumentation prerequisite for the
> render-path optimisations (hypotheses below + tasks 11/38/39/40).
> **Value / Risk:** 🟦 diagnostic enabler (unblocks measured optimisation) / low
> (inert when off; pure observation, no behaviour change).
> **Engines:** none.
>
> **Status (2026-05-30):** ✅ **investigation done; runtime harness removed.**
> A dev profiling harness (webview spans → a `vMarkd Perf` output channel, setting
> `markdown-editor.profiling`) was built and used to reach the findings below,
> then **removed** to keep the codebase clean — it had served its purpose and the
> conclusions are captured here. The **reproducible Playwright benchmark**
> (`media-src/e2e/bench-harness.ts` + `init-bench.spec.ts`, run with `BENCH=1`)
> is **kept** as the standing evidence. Not product telemetry (that is
> [task 31](31-opt-in-telemetry.md)).

## Findings — editor-open latency (init.construct), measured 2026-05-30

**The ~650 ms open cost is the one-time load+eval of the 3.8 MB GopherJS Lute
engine, not document parsing.** Confirmed three independent ways:

1. **Sub-span split.** `init.after` (our post-init wiring: theme, renderers,
   fix* listeners) = **~1 ms**. The entire cost is `init.construct`
   (`new Vditor` → `after()`), which is Vditor build + Lute's first parse.
2. **Playwright matrix** (`init-bench.spec.ts`). Once Lute is resident, **warm**
   construct is **4–17 ms regardless** of doc size (plain 50 k = 17 ms), content
   type (math/code/tables ≈ 11–17 ms), toolbar (±4 ms) or mode. The cold/warm
   delta IS the Lute load. → **document size & content do not drive open cost.**
3. **V8 code cache.** In the real extension, the *first* markdown file opened in
   a session costs ~670 ms; **every file after is ~80–130 ms construct** because
   Electron caches Lute's compiled bytecode across webviews (e.g. CHANGELOG:
   673 ms first open → 196 ms reopened). The painful number is **once per
   session**, not per file.

### Consequences for the backlog
- ❌ **Task 39 (gate renderers on content) will NOT help init.** Renderers are
  already lazy (loaded at render time, post-`after()`); they don't block
  construct. The hypothesis is refuted by the benchmark.
- ❌ Debounce / getValue / setValue tuning is about *typing*, not *opening*.
- ⚠️ Cost is paid **per fresh webview**; `retainContextWhenHidden` (task 37)
  only spares re-showing an already-open editor, not opening a new file.

### Lute preload prototype — rejected (break-even)
Tried preloading Lute (async `<script>` right after `ready`, awaited before
construct) to overlap its eval with the host roundtrip. It fired correctly
(`init.construct` dropped ~230→~130 ms, Lute moved to a `preload` span), **but
`open.total` did not improve** (first open 806→796 ms; others within noise).
The Lute eval (98–380 ms) is serial on the webview thread and far exceeds the
~40 ms roundtrip it could overlap, so relocating it within one editor's open
changes nothing end-to-end. **Removed** (code + `preloadLute` setting); the
profiling/`open.total`/benchmark instrumentation stays.

### The only real lever
A **shared single webview** that swaps documents would pay Lute once per session
(~0 for subsequent files) — but it is a significant refactor (per-doc state,
undo, title, watcher, dispose). Not done; would need its own spec. Otherwise the
~670 ms first-open is a structural floor of the GopherJS Lute engine.

## Why
We have concrete hypotheses about where markdown rendering spends time, but no
numbers. This task adds a **developer-only** profiling harness that times the hot
paths in the webview and forwards aggregates to a **`vMarkd Perf`** VS Code Output
channel, so we can confirm/refute each hypothesis on real documents before
changing any rendering code. Off by default, near-zero cost when off.

### Hypotheses to confirm (the point of the harness)
1. **`renderText` regex cost.** `custom-renderer.ts` runs `WikiLinkPattern.test()`
   (regex, `/g` + `lastIndex` resets) on **every** text node, every render, across
   the GopherJS bridge. Expected: ~99% of nodes contain no `[[`, so a
   `text.indexOf('[[') === -1` fast-path would skip the regex. Harness must
   quantify: how many nodes are bracket-eligible vs run the regex vs actually
   match, and total self-time. *(Renderers are already registered only when wiki
   is enabled — `custom-renderer.ts:18` — leave that.)*
2. **`mode: 'ir'` is already optimal** (`main.ts`) — re-parses only the block
   around the cursor, not the whole doc. Do **not** move to `wysiwyg` (heavier
   reparse). `sv` would be lightest but loses live preview. No change; the harness
   confirms `getValue`/`setValue` costs that justify keeping IR.
3. **Input debounce.** `input()` debounces `getValue()` (full IR-DOM→md Lute pass)
   at 250 ms (`main.ts`). For large docs every `getValue()` is a full pass —
   harness measures its p50/p95/max so we can decide whether to raise to 400–500 ms
   or go adaptive (longer debounce when `getValue().length` is large).
4. **Unused preview passes.** `preview.math.inlineDigit: true` is always on
   (`main.ts`) → more aggressive KaTeX matching every render. If most docs have no
   math, this is wasted work — isolate via A/B (toggle `inlineDigit`, compare
   `getValue` totals) since Lute's internal math pass is not directly hookable.
   `counter` is already opt-in (`main.ts` — `wordCount` setting); keep mermaid
   inactive unless used.
5. **Redundant `setValue()`.** Each `vditor.setValue()` is a full md→IR-DOM parse
   of the whole document (the most expensive op). Existing guard
   `getValue() !== msg.content` (`main.ts`) is good. The wiki re-init does one
   extra `setValue` right after init (`main.ts`) — a conscious one-time cost.
   Harness measures `setValue` count + duration to confirm there are no stray calls.

> **Structural ceiling:** the GopherJS-compiled Lute core is the hard limit and is
> not removable without dropping Vditor. This harness measures what is squeezable
> *without* an engine swap.

## Decisions (locked)
| Decision | Choice | Why |
|---|---|---|
| Purpose | **Dev profiling harness** (not product telemetry) | confirm hypotheses on our machine today; zero privacy surface |
| Surfacing | **`vMarkd Perf` Output channel** (host) | persisted, copy-pasteable, survives webview reloads |
| Aggregation | **in the webview**, flush compact summaries | avoids a host round-trip per render that would distort the measurement |
| Gating | **setting `markdown-editor.profiling`, default `false`** | can profile the real packaged VSIX on real docs; inert when off |
| Architecture | **singleton profiler**: percentiles for outer ops + path-counters for `renderText` | confirms every hypothesis incl. the regex's magnitude; pure aggregator is unit-testable |

Explicitly **out of scope (YAGNI):** file/CSV logging, size-bucket histograms,
product/opt-in telemetry, Vditor-internal math hooks, regression tracking. Those
are deferrable; this harness confirms the hypotheses above and nothing more.

## Architecture & data flow
```
webview (media-src)                          extension host (src)
─────────────────────                        ────────────────────
perf.ts  ── instruments ──┐
  ├ init span             │  setting "profiling" → init msg.options.profiling
  ├ getValue span         │
  ├ setValue span         ├─ flush(~2s + __perfFlush()) ─ postMessage
  └ renderText counters   │     {command:'perf', payload}      │
                          │                                    ▼
                          │            OutputChannel "vMarkd Perf"
                          │            (lazy, formatted table append)
```
The webview owns all aggregation; the host only formats + appends. When
`profiling` is off, `perf.ts` short-circuits on a single boolean — instrumentation
calls become no-ops — so the shipped path cost is ~one branch per span.

## Components / steps

### 1. `media-src/src/perf.ts` (new) — split for testability
- **`PerfAggregator`** — pure class, **no DOM / no vscode**:
  - `recordSpan(op, ms, docSize)` — bounded ring buffer (256) per op.
  - `recordRenderText({ selfMs, hadBrackets, matched })` — counters only.
  - `snapshot()` → `{ spans: { op: { count, mean, p50, p95, max } },
    renderText: { calls, totalSelfMs, fastPathEligible, regexPath, matched },
    docSize }`.
  - This pure class is what unit tests target.
- **`profiler`** — thin singleton wrapping one `PerfAggregator`:
  - holds `enabled`; `time(op, fn)` / `span(op)` helpers using `performance.now()`.
  - owns the flush timer (~2 s while active); posts `{ command: 'perf', payload }`
    to `vscode`, wrapped in `try/catch` so a flush failure never breaks rendering.
  - exposes `window.__perfFlush()` and `window.__perfReset()`.

### 2. Instrumentation edits
- **`media-src/src/main.ts`**
  - in `initVditor`: `profiler.enabled = msg.options?.profiling === true`.
  - wrap `new Vditor(...)` → end-of-`after()` as the **`init`** span (tag
    `docSize = msg.content.length`).
  - wrap `vditor.getValue()` in `input()` as **`getValue`**.
  - wrap **both** `vditor.setValue(...)` calls (wiki re-init + external update) as
    **`setValue`**.
- **`media-src/src/custom-renderer.ts`** — in `renderText`, when `profiler.enabled`,
  measure self-time and record `hadBrackets = text.indexOf('[[') !== -1` and
  whether the regex actually `matched`. **No behaviour change** — purely observes
  how often the fast-path *would* fire and what the regex costs.

### 3. `src/extension.ts`
- lazy `OutputChannel('vMarkd Perf')` (created on first `perf` message).
- handle `{ command: 'perf' }`: append a timestamped, file-named, fixed-width table
  (format below).
- pass `profiling: config.get('profiling') ?? false` into the init message
  `options` so the webview knows whether to enable.
- optional small command `vMarkd: Show Perf Output` to reveal the channel.

### 4. `package.json`
- add setting **`markdown-editor.profiling`** — boolean, default `false`,
  description marks it **Developer**: "Developer: collect rendering performance
  timings into the 'vMarkd Perf' output channel."

## Output format (what lands in the channel)
```
[10:42:01] sample.md  (docSize 48,210 chars)
  op         count   mean    p50    p95    max
  init           1  88.4ms  88.4   88.4   88.4
  getValue      37   6.1ms   5.2   14.8   22.0
  setValue       2  41.0ms   …
  renderText: 5,120 calls  totalSelf 31.2ms  | bracket-eligible 4,998 (97.6%)  regex-run 122  matched 40
```
The last line **is** the hypothesis-1 confirmation: the bracket-eligible % is the
share of nodes a `indexOf` fast-path would skip the regex on, and `totalSelf`
quantifies the prize.

## Cost-when-off & error handling
- **Off** → every `profiler.*` call returns immediately on the `enabled` check;
  `renderText` adds one `&&`-guarded branch. No timers, no allocations.
- Flush is `try/catch`-wrapped; serialization or `postMessage` failure never breaks
  rendering.
- **`performance.now()` resolution caveat:** `renderText` is reported as **summed
  self-time + counts** (meaningful in aggregate), **not** per-call percentiles —
  sub-µs per-call timing is below the clock's honest resolution. Outer ops
  (init/getValue/setValue) are coarse enough for real percentiles.

## Tests
- **Unit (vitest, backend):** `PerfAggregator` — percentile math on known inputs,
  ring-buffer bound (≤256), `renderText` counter tallies. Pure class, imports clean.
- **Unit (backend):** host routes a `perf` message to the Output channel (extend
  `test/backend/vscode-mock.ts` with `createOutputChannel`); init `options.profiling`
  reflects the setting value.

## Verify
1. Set `markdown-editor.profiling: true`; reload the editor.
2. Open a small / medium / large real document; type ~20 s in each.
3. Read `vMarkd Perf` Output channel — numbers appear, segmented per file/flush.
4. Use the data to: (a) fill in the measured table in
   [task 37](37-retain-hidden-memory-dial.md) and (b) decide the `renderText`
   fast-path payoff (hypothesis 1) and the debounce value (hypothesis 3).
5. Turn the setting off — confirm no `perf` messages, no channel growth, no timer.

## See also
- [11 — Perf: debounce + drop onLanguage](11-perf-debounce-activation.md) — debounce is hypothesis 3.
- [38 — Inline init content](38-inline-init-content.md) / [39 — Lean Vditor init](39-lean-vditor-init.md) — init-span numbers justify these.
- [40 — Drop unused MathJax](40-drop-unused-mathjax.md) — already done; math pass (hypothesis 4) is the remaining preview cost.
- [31 — Opt-in telemetry](31-opt-in-telemetry.md) — the *product* telemetry this harness is deliberately **not**.
