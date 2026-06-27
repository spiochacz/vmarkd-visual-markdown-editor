# Task 156 — Re-analyze D2 horizontal (`direction: left` / `right`) layout quality

> **Status:** 🔍 ANALYSIS / decision-gated — created 2026-06-26. Audit whether D2 diagrams laid out
> **left↔right** (horizontal flow) are actually well-arranged, then decide whether to invest in
> axis-aware refine. NOTHING to ship until the audit says it's worth it. Follow-up to **task 127**
> (root `direction` shipped, but horizontal explicitly runs a *reduced* pipeline) and **task 122**
> (the refine pipeline that's being skipped). Builds on 104 (renderer), 123 (pipeline architecture).

## Why this task exists
Task 127 shipped `direction: up|down|left|right`, but with a known shortcut: **for `left`/`right`
(horizontal flow) we SKIP the entire task-122 refine pipeline** and render raw ELK / dagre-`LR`
output. The decision-gate at the time was "option (b): reduced pipeline for horizontal until the
passes are axis-aware" — i.e. we *deferred* the question of whether horizontal diagrams look good.
This task closes that loop: **measure horizontal layout quality, then decide.**

The user's standing rule applies (`[[show-partial-results-for-eval]]`): this is a **render + show +
state-the-metric, pause-for-judgment** task, NOT a silently-stack-fixes task. Lower crossings ≠
better diagram — the deliverable is the user's eyeball verdict on real renders, backed by metrics.

## What the code actually does today (grounded)
- **Mapping is wired both engines:**
  - ELK: `elkDirectionConfig(direction)` → `elk.direction` (`DOWN/UP/RIGHT/LEFT`) + axis-aware in/out
    ports (`elk-layout.ts:57-73, 108-109, 338`).
  - dagre: `rankdir` `TB/BT/LR/RL` (`d2-render.ts:660-667`).
- **The refine pipeline is BYPASSED for horizontal** — the crux:
  ```ts
  // elk-layout.ts:495-503
  const horiz = graph.direction === 'left' || graph.direction === 'right'
  if (refine && !horiz) { … refineLayout(layout) … }
  ```
  So `left`/`right` get **no** row alignment, adaptive band gaps, channel/bend cleanup, A* back-edge
  reroute, or label placement. `up`/`down` share the vertical axis and refine normally.
- **Why it's skipped:** `d2-refine.ts` is vertical-axis-coded throughout — `adaptiveLayerGaps`
  reserves **vertical** room per stacked **horizontal** routing channel (`d2-refine.ts:82-163`),
  `alignRows` groups by centre-Y, the A* grid + channel logic all assume layers stack top→bottom. Run
  as-is on a horizontal layout they'd compress/align the wrong axis.

## The question to answer
Are `direction: left` / `direction: right` diagrams **acceptable as-is** (raw ELK/dagre is clean
enough horizontally), or do they visibly suffer vs the refined vertical path (cramped lanes, kinked
spines, overshoot bends, mis-placed edge labels, container crowding — the same classes task 122 fixed
for vertical)?

## Approach (audit first, no code changes until the gate)
1. **Build a horizontal corpus.** Take the existing layout-quality fixtures (the complex graphs used
   for task 122 / `d2-quality.test.ts`) and produce `direction: right` (and `left`) variants. Include:
   a long chain, a fan-out hub, nested containers, back-edges, and edge labels — the cases refine was
   built to fix vertically.
2. **Render side-by-side** through the production pipeline with the D2 render harness
   (`media-src/scripts/d2-render-harness/render.mjs` — bundles the SOURCE `d2-render.ts`, PNG out
   under `tmp/`, gitignored). For each fixture render: (a) `down` refined, (b) `right` current
   (reduced), and (c) `right` with refine **force-enabled** as a spike (even if axis-wrong) to see how
   badly the vertical passes misfire horizontally. Compare against the real `d2` binary
   (`projects/tala/bin/d2`) at the same fidelity bar used for shapes/themes.
3. **State the metrics per render** (crossings / overlaps / total bend count / spine straightness) AND
   show the PNGs. Pause for the user's judgment — do NOT chase a metric.

## Decision gate (the actual output of this task)
Pick one, with the renders as evidence:
- **(A) Leave it** — raw ELK `RIGHT` (and dagre `LR`) is clean enough; document that horizontal is
  intentionally un-refined and add a regression render so it can't silently rot. Cheapest.
- **(B) Generalize refine to be axis-aware** — parameterize `d2-refine.ts` on a primary/cross axis
  (the passes become "compress along cross-axis / align along primary-axis" instead of hard-coded
  vertical). Biggest win, biggest risk (must keep vertical output **byte-identical** —
  `d2-quality.test.ts` frozen-layout counts are the guard).
- **(C) Cheap targeted subset** — enable only the axis-agnostic / easily-mirrored passes for
  horizontal (e.g. overshoot-collapse, bend cleanup) and leave the vertical-specific ones off.

## Acceptance / tests
- [ ] Horizontal fixture corpus rendered through the harness; PNGs + metrics shown to the user.
- [ ] A written verdict (A/B/C) recorded back in THIS file with the evidence.
- [ ] If B/C: vertical (`down`/`up`) output stays **byte-identical** (`d2-quality.test.ts`), new
      axis-aware unit tests in `d2-refine.test.ts`, and a real-VS-Code e2e in `test/vscode-e2e/`
      rendering a `direction: right` diagram (per AGENTS.md + `vmarkd-testing` skill — webview/renderer
      feature ⇒ MUST write AND run the real-VS-Code e2e).
- [ ] If A: a regression render/snapshot pinning the current horizontal output + a doc note.
- [ ] typecheck + `lint:ci` green.

## Related
- Task 127 (root direction — the deferral this resolves), 122 (the refine pipeline / vertical
  assumptions), 123 (D2 pipeline architecture), 104 (renderer), 119 (themes).
- Code: `elk-layout.ts:495-503` (the skip), `elkDirectionConfig` (`elk-layout.ts:57-73`),
  `d2-render.ts:660-667` (dagre rankdir), `d2-refine.ts:82-163` (`adaptiveLayerGaps`, vertical-coded).
- Memories: `[[show-partial-results-for-eval]]` (the by-eye eval discipline), `[[d2-elk-layout-direction]]`,
  `[[always-thorough-and-proper]]`.
