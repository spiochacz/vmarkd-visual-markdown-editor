# ADR-0003 — CSS theming architecture: mechanism routing + per-surface contracts

- **Status:** Accepted
- **Date:** 2026-06-13
- **Tags:** css, theming, vditor, build, architecture
- **Related:** tasks 84/85 (the `--vmarkd-*` palette tokenization), task 109 (tokenize github content themes), `media-src/src/main.css`, `build.mjs` (`varifyVditorPalette`, `patchVditorIndexCss`)
- **Amended (2026-10-08):** the "drop Edit↔Preview spacing parity" decision (Context) and "Edit and Preview are decoupled" (Consequences) are **superseded by [ADR-0009](0009-content-parity-across-stages.md)** — content geometry is now one theme-owned profile applied to every stage. Mechanism routing and the per-surface *behaviour* contracts (no jank, no glitches) below still hold.
- **Note:** ADR-0001/0002 cover the Marp feature and currently live on a separate branch; the numbering is project-global.

## Context

`media-src/src/main.css` is ~900 lines with ~62 `!important`. This reads as "too much hacking," but the cause is structural, not sloppiness:

- vMarkd renders Markdown via **Vditor**, embedded in a **VS Code webview**, with our own editor features layered on top. We therefore fight *other people's* CSS: Vditor ships its own structural + content-theme CSS, and VS Code **injects default CSS** into every webview (bare-element styles via `--vscode-*`).
- The github↔Vditor *cascade-order* war (equal-specificity `.markdown-body` vs `.vditor-reset` ties) was **already solved** by migrating Vditor's content-theme palette to `var(--vmarkd-*, default)` (tasks 84/85) — themes set tokens instead of out-ranking rules. Spike-verified (task 109): the remaining `main.css` `!important` are NOT github referees.
- The remaining `!important` fall into three irreducible-by-default categories: **(1) VS Code injected-default neutralizers** (e.g. neutralizing the webview's `blockquote` background), **(2) IR/WYSIWYG edit-surface** rules (dual-node anti-jank / anti-glitch), **(3) layout/geometry/features** (full-width, tables, Edit↔Preview geometry).
- Decision taken alongside this ADR: **we drop Edit↔Preview spacing parity** — IR/WYSIWYG may have roomier block spacing than the preview/render; we only require no jank and no glitches while editing.
- We already patch Vditor's *TypeScript* at build time (esbuild `onLoad`) and rewrite Vditor's content-theme *CSS* at build time (`varifyVditorPalette`); a Vditor **fork** is on the table. So patching Vditor's own CSS at the source is a legitimate, established tool — not a hack.

## Decision

Adopt two organizing principles and a file structure.

### 1. Per-surface contracts (stop conflating edit with preview)

Two distinct surfaces, two explicit contracts — stop writing rules that force `edit == preview`:

- **Render / Preview surface** — the GitHub-fidelity target. Palette via `--vmarkd-*` tokens, structure from Vditor + small deltas (e.g. heading scale). "Looks like GitHub" lives here.
- **Edit surface (IR / WYSIWYG)** — optimized for editing, NOT for matching the preview. Contract: no jank (no reflow/scroll-jump on caret enter/leave or expand/collapse), no glitches (no phantom strut space), readable while editing. Block spacing may be roomier than preview.

### 2. Mechanism routing (route each styling need to the right home; minimize `main.css` overrides)

Four mechanisms, with a decision rule applied to every new styling need:

| Need | Mechanism | Why |
|---|---|---|
| Colour / palette value | **`--vmarkd-*` token** (theme file sets it) | no cascade fight |
| Change a rule **originating in Vditor** | **build-time Vditor source-patch** (`build.mjs`, e.g. `patchVditorIndexCss`) | clean, no `!important`, anchor-asserted (fails the build on drift) |
| Beat a **VS Code injected default** | **`main.css` `!important`** | the only place — it's neither our CSS nor Vditor's |
| Our own feature / geometry / edit-surface anti-jank | **`main.css`** (scoped; `!important` only to beat Vditor's inline/computed values) | it's our logic |
| Behaviour (not CSS) | **esbuild TS patch** | — |

**Consequence of the rule:** the more Vditor-origin fixes move to source-patches and palette to tokens, the more `main.css` shrinks to exactly the three irreducible categories — and every remaining `!important` is either genuinely unavoidable (VS Code) or self-evidently ours.

### 3. `main.css` organized into labeled sections by contract

A flat file becomes explicit sections, each with a header stating *antagonist / mechanism / whether its `!important` is load-bearing and why*:

```
header: the 4 mechanisms + the routing rule + the per-surface split
1. Token bridge          (body.markdown-body → --vmarkd-*, shared by all themes)
2. VS Code neutralizers  (!important LOAD-BEARING — beats host-injected CSS)
3. Render/Preview        (GitHub fidelity: tokens + structure + deltas)
4. Edit surface IR/WYSIWYG (anti-jank / anti-glitch — explicitly NOT preview-parity)
5. Layout & features     (full-width, tables, geometry)
```

### 4. `build.mjs` "Vditor-origin CSS rewrites" as a first-class mechanism

`varifyVditorPalette` + `patchVditorIndexCss` (and future ones) form a documented section: the **preferred home for changing Vditor's own CSS rules**, instead of `!important` overrides in `main.css`. Each rewrite is anchor-asserted so a Vditor version bump fails the build loudly.

## Alternatives considered

- **CSS Cascade Layers (`@layer`)** — rejected. Source-patches handle "ours-vs-Vditor" more cleanly (at the source), and the dominant antagonist — VS Code's **unlayered** injected CSS — beats any layered rule, so `@layer` can't retire the largest `!important` bucket. Tokens + source-patches win.
- **Naive `!important` removal** — rejected. Spike-verified that the remaining ones are load-bearing (VS Code defaults / anti-jank / geometry); removal regresses.
- **Keep shipping the full verbatim github-markdown-css** — rejected (task 109): ~23 KB per theme + its own `!important`, and a second incompatible model vs the token themes.
- **Shadow DOM / scoping** — rejected. Vditor doesn't use it; retrofitting would break the whole editor.

## Consequences

- **+** Every `!important` is either routed away (token / source-patch) or justified by its section's documented contract; `main.css` becomes self-documenting and shrinks over time.
- **+** Edit and Preview are decoupled — no more chasing parity; the edit surface is free to be editing-optimized, the preview free to be GitHub-faithful.
- **+** Vditor-origin fixes have a clean home (build-time source-patch) instead of `!important` arms races.
- **−** Relies on patching Vditor's source (CSS + TS) — anchor-drift risk on a Vditor bump, mitigated by build-time asserts; a fork is the accepted long-term backstop.
- **−** The VS Code-neutralizer, geometry/feature, and edit-surface anti-jank `!important` **stay** — they are irreducible by these levers. This ADR makes them legible, not gone.
- **−** Requires discipline: new styling goes through the routing rule, not straight to a `main.css` `!important`.

## Follow-ups (not this ADR)

- Audit edit-surface (section 4) rules under the dropped-parity contract: split each into anti-jank/anti-glitch (keep) vs pure static `edit == preview` equalizer (drop). Per-rule test: "if removed, does it jank, or just render with larger static spacing?"
- Reorganize `main.css` into the labeled sections above.
- Continue tokenizing themes (github-dark) and moving Vditor-origin fixes to source-patches as they come up.

## Amendment 2026-07-27 — routing-rule compliance audit (task 402)

**New baseline:** `main.css` is 1705 lines / 78 `!important`, up from **1009 lines / 71
`!important`** at the exact ADR-0003 commit (`d89c53f`, 2026-06-13) — this ADR's own
"~900/~62" was a rough estimate at authoring time, not the committed figure; `d89c53f`
is the precise diff baseline used below. Six weeks of diagram-engine work (wavedrom,
nomnoml, geojson/topojson, vega/vega-lite, stl, d2, callouts, html-comment previews)
account for essentially all of it: **+696 lines (+69%) vs only +7 `!important` net
(+10%)** — the routing rule is doing its job: the growth is overwhelmingly
non-`!important` CSS (new selectors, tokens, `@font-face`, plain layout), not new
overrides.

**Classification of the 8 new `!important` declarations** (net +7 after 1 removal) against
the routing table:
- **2 — VS Code injected-default neutralizers** (category 1, irreducible): stripping the
  injected `<code>` foreground/background from SMILES's `<code class="language-smiles">`
  wrapper, and from the html-comment preview's `<pre>`.
- **5 — our own feature / edit-surface anti-jank** (category 2/3, irreducible): the
  html-block comment phantom-height fix (`content: none !important`), the full-preview
  single-scroller overflow/height/padding trio (a refactor of 3 pre-existing `!important`
  lines to be width-agnostic, not new count), and the html-block expanded-source
  background reset.
- **1 borderline, flagged (not fixed here):** `pre > code:is(.language-echarts,
  .language-mindmap) { height: auto !important }` overrides a **Vditor-authored** CSS rule
  (`index.css`'s `.language-echarts, .language-mindmap { height: 420px }`) in the one
  layout Vditor's own cancel-rule doesn't reach (source `<pre>` isn't `:first-child` for a
  diagram block). Per this ADR's own routing table, a Vditor-originating rule should
  ideally be countered via `patchVditorIndexCss` (build-time source-patch), not a
  `main.css` override of Vditor's selector. Recorded as a candidate follow-up for whoever
  next touches `patchVditorIndexCss` — low priority: it's a single, thoroughly-commented,
  narrowly-scoped rule, not a repeating pattern.

**Section reorganization (checklist item):** `main.css` still has **no** labeled-section
structure (only one ad-hoc `── HTML comment previews ──` banner near the end) — this is
**not new drift**, it was already an open, un-scheduled follow-up in this ADR's own
"Follow-ups" list above (2026-06-13) and remains open. Not resolved by this audit; still
tracked there.

**Conclusion:** growth since 2026-06-13 is legitimate — new diagram-engine surface area,
not a bypass of the routing rule. No misrouted `!important` requiring an in-place fix was
found; one low-priority candidate (echarts/mindmap height) is flagged above for a future
`patchVditorIndexCss` pass. **This is the new checkpoint baseline for the next audit:
1705 lines / 78 `!important` as of 2026-07-27.**

## Amendment 2026-07-31 — specificity-based overrides (task 464)

Task 402's audit only covered `!important` declarations. An override doesn't need
`!important` to violate the routing rule — higher specificity or plain load order beat
Vditor's own rule just as well, and that whole class was unaudited. Task 464 covered it.

**New baseline:** `main.css` is 1850 lines / 84 `!important` (up from 1705/78 — task 402's
own flagged echarts/mindmap candidate accounts for none of the growth; six weeks of
further diagram/theming/list work does). Of the **115 rule blocks** whose selector
references a `.vditor*` class (171 selector-branches, 217 declarations), **55
`!important` declarations sit across 29 of them** — consistent with task 402's file-wide
count, re-derived per-rule this time.

**Specificity/load-order class, measured for the first time:** cross-referencing every
`.vditor*` selector in `main.css` against Vditor's own `index.css` (exact-selector and
ancestor-suffix matching, kept only where the declared properties actually overlap) found
**21 rule blocks that mechanically collide** with a Vditor-declared rule on the same
selector — the vast majority of the 115 reference `.vditor*` only as a DOM-scoping hook for
classes Vditor never styles (diagram sizing, callouts, wiki chips), so 21/115 is the
meaningful denominator, not 115. Of those 21: **7 win by specificity alone** (no
`!important` needed — e.g. `.vditor-reset .vditor-ir__link` (0,2,0) over Vditor's own
`.vditor-ir__link` (0,1,0)), **4 win by identical-selector load order alone** (main.css
loads after `index.css` at equal specificity), and **10 carry `!important` on top of a
specificity/order win** (8 of those `data-use-vscode-theme-color`/`data-full-width`/
`:has()`-mode-gated: Vditor's static file can hold only one value per selector, vMarkd
needs a different one per runtime mode, so the `!important` is load-bearing against
Vditor's own var-driven declaration in the *other* mode — irreducible, not misrouted; the
other 2 are the unconditional task-43 font rule and the table/td-th rule, both genuinely
misrouted but deferred, see below).

**Classification of the 115 against the 4-category routing table:** category 1 (VS Code/
webview injected-default neutralizer) 4, category 2 (IR/WYSIWYG edit-surface anti-jank) 20,
category 3 (layout/geometry/our own feature — by far the largest, includes 11 mode-gated/
wrapper-scoped/by-design collisions plus Vditor's own CSS-custom-property extension points
used as designed) 81, category 4 (genuinely misrouted) 10.

**Of the 10 category-4 rules: 2 converted** (`.vditor-ir__link` colour/underline;
`.vditor-reset pre > code` background-image hatch — both via new anchor-asserted
`patchVditorIndexCss` entries in `build.mjs`), **1 reclassified 4→3** (the echarts/mindmap
`height:auto` item task 402 flagged — re-examined: Vditor's 420px rule is correct for the
render div and only wrong for the editable `<code>` sharing its class; there is no correct
Vditor-source edit, only a place to relocate the same override), **8 found and deliberately
left for a follow-up decision** rather than converted unilaterally (Edit-surface HR margin
parity, table `display`/`width` + td/th `white-space`/`word-break`, the task-43 editor-font
rule, `.vditor-outline` width, `.vditor-tip__close` position, the link-ref-defs marker
relabel) — full detail, line numbers, and reasoning per item in
`tasks/464-main-css-specificity-overrides-audit.md`.

**This is the new checkpoint baseline for the next audit of either class: 1850 lines / 84
`!important` (file-wide), 115 `.vditor*`-selector rule blocks / 21 genuine Vditor-rule
collisions (7 specificity-only / 4 load-order-only / 10 with `!important`) as of
2026-07-31.**

## Amendment 2026-07-31 — "patch at source" means every source (task 465, closing a task-464 finding)

One of task 464's two executed conversions (`.vditor-ir__link` → `patchVditorIndexCss`) shipped a
dark-mode regression: Vditor declares that selector in **two** stylesheets, `index.css` and
`content-theme/dark.css`, and only the first was patched — equal specificity, `dark.css` loads last,
so it silently won in every dark session once the `main.css` override that used to out-rank it was
deleted. Light mode looked correct, because `light.css` carries no such rule, which is exactly how
this would have shipped unnoticed. Checking one Vditor-shipped stylesheet is not the same as checking
every stylesheet Vditor ships the rule in — the routing rule's "fix Vditor's own rule at the source"
is only satisfied once **every** source is accounted for. Rule (and the fix pattern,
`patchContentThemeIrLink`): full detail in ADR-0004's 2026-07-31 amendment, "CSS — a third patch shape,
and 'every source'".
