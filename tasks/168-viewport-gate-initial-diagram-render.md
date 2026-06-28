# Task 168 — Viewport-gate the INITIAL diagram render on open (IntersectionObserver)

**Status:** TODO (big / L — the single biggest open-latency lever on diagram-heavy docs; conditional, measure on diagram-heavy fixtures).
**Source:** vMark perf analysis (2026-06-28, 39-agent workflow `wf_19aa433d-4fa`).
**Value / Risk:** 🟥 high (turns N heavy layouts on open into 2-3 visible ones — removes real CPU, not just reschedules it) / 🟠 medium-high (offscreen height reservation + scroll-preserve + keep-last-overlay/snapshot interactions).
**Engines:** all (mermaid/echarts/d2 + custom).

## Problem

On open (not typing), `deferIrDiagramRender` (`media-src/src/edit-activity.ts:255-270`) loops every
`.vditor-ir__preview[data-render='2']` and, since the cache-skip branch (264) is bypassed when not
typing, calls `processCodeRender` on **every** preview (269). `observeCustomDiagrams.run()`
(`custom-diagrams.ts:817-857`) loops all 8 renderers, each doing `blocks.forEach(...)` over **every**
block — **zero viewport filter**. So a doc with N diagrams renders all of them (most below the fold)
before the editor settles.

Why the existing nets don't cover this:
- The sibling "yield between renderers" (task 169 / `custom-diagrams.ts:834-851`) only **spreads**
  the work across frames — it never **skips** offscreen diagrams (comment line 837 quantifies the
  un-removed cost: "~4.8 s on a 15-diagram doc").
- `content-visibility:auto` (`main.css:716-722`, **large-doc only**) skips offscreen layout/PAINT but
  **NOT** the imperative JS engine render — dagre/echarts/d2 layouts of offscreen blocks still
  execute on open.
- Streaming (task 49) gates at `STREAM_MIN_CHARS = 700_000`; content-visibility at
  `CONTENT_VIS_MIN_CHARS = 100_000` (`main.ts:46`) — both **miss** the common many-diagram doc under
  those thresholds (e.g. ~15 diagrams in a sub-100 KB file, only 2-3 visible).

No IntersectionObserver-based lazy diagram render exists anywhere (`grep IntersectionObserver
media-src/src/` = 0).

## Plan (gate at the two existing seams — don't add a third path)

1. **IR native path** — in `deferIrDiagramRender`'s non-typing branch (`edit-activity.ts:269`) call
   `processCodeRender` only for previews intersecting a **`rootMargin`-expanded viewport**; register
   the rest with a **shared `IntersectionObserver`** that fires `processCodeRender` on intersect.
2. **Custom path** — wrap the per-block render in `observeCustomDiagrams.run()` / `findBlocks`
   consumers with the **same** observer.
3. **Reserve height** on the un-rendered diagram node via `content-visibility:auto` +
   `contain-intrinsic-size`, **decoupled** from the `body.vmarkd-large-doc` class (the existing
   `main.css:716-722` rule is large-doc-scoped and excludes gutter-marker blocks — diagram deferral
   must apply regardless of doc size).

## Constraints
- **Anchors/scroll:** blocks rendered above the scroll point that then grow shift content — the
  intrinsic-size estimate must be close, or `preview-scroll-preserve` (anchors on all top-level
  blocks) + `heading-align` drift.
- **Placeholder state:** the keep-last overlay + `snapshotRenders` (`edit-activity.ts:286-307`) and
  the `data-render` IR/WYSIWYG Lute walkers assume a *rendered* preview — a deferred node needs a
  benign placeholder that **keeps `data-render`** so Lute round-trip stays clean and the cache
  doesn't snapshot an empty preview.
- Caret preservation across the lazy render-on-intersect.
- Deferred blocks stay round-trippable source `<code>` (Lute-**safer** than a rendered preview).
- Main-thread DOM only (no Worker/CSP — STL/ELK worker-rejection irrelevant here); no
  `Date.now`/`Math.random`.

## Verification
- **Real-VS-Code perf e2e (MANDATORY)** in `test/vscode-e2e/`: open a ~15-diagram sub-100 KB doc,
  assert immediate render count == visible-only.
- **Scroll-preserve e2e:** scroll up/down across deferred blocks → no anchor drift.
- Note the win is **conditional** — docs with few / all-visible diagrams gain nothing; measure on
  diagram-heavy fixtures (extend `test/vscode-e2e/perf-timeline.spec.ts`).
- Keep `custom-diagrams-render`, `d2-theme`, streaming + content-visibility specs green. `tsc` +
  `biome` + vitest + Playwright, headless. Verify coverage.

## See also
- `edit-activity.ts` (`deferIrDiagramRender`, `snapshotRenders`, the esbuild-patched IR loop seam),
  `custom-diagrams.ts`, task 49 (streaming, >700 KB), task 161 (edit-path offscreen-swap — different
  problem), `preview-scroll-preserve.ts`, task 152 (Disposables).
- Same viewport-gating idea on the **flip** path = task 166. Complementary big bet (spread, not skip)
  = task 169.
