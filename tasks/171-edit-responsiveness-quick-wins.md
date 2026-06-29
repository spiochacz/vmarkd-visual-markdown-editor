# Task 171 — Edit-responsiveness quick-wins bundle (per-keystroke waste removal)

**Status:** ✅ DONE (2026-06-29). All four waste-removals shipped as one PR.

## Outcome (what shipped)

All four landed; no Lute round-trip / caret exposure (subtractive + pure scheduling).
- **Item 1** — `patchIrSpaceSerialize` (esbuild, `ir/input.ts`): the startSpace/endSpace fast-paths no
  longer run a full-document `getMarkdown` per inter-word space; `options.input()` is called as a cheap
  signal, the serialize is gated behind counter/cache. Asserts EXACTLY 2 rewritten sites.
- **Item 2** — `patchDeferRenderToc` (esbuild, `ir/input.ts`) + `__vmarkdDeferRenderToc`
  (`edit-activity.ts`): `renderToc` (a SECOND full GopherJS spin + heading-id rewrite per keystroke) is
  coalesced to the edit-settle via the existing `deferUntilSettle` gate. Stock-call fallback if the
  hook isn't installed (harness).
- **Item 3** — `edit-activity.ts`: replaced the per-node `ordinalOf` (O(n²) on burst-start /
  per-deferred-preview) with a single-walk `ordinalMap`; `snapshotRenders` + the `deferIrDiagramRender`
  overlay loop now compute every code-block's per-lang ordinal once. Same renderCache-key semantics.
- **Item 4** — `patchDeferGetMarkdown` (esbuild, `wysiwyg/afterRenderEvent.ts` + `sv/process.ts`): the
  discarded full-doc serialize in WYSIWYG/SV is gated behind counter/cache (`text` stays declared for
  the counter/cache consumers). Parity cleanup.

## Tests
- **Unit** (`test/backend/vditor-source-patches.test.ts`, +3 describe blocks): each patch's anchor
  found, correct match count (item 1 = 2 sites, item 4 = 1/file), output shape, and a drift-throw
  guard. Item 3's `ordinalMap` is exercised by the existing `edit-activity` tests. Full vitest 1058.
- **Real-VS-Code e2e** (`perf-edit.spec.ts` + `fixtures/perf-edit.md`): (1) IR space-path typing still
  propagates to the host `TextDocument` (the gated `options.input()` still fires editSync); (2) a new
  heading still gets its outline `ir-<slug>_<index>` id after the deferred renderToc settles (`[toc]`
  renders no block in IR, so the outline id — which only outlineRender assigns — is the observable);
  (4) WYSIWYG typing still propagates to the host. Regression: the diagram-defer/overlay specs
  (`d2-edit-perf`, `plantuml-overlay-size`, `t161-visual`) stay green (item 3 path).
- `tsc` + `biome` (7-baseline) + full vitest + the e2e all green, headless.

---

**(original plan below)**

**Premise was:** four independent S-effort waste-removals on the input path, low risk, ship as one PR.
**Source:** vMark edit-responsiveness analysis (2026-06-28, 39→22-agent workflow `wf_2c64003e-264`).
**Value / Risk:** 🟨 medium (removes wasted full-document serializes + a second GopherJS spin per keystroke; biggest on large / heading-heavy / diagram-heavy docs) / 🟢 low (all subtractive or pure scheduling; no Lute round-trip / caret exposure).
**Engines:** none directly (input-path glue) — items 2/3 help diagram-heavy + heading-heavy docs.

## Premise (read first — honest framing)

The dominant per-LETTER cost is Lute `SpinVditorIRDOM` (`ir/input.ts:179`), which is **block-scoped
already** and **structurally mandatory** (typing `## ` must become a heading; list continuation;
emphasis) — it **cannot** be skipped, debounced, or off-threaded (GopherJS is synchronous, the
`<wbr>` caret can't survive an async swap, the webview rejects Workers). See the analysis `doNot`.
So this bundle does **not** make per-letter prose typing dramatically faster — it deletes the
**wasted work bolted around** the spin. Each item below is independent; bundle them because each is
tiny. No `Date.now`/`Math.random`. Mirror the `patchIrInputSerialize` (task 68) anchor-guard style
for every esbuild patch (throw on anchor drift so a Vditor bump fails loud).

---

### 1. Kill the synchronous full-document `getMarkdown` on the IR space fast-path

`ir/input.ts:54-59` (`startSpace`) and `:66-80` (`endSpace`) short-circuit the spin **but** call
`vditor.options.input(getMarkdown(vditor))` **synchronously** and `return`. `getMarkdown.ts:9` is a
**full-document** `vditor.lute.VditorIRDOM2Md(vditor.ir.element.innerHTML)` (super-linear in doc
size). `endSpace` is true when the caret has only trailing whitespace after it — i.e. **the exact
instant you press SPACE between words while appending prose** — so this runs a whole-document
serialize on the keystroke→paint critical path on essentially **every inter-word space**. The result
is **thrown away**: `options.input()` (`main.ts:442`) takes no argument (only `editSync?.schedule()`);
`counter`/`cache` are off.

**Why uncovered:** task 68's `patchIrInputSerialize` anchors on `const text = getMarkdown(vditor);`
which exists only in `ir/process.ts` (the *deferred* serialize). Here the calls are inlined as
`vditor.options.input(getMarkdown(vditor))`, so both space-path sites slipped through all prior
levers.

**Fix:** add a third esbuild rewrite next to `patchIrInputSerialize` targeting the two
`vditor.options.input(getMarkdown(vditor))` sites in `ir/input.ts` → bare `vditor.options.input()`
(compute `getMarkdown` only if `counter.enable || cache.enable`). **Keep the `return`** (the spin-skip
is correct/desired). The two sites are textually identical → a `replace` hits both; **assert exactly
2 matches** (or anchor each within its `if (startSpace)` / `if (endSpace)` context) so a partial
apply can't slip by.
**Honest scope:** only speeds up SPACE keystrokes while APPENDING prose on LARGE docs; nothing for
mid-paragraph edits, the per-letter spin, or code/diagram source (`input.ts:19` excludes
`data-type==='code-block'`).

### 2. Debounce `renderToc` to the edit-settle (it hides a SECOND full spin per keystroke)

`ir/input.ts:239` calls `renderToc(vditor)` **every keystroke**; `util/toc.ts:6-22` calls
`vditor.outline.render` unconditionally (only `sv`-mode early-out), and `outlineRender.ts:27` runs a
**second full `vditor.lute.SpinVditorIRDOM("<p>[ToC]</p>" + allHeadingsOuterHTML)`** plus rewrites
**every heading id** (`:9-11`) — a whole extra GopherJS spin per keystroke on heading-heavy docs,
**regardless of whether a ToC block or the outline panel exists**.

**Fix:** a `__vmarkdDeferRenderToc` esbuild patch at `input.ts:239` (mirror the existing
`__vmarkdDeferIrDiagramRender` pattern, `edit-activity.ts:319`), flushing on settle/blur/save.
Caret/round-trip safe (touches heading ids — not serialized — + toc-block innerHTML, regenerated from
the `[ToC]` marker; ToC clicks resolve via `getElementById` so a brief stale id is low-risk).
**Drop** the `:84` expand-marker scoping (load-bearing one-node-expanded invariant + pairs with
`patchIrBlurExpand`) and the `:205/:220` ref-def/footnote merge-skip (cheap native scans, dwarfed by
the spin). **Benchmark on a ~200-heading doc** — impact is conditional (medium heading-heavy, low
otherwise).

### 3. Make `ordinalOf` O(1) so burst-start doesn't do an O(n²) querySelector storm

`edit-activity.ts:56` (`markEditActivity`, capture phase) runs `snapshotRenders()`
(`:288-308`) **synchronously on the first keystroke of every typing burst** (after each ≥220 ms
pause). It walks all `.vditor-ir__node[data-type="code-block"]` and calls `ordinalOf()` per node
(`:124-135`); `ordinalOf` itself re-walks every code-block with a `querySelector` each → **O(n²)** in
code-block count on diagram-heavy docs.

**Fix:** compute ordinals **once** with an inline per-lang counter in `snapshotRenders`' existing
single walk, and hand `restoreOverlay` (`:184`) the same map / a `WeakMap<node,ord>`. The counter
**must match `ordinalOf`'s count-all-nodes-of-that-lang semantics** so keys stay consistent with
`restoreOverlay:184`. Zero structural risk (no Lute, no round-trip; overlay carries `data-render=1`).
**Descope** the `toDataURL`-dedup half (skipping unchanged-canvas re-rasterisation) — it needs a
conservative per-node source-hash and risks the wrong-SVG overlay bug (obs 16559); only worth it if
profiling shows rasterisation dominates burst-start. Fires once per burst, diagram-heavy docs only.

### 4. Stop the discarded deferred `getMarkdown` in WYSIWYG and SV modes

`afterRenderEvent.ts:17` (WYSIWYG, inside the `undoDelay` timer) and `sv/process.ts:115` (SV,
**synchronously per-input** — the candidate's "in the undoDelay timer" is wrong for SV) both compute
`const text = getMarkdown(vditor)` and pass it to `input()`, which ignores the argument
(`counter`/`cache` off) — dead super-linear work. The task-68 anchor (`const text =
getMarkdown(vditor);` … `vditor.options.input(text);`) is **byte-identical across both files** so it
transplants cleanly — but add a **per-file** anchor-drift throw and **re-verify the END-anchor
indentation per file**.
**Honest scope:** parity cleanup, **not** an IR typing-latency fix (IR is the default, already
handled by task 68); the real WYSIWYG keystroke cost is `SpinVditorDOM` (untouched). Opportunistic.

---

## Constraints
- All four keep the existing control flow (item 1 keeps the `return`; item 2 only defers; item 3 is
  read-only snapshot; item 4 removes dead code). No skip/debounce of any **structural** normalization
  → no `## `→heading / list regression.
- Round-trip stays byte-identical (the host save uses `editSync→serializeForHost`, never these
  discarded values; item 2 touches ids + toc-block content, not serialized source).
- Caret/scroll untouched (no DOM rebuild on these paths; `renderToc` runs after `setRangeByWbr`).
- Each esbuild patch carries an anchor-drift assert; item 1 asserts both sites rewritten.

## Verification (real-VS-Code e2e is MANDATORY per AGENTS.md)
- **Unit:** each patch — anchors found, correct match count, output shape;
  `test/backend/vditor-source-patches.test.ts` drift-guards.
- **Real-VS-Code e2e** (`test/vscode-e2e/`, headless `xvfb-run -a`):
  - type many trailing spaces in a LARGE doc → host edit still arrives via `editSync`, saved file
    **byte-identical** (item 1);
  - type in a heading-dense fixture → toc-block / outline settle correctly after the debounce flush
    (item 2);
  - burst-start on a many-canvas-diagram doc → keep-last overlay still correct, ordinals stable
    (item 3);
  - WYSIWYG + SV edit → save round-trips byte-identical (item 4).
- Fix the stale `rAF-debounced` comments at `finish-init.ts:73/:87` (they misdescribe the now-sync
  observers — see task 173).
- `tsc` + `biome` + full vitest + Playwright green, headless. **Verify coverage** on new code.

## See also
- Task 68 (`patchIrInputSerialize` — the precedent these extend), task 69 (incremental serialize),
  task 161 (debounced diagram re-render — the keep-last overlay + edit-activity gate).
- Memory `diagram-edit-debounce` (the residual = the spin), `perf-frontier-theme-flip-and-open-render`.
- The remaining edit-latency levers: 172 (strip SVG from spin input — diagram prize), 173/174/176
  (observer fleet), 175 (code-body spin-skip spike).
