# Task 532 — One content look across all five stages (overlay · IR · WYSIWYG · Preview · split), theme-aware, gated

> **Status:** 🚧 in progress — decisions taken 2026-10-08; **step 1 (the gate) implemented 2026-10-08**, step 2 (token plumbing) implemented 2026-10-08, step 3 (apply the decision) implemented 2026-10-08 (VSIX install + eyeball pending), steps 4, 6, 7, 8 and the link-colour step done; 5d deferred by decision; end-of-task gates run, follow-ups open.
> **Source:** user (2026-10-08): "We need a good mechanism to keep the look of the text consistent
> between these stages, because it keeps drifting apart — and it must take the colour themes into
> account." Raised by two analyses done the same day: `tmp/fable-preview/report.md` (Preview toggle
> jumps) and `tmp/fable-overlay/report.md` (instant-paint overlay looks wrong).
> **Value / Risk:** 🔴 high — every open and every mode switch is a visible jump today, and the
> parity specs that exist did not catch it / **medium-high** — touches the geometry of every surface
> (ADR-0003's dropped-parity decision is reversed), the serializer (loose lists), the overlay
> pipeline and ~7 existing specs. Staged so each increment is measurable by the new gate.
> **Engines:** none directly; diagram placeholders in the overlay touch the render cache (task 184).

## Problem

Five stages render the same document and each has its own CSS scope, DOM producer and decoration
pass, so they drift independently and nothing structural stops it:

| stage | DOM producer | decorations | CSS scope |
|---|---|---|---|
| 1. instant-paint overlay `#vmarkd-prerender` | host Node Lute `renderForMode` (`src/lute/lute-host.ts`) | wiki chips + soft-break spans only (string transforms) | `.vditor-ir/.vditor-wysiwyg > pre.vditor-reset` |
| 2. IR editor | webview Lute `Md2VditorIRDOM` + per-edit spin | `runFinishInit` observers (`media-src/src/boot/finish-init.ts`) | `.vditor-ir .vditor-reset` + edit-surface rules |
| 3. WYSIWYG editor | webview Lute `Md2VditorDOM` | same observers (bound to `#app`) | `.vditor-wysiwyg .vditor-reset` |
| 4. full Preview overlay | `getMarkdown(vditor)` = `VditorIRDOM2Md(ir DOM)` → `Md2HTML` | `preview-callouts`, `preview-code-refs`, `preview-html-comments` + Vditor's own renderers | `.vditor-preview .vditor-reset` + task-110 block |
| 5. split (sv) right pane | same as 4 | same as 4 | same as 4 (narrower pane) |

### Measured evidence (2026-10-08, real VS Code 1.130 under xvfb, user's config: `vscode-dark-2026`, fullWidth, markers off, reflow off, 14px)

From `tmp/fable-preview/report.md` (data: `ir.json`, `wysiwyg.json`, `ir-notheme.json`, `sv.json`):

- **Lists +12px per nesting level in Preview**: `ul/ol` `padding-left` 28px (edit, Vditor `2em`) vs
  40px (Preview, `media-src/src/main.css:1759`, task 110). The only horizontal delta in the document.
  Theme-independent — github/material Previews are 40px too although GitHub itself is `2em` (side bug).
- **Document shorter in Preview, blocks slide up to −82px**: `margin-bottom` 16px → 0.7em (9.8px) on
  every p/ul/ol/blockquote (`main.css:1747`), accumulating; loose list −25px (see next); code block
  −5.6px per 4 lines (`main.css:1777` `line-height: 1.5` vs the theme's inherited 1.6).
- **Loose list renders TIGHT in Preview** (99.2 → 74.2px, and no paragraph spacing inside items):
  Preview renders `VditorIRDOM2Md(ir.innerHTML)`, and that round-trip is lossy. Re-proven in Node
  on the shipped `lute.min.js` (`tmp/532-probe/loose.cjs`): `Md2VditorIRDOM("- a\n\n- b")` →
  `<ul><li><p>a</p></li>…` (looseness IS in the DOM: tight lists carry `data-tight="true"`, loose
  ones wrap items in `<p>`), but `VditorIRDOM2Md` → `"- a\n- b\n"`. Same for `ol`, nested, task
  lists. Already known for the disk path (`test/backend/minimal-diff-writeback.test.ts:173`).
- **Prose line-height is identical (22.4px)** only because task 110's `.vditor-preview .vditor-reset
  { line-height: 1.571 }` (0,2,0) LOSES to the theme's `body.markdown-body .vditor .vditor-reset
  { line-height: 1.6 }` (0,3,1) — dead rule under the vscode themes; under NO theme (Monokai) the
  vertical delta changes sign (edit 1.5 vs Preview 1.571).
- **Reflow ON** (not the user's case): the `↵` marker (`.vmarkd-softbreak::before`, `main.css` tail)
  has width (0.75em glyph + padding) → wrap points differ from the marker-less Preview ("Final
  paragraph one" 3 lines edit vs 2 lines Preview; doc 1617 vs 1526).
- IR and WYSIWYG are pixel-identical to each other; scroll restoration is fine (residual ≤13px is
  the rhythm delta spread around the viewport centre).

From `tmp/fable-overlay/report.md` (data: `*-B-held.{png,json,html}`, `*-C-live.*`, `*-A-frames.json`):

- Base typography overlay == live (same sheets, same body attrs/vars, h1 28/35px, p 14/22.4px).
  **The mismatch is DOM/decoration, not CSS**: callout = plain blockquote with literal `[!TIP]`
  (16px shorter → everything below shifts); code block un-highlighted (colour only, geometry OK via
  the `main.css:1473` mirror); diagram shows raw source (`<hr>` 363px higher → big jump at swap);
  toolbar clone taken before `installToolbarOverflow` (full row vs `⋯`); overlay
  `background:transparent` (`html-builder.ts:169`) → live editor bleeds through in the held state.
- **Mode mismatch**: host picks `globalState[KeyVditorOptions].mode`
  (`src/app/markdown-editor-provider.ts:186-194`), webview applies `options.defaultMode` LAST
  (`media-src/src/boot/vditor-options.ts:95-98`) → with `defaultMode: wysiwyg` the overlay is IR DOM.
- The overlay is visible at t≈921ms and `main.js` has run by t≈930ms (zero painted frames in
  between, all variants) — so webview-side decoration of the overlay would cover every frame a user
  can see; host-side duplication of the decorators is not needed for the visible window.

### Why the seven existing parity specs let this through

| spec (`test/vscode-e2e/`) | what it pins | the hole |
|---|---|---|
| `preview-spacing.spec.ts` | task 110: Preview = 40px/0.7em/1.571, IR = 28px/16px/1.5 | asserts the DIVERGENCE as correct, Monokai-pinned (so the vscode-theme cascade is never measured) |
| `parity.spec.ts` | IR vs Preview block heights, `>8px` threshold | threshold tuned for the 58-72px phantom bug; 6-26px rhythm deltas pass; `theme.content: auto` only |
| `wysiwyg-parity.spec.ts` | diagram markup identity, callout heights | WYSIWYG↔Preview callout check was LOOSENED to a bounded delta by task 480 to accept the 110 split |
| `mode-switch-parity.spec.ts` | scroll anchor drift after IR⇄Preview | scroll logic, not layout; centre-aligned so rhythm deltas hide |
| `font-parity.spec.ts` | vscode themes vs VS Code's NATIVE preview (prose + headings) | one surface (IR) vs the external oracle; never compares our own stages |
| `prerender-style-parity.spec.ts` | overlay vs live: computed style + rect of 6 outer blocks | fixture has no callout/diagram; probes the outer `div[data-type=code-block]`, never the inner `code` class/colour; `auto` + no `defaultMode` |
| `prerender-reflow-parity.spec.ts` | overlay vs live block tops with reflow on/off | overlay-only; never looks at Preview |

Common pattern: each spec compares ONE pair of stages on ONE fixture under ONE theme with a
threshold written for one historical bug, and several encode the divergence as the contract. There
is no single place that says "these N element types must look identical across these 5 stages under
these themes, except for this documented list".

## Goal

1. **Structural:** content geometry (indent, margins, leading, code box, heading rhythm) has ONE
   definition applied to every stage; a theme may change it only through tokens, which change all
   stages at once. Decorations (callouts, code highlight, soft breaks, wiki chips, comments, diagram
   placeholders) come from ONE registry consumed by the overlay, the editors and the Preview. The
   Preview renders the same markdown the editor holds without a lossy round-trip.
2. **Gated:** one parity gate — canonical fixture × every element type × every stage × a theme
   matrix — compares per-element computed styles, block rects and decoration markers, with an
   explicit tolerance policy and a checked-in allow-list of INTENDED differences (each documented,
   stale entries fail). New themes, element types and decorators cannot be added without registering
   with it (unit tests fail otherwise).
3. The product question (target geometry) is decided explicitly — see *Open decisions*.

Out of scope: diagram pixel equality (already `diagram-visual.spec.ts`, task 375); the SV LEFT pane
(plain source text, not a render); Marp (separate branch).

## Design

### A. Single source of truth for content geometry (addresses (a))

**Rule:** geometry is a property of the *content*, never of the *surface*. Every stage renders inside
a `.vditor-reset` (overlay: `pre.vditor-reset`; IR/WYSIWYG: `pre.vditor-reset`; Preview/sv:
`div.vditor-reset`) — that is the one selector root. Surface-scoped selectors
(`.vditor-preview`, `.vditor-ir`, `.vditor-wysiwyg`, `#vmarkd-prerender`, `.vditor-sv`) may only
carry (i) edit chrome that is geometry-neutral when a block is collapsed (dual-node anti-jank,
h:0 markers, expanded-source panels, gutter markers) or (ii) an allow-listed exception.

**Mechanism — geometry tokens, same shape as the `--vmarkd-*` palette tokens (tasks 84/85):**

```
--vmarkd-geo-line-height        (Vditor 1.5 | VS Code 1.6 | GitHub 1.5)
--vmarkd-geo-block-gap          (16px | 0.7em | 16px)        p/ul/ol/table/blockquote/dl/details/hr + li > p
--vmarkd-geo-list-indent        (2em | 40px | 2em)
--vmarkd-geo-heading-lh         (1.25 everywhere — VS Code measured 1.25, task 443)
--vmarkd-geo-heading-margin     (24px 0 16px)
--vmarkd-geo-code-lh            (1.5)  code BLOCK panel only, never inline code
--vmarkd-geo-code-pad / -border / -radius   (already --vmarkd-code-box-* for the vscode pair; generalise)
--vmarkd-geo-bq-pad / -border-w (0 16px 0 10px / 5px for vscode, GitHub's otherwise)
--vmarkd-geo-font-family        (task 443's stack vs the github bridge stack)
```

- **Vditor-origin geometry rules become `var(--vmarkd-geo-*, <vditor default>)` at build time**
  (`build.mjs` `patchVditorIndexCss`, new `varifyVditorGeometry`, anchor-asserted exactly like
  `varifyVditorPalette`). Targets: `.vditor-reset { line-height }`, `.vditor-reset ul/ol
  { padding-left; margin-bottom }`, `.vditor-reset p/blockquote/table { margin-bottom }`, heading
  margins/line-height, `pre > code` box. ADR-0003 mechanism row 2 ("change a rule originating in
  Vditor → source patch") — no new `!important`.
- **One geometry layer in `main.css`** (new labeled section "3a. Content geometry — ALL stages")
  holds the rules Vditor has no counterpart for (`li > p`, the un-highlighted code-box mirror
  generalised to tokens, hr), rooted at `.vditor-reset`, no surface scope.
- **Theme profiles set tokens only.** `media/markdown-themes/vscode-*-2026.css` set the VS Code
  profile; `github-*.css` the GitHub profile; `material-dark.css` inherits the default. The profile a
  theme declares applies to all five stages by construction. The default (no `markdown-body`, e.g.
  `auto` under Monokai / high-contrast) is whichever the user picks in decision 1.
- **The task-110 block (`main.css:1722-1779`) is deleted** and its values move into the vscode
  profile's tokens (or are dropped, per decision 1). The `:is(pre, pre code) { line-height: 1.5 }`
  rule (task 480 fix) becomes `--vmarkd-geo-code-lh` applied to every stage, so the 1.5-vs-1.6
  mismatch the report found cannot recur.
- **Heading gutter markers** (`main.css:1338-1343`, six hardcoded line-heights — task 443 finding 3)
  become `calc(var(--vmarkd-geo-heading-lh) × <scale> × var(--me-font-size))` so they follow the
  profile; they stay edit-only (geometry-neutral: floated, `::before`).
- **Edit-surface rules audit** (ADR-0003's own open follow-up): every rule in `main.css` scoped to
  one surface that declares a geometry property (`margin|padding|line-height|font-size|font-family|
  width|height|text-indent|border-*width|gap`) must either carry a `/* @surface-only: anti-jank —
  <why> */` tag or be deleted. Known candidates: `:is(.vditor-ir,.vditor-wysiwyg) .vditor-reset
  div[data-type=code-block] { margin:1em 0 }` (keep, tagged — it mirrors the Preview `pre` margin so
  it IS the shared value; better: both read `--vmarkd-geo-block-gap`), `.vditor-preview .vditor-reset
  > :last-child { margin-bottom:1em !important }` (keep, tagged: the IR equivalent is the trailing
  paragraph), the full-width/narrow padding pairs (`1284-1320`, `1655-1720` — already mirrored
  values; make both read one `--vmarkd-gutter` expression).
- **ADR change:** new **ADR-0009 "Content parity across stages"** supersedes ADR-0003 §1's "we drop
  Edit↔Preview spacing parity" and §Consequences "Edit and Preview are decoupled". ADR-0003 gets an
  amendment pointing to it; its per-surface *behaviour* contracts (anti-jank, no glitches) stay, the
  per-surface *rhythm* freedom goes. Mechanism table gains a row: "Geometry value → `--vmarkd-geo-*`
  token (theme profile sets it; Vditor-origin value varified at build)". Task 110's decision is
  recorded as superseded in `tasks/done/110-…md` (one line).

### B. Single source for content transforms (addresses (b))

**Rule:** a decoration is a registry entry with a pure synchronous pass; every stage is decorated by
iterating the same registry. No stage-specific decoration code.

```ts
// media-src/src/editing/content-decorators.ts
export interface ContentDecorator {
  name: string                         // 'callouts' | 'code-source' | 'html-comments' | 'code-refs' | 'soft-breaks' | 'wiki-chips' | 'diagram-placeholder' | 'wysiwyg-highlight' …
  stages: ReadonlySet<'overlay'|'edit'|'preview'>
  decorate(root: Element): void        // one synchronous pass, idempotent (every observer already has this — callouts "first batch synchronously")
  observe?(root: Element): Disposable  // the MutationObserver form for live surfaces
  parityMarker?: string                // CSS selector the gate counts per stage, e.g. 'blockquote[data-callout] > .vmarkd-callout__preview', 'pre > code.hljs', '.vmarkd-softbreak', '.wiki-link-chip'
}
export const CONTENT_DECORATORS: readonly ContentDecorator[]
```

- `runFinishInit` replaces its hand-written `observers.set('callouts', …)`, `'preview-callouts'`,
  `'html-comments'`, `'preview-html-comments'`, `'code-refs'`, `'preview-code-refs'`, `'code-source'`,
  `'soft-breaks'`, `'wysiwyg-highlight'` with one loop over the registry (`#app` for `edit`,
  `previewEl` for `preview`). Behaviour unchanged; the registry is the only list.
- **Overlay decoration = the same loop over `#vmarkd-prerender` from `main.ts`, before `new
  Vditor()`** (`stages` has `overlay`). Covers callouts, code-source `.hljs` tagging + synchronous
  `hljs.highlightElement` (hljs is preloaded by `html-builder.ts` whenever the doc has a fence —
  `docHasCodeFence`), html comments, code refs. Soft breaks and wiki chips stay host-side string
  transforms (they are already parity-tested: `media-src/src/editing/soft-break-html-parity.test.ts`
  pins `wrapSoftBreaksInHtml` against `wrapTopBlock`; add the same corpus test for
  `renderWikiChipsInHtml` vs the webview custom renderer) and are registered with
  `decorate = noop, parityMarker` so the gate still counts them in every stage.
- **Toolbar clone** (`prerender-overlay.ts` `showRealToolbarInOverlay`) runs after
  `installToolbarOverflow`, or the clone gets the overflow applied (`installToolbarOverflow` is
  pure DOM; call it on the clone).
- **Diagrams in the overlay** (`diagram-placeholder` decorator): hide the raw source of every
  `pre.vditor-ir__preview > div.language-<engine>` and reserve the block's height. Height source, in
  order: (1) the host render cache (task 184, `diagram-cache-host.ts`) — extend its metadata with
  `{width,height}` of the cached SVG and inline a `data-vmarkd-placeholder-h` on the preview div in
  `renderForMode` (host has the cache at HTML-build time; key = the same trimmed source hash
  `nativeSourceForLive` uses, task 480); (2) no cache → a fixed `--vmarkd-geo-diagram-min-h`
  placeholder (still a jump, but a bounded one). Phase 2 (own step, size-budgeted): inline the cached
  SVG bytes themselves into the overlay so the overlay shows the diagram.
- Registration enforcement: `test/backend/content-decorators.test.ts` asserts (i) every
  `observers.set('<name>', …)` in `finish-init.ts` that binds to `#app`/`previewEl` is a registry
  name (text scan, same style as `probe-tier-convention.test.ts`), (ii) every registry entry with a
  `parityMarker` is exercised by the canonical fixture (the marker count in a Node-Lute render + the
  decorator pass is > 0 — jsdom, no browser), (iii) every `.language-*` engine in
  `media-src/src/diagram-kit/engine-registry.ts` is covered by the placeholder decorator's list (the
  same list `main.css:1425` hardcodes twice today — make `main.css` read it from a generated file or
  assert the two lists equal).

### C. Preview from the editor's markdown without a lossy round-trip (addresses (c))

Measured: the loss is in `VditorIRDOM2Md`/`VditorDOM2Md`, not in the DOM — the IR DOM distinguishes
loose (`<li><p>`) from tight (`data-tight="true"`), the serializer emits tight for both. Two shapes:

1. **Repair the serialization (recommended).** `src/shared/lute-block-repair.ts` already hosts
   oracle-checked repairs of Lute's round-trip (`repairIrBlocks`, `restoreRefDefTitles`, task 239/
   240/370/530 pattern). Add `restoreLooseLists(irHtml, md, md2html)`: for each top-level list block
   in the IR DOM that is loose (no `data-tight`, items wrap `<p>`), re-insert the blank line between
   its items (and between a nested loose list's items) in the serialized markdown; verify with the
   oracle `md2html(repaired)` ≡ `Md2HTML` of the pre-serialization HTML (looseness is visible there:
   `<li><p>`). Apply at the ONE serialization authority: Vditor's `getMarkdown.ts` via a one-anchor
   esbuild patch routing through `window.__vmarkdSerializeIr` (same seam shape as
   `__vmarkdMorphPreview`), plus the incremental per-block path in `edit-sync.ts:63/164`. Effect:
   Preview renders loose lists loose, `getValue()` no longer collapses them, and minimal-diff
   writeback (task 61) no longer rewrites an edited loose list as tight. `reserializeMarkdown`
   (`lute-host.ts`) applies the same repair so the no-op equivalence stays honest. **Scope decision
   for the user:** Preview-only (route only `__vmarkdPreviewMd2HTML`'s input) vs everywhere
   (recommended — "round-trip fidelity is sacrosanct", ADR-0005 Philosophy).
2. **Render the Preview from the host document text.** Rejected as the primary: after an edit the
   host text is itself the webview's (lossy) serialization for the edited block, so it only helps
   for untouched blocks and adds a host round-trip to every Preview toggle.

Lute itself is not patched (memory: broad Lute patching rejected; a count-asserted build-time anchor
is allowed but the fix belongs in our repair layer, where the siblings live).

### D. ONE comprehensive parity gate (addresses (d))

**Canonical fixture** `test/vscode-e2e/fixtures/parity-canon.md` (shared with the harness via a
symlink or a copy asserted equal by a unit test), ~120 lines, every element kind once, in the order of
the element registry: h1–h6, paragraph (soft-wrapped), hard break, bold/em/strike/inline code/link/
autolink/image (data: URI), tight ul, loose ul, nested ul (loose outer, tight inner), ol, task list,
blockquote, nested blockquote, callout ×2 (note + custom title), fenced code (ts, 5 lines), indented
code, inline math, block math, table (3 cols, alignment), hr, footnote, html comment, raw html block,
wiki link (`[[page]]`), code ref (`src/foo.ts:42`), ONE native diagram (mermaid, 3 nodes — fast,
deterministic with the cache) and ONE custom engine (d2, 2 nodes), frontmatter. Heavy engines stay
in `all-renderers.md` / `diagram-visual.spec.ts`.

**Element registry** `test/parity/elements.ts`: `{ kind, fixtureSnippet, probe: selector per
stage root, expectDecorations: marker names }`. The fixture is generated from the registry
(`scripts/gen-parity-fixture.mjs`, checked in; a unit test asserts the committed fixture equals the
generated one), so an element kind cannot exist without a probe and vice versa.

**Snapshot** (one function, used by both layers; lives in `test/parity/snapshot.ts` and is inlined
into `evaluate()` as a string like `READ_METRICS` today): for a stage root, for each registry kind:

- geometry: block rect `{top − rootTop, height, firstGlyphX}` (first text node via `Range`), plus for
  lists the first `li` glyph x and nested `ul` left;
- computed style on the block AND on its first text-bearing descendant: `font-family, font-size,
  font-weight, line-height, color, background-color, margin-top/bottom, padding-*, border-left-width,
  text-indent, list-style-position`;
- decoration markers: counts of each registry `parityMarker` under the block, plus `hljsTokens`
  (`.hljs span` count > 0), `svg` present, `katex` present, checkbox count, `.vmarkd-softbreak`
  count;
- a DOM-shape signature: tag path of the block's first 3 levels with Vditor wrapper classes stripped
  (`vditor-ir__node`, `vditor-ir__preview`, `vditor-wysiwyg__block`, `data-*` removed), so `<li>` vs
  `<li><p>` (the loose-list bug) is a diff, while legitimately different wrappers are not.

**Comparison and tolerance policy** (checked into `test/parity/policy.ts`, one place):

| axis | rule |
|---|---|
| overlay vs IR (or WYSIWYG — the overlay's mode), same width | rect exact to **0.5px** (sub-pixel rounding), styles exact string, markers exact, shape exact |
| IR vs WYSIWYG | same as above |
| collapsed IR vs Preview (full overlay), same width | rect `top/height/firstGlyphX` exact to **1px** (one CSS px of rounding across two different scrollers), styles exact, markers exact except markers flagged `editOnly` (none expected after step 6; soft-break `↵` is `editOnly` by design — see decision 3), shape exact |
| Preview vs sv right pane (narrower) | styles exact; indent/margins/padding exact; rects NOT compared (different wrap width); markers exact |
| themes | the same table per theme; nothing is compared ACROSS themes (a theme is allowed to differ from another — only stages must agree) |
| IR expanded state, caret inside a node | out of scope of the gate (the caret is parked in the trailing paragraph before every snapshot; `expandMarker` never fires) |

Failures are reported per `(theme, stagePair, kind, property, expected, actual)` so one run lists the
whole drift, not the first assert.

**Allow-list** `test/parity/allowed-differences.json`: entries `{theme|'*', stagePair, kind, property,
reason, task, addedOn}`; an entry suppresses exactly one cell. Two guards: (i) an entry that no
longer suppresses anything FAILS the run ("stale allow — delete it"), so the list ratchets down; (ii)
no wildcard on `property`. The list is seeded in step 1 with TODAY's measured differences (every row
of the two reports: list indent, block gap, loose list shape, code lh, overlay callout/hljs/diagram/
toolbar, overlay bg, reflow markers) — so the gate is green on day one and each later step is proved
by deleting its entries (that deletion is the step's RED→GREEN).

**Theme matrix and cost** (boot is per `test()`, ~5s floor + fixture settle; one test captures ALL
stages in one boot: hold overlay → IR → WYSIWYG → Preview → back → sv, ~60–90s):

| tier | boots | configurations |
|---|---|---|
| **fast** (`FAST_SPECS`) | 1 | `theme.content: auto` under `Default Dark Modern` (= `vscode-dark-2026`, the out-of-box and the user's config), reflow off, fullWidth on, markers off |
| **full / nightly** | 10 | the 5 named themes (`CONTENT_THEMES`, iterated — a new row is in the matrix automatically) + `auto`/Monokai (no content theme, the Vditor/default profile) + `auto`/`Default High Contrast` (VS Code vars path, HC colours) + 3 variants on `vscode-dark-2026`: reflow ON, `fullWidth: false` (narrow column, both gutter expressions), `headingMarkers: true` + `theme.code: monokai` (explicit code theme — code-box geometry drift) |
| chromium harness (`media-src/e2e/parity.spec.ts`) — CI, every PR | 0 (≈1–2s per config) | all 10 configurations: `parity-harness.html` loads `index.css` + `main.css` + the real theme file + Vditor content-theme + the simulated VS Code injected sheet (`installRealWebviewBaseline`, `content-theme.spec.ts`), boots Vditor on the canonical fixture, and injects a `#vmarkd-prerender` whose HTML a Playwright `globalSetup` produced with Node Lute (`renderForMode` imported from `src/lute/lute-host.ts` — same code the host runs). Compares the same snapshot with the same policy and the same allow-list. It cannot see VS Code's real injected CSS or the custom-editor pipeline; it CAN see every drift in our own CSS, DOM producers and decorators, which is where all of today's findings are |

~10 boots ≈ 12–15 min added to a 1–2h nightly; the fast tier gains one ~75s test. The 7 legacy
specs: `preview-spacing` (rewritten to assert the profile on ALL stages), `parity`, `wysiwyg-parity`
(callout check back to exact), `prerender-style-parity`, `prerender-reflow-parity` fold into the
gate and are deleted once the gate covers their assertions (each deletion lists the cell that now
covers it); `font-parity` (external oracle: VS Code's native preview) and `mode-switch-parity`
(scroll) stay.

### E. Forced registration for new themes / elements / decorators (addresses (e))

Unit tests (vitest, no boot), all `test/backend/parity-registry.test.ts` unless noted:

1. **Themes:** the matrix iterates `CONTENT_THEMES` — structural. Additionally every theme file must
   declare the full `--vmarkd-geo-*` token set or `@profile: default` in its header comment (a theme
   that silently inherits is a drift waiting to happen), and the twin-file test
   (`test/backend/content-theme.test.ts`) extends to the geometry tokens.
2. **Theme files may not scope to a surface:** any selector in `media/markdown-themes/*.css`,
   `media/vditor/dist/css/content-theme/*.css` (post-patch) matching `.vditor-preview|.vditor-ir\b|
   .vditor-wysiwyg|.vditor-sv|#vmarkd-prerender` fails.
3. **`main.css` per-surface geometry lint:** rule blocks whose selector is surface-scoped AND declare a
   geometry property must carry the `@surface-only:` tag; count ratchets to the tagged set (same
   shape as `e2e-settings-hygiene.test.ts`'s hard zero).
4. **Element kinds:** fixture ≡ generated-from-registry; every registry probe matches ≥1 element in a
   Node-Lute render of the fixture for IR, WYSIWYG and HTML (jsdom) — a kind without a probe cannot
   be added; a Lute/Vditor bump that changes a DOM shape fails here first.
5. **Decorators:** every content observer in `finish-init.ts` is a registry entry (text scan); every
   registry `parityMarker` appears in the fixture render after `decorate()`.
6. **Engines:** `engine-registry.ts` languages ≡ the placeholder decorator list ≡ the `main.css`
   `:not(:has(> .language-…))` list (generated into `media-src/src/generated/engine-langs.css` or
   asserted equal).
7. **Allow-list hygiene:** schema-validated; every entry names a task; no stale entry (runtime check in
   the gate, plus a unit check that the referenced task file exists).

The `vmarkd-renderer-theming` skill gains a "geometry tokens — all stages" section and the
`vmarkd-testing` skill a "parity gate — run it for any CSS/decorator/theme change" section; both
`AGENTS.md` lines pointing at parity specs are updated.

## Steps (each = one reviewable commit; RED-GREEN-RED per AGENTS.md)

- [x] **0. Decisions (user, 2026-10-08).** 1 = (A) theme-owned geometry profile applied to all 5 stages,
      1b = VS Code rhythm as the default profile (no theme / HC / material); 2 = loose-list repair
      everywhere incl. saved markdown; 3 = zero-advance reflow marker; 4 = nightly 10 boots;
      5 = placeholder height first (5c), cached SVG (5d) later; 6 = new ADR-0009.
- [x] **1. The gate, seeded with today's drift.** DONE 2026-10-08, no product change. Delivered:
      `test/parity/elements.ts` (registry: 40 kinds + marker table + `PARITY_OBSERVERS`
      classification) → generated `test/vscode-e2e/fixtures/parity-canon.md` (`scripts/gen-parity-fixture.mjs`);
      `test/parity/{snapshot,policy,compare,capture,configs,gate}.ts` + `allowed-differences.json`
      (275 entries); chromium `media-src/e2e/parity-harness.ts` + `parity.spec.ts` (10 configs, ~1.1 min);
      real-VS-Code `test/vscode-e2e/parity-matrix.spec.ts` (fast tier: 1 boot, 9.5 s test / 11.7 s wall;
      full tier: 10 boots, 1m47-2m00 wall, ~10 s per boot — measured twice, the first run was RED on 4
      stale entries that the harness-fidelity fix below removed); `test/backend/parity-registry.test.ts`
      (§E 4, 5, 7 + comparator semantics, 29 tests). Added to `FAST_SPECS` with a cost note.
      **RED first (empty allow-list, `VMARKD_PARITY_ALLOW=none`):** baseline in `tmp/532/baseline.json`
      (harness, 10 configs: 2175 differences, 279 distinct cells) and `tmp/532/baseline-vscode-fast.json`
      (real VS Code, 1 config: 191) — harness and VS Code agree cell-for-cell on the shared config.
      Reproduced (vscode-dark-2026): list `padding-left` 28→40px (+12px first glyph/nesting), block gap
      `margin-bottom` 16→9.8px (`gapBefore` −6.2px per block), loose list 99.17→74.17px (−25px) with
      `shape ul(li(p)…)→ul(li…)`, code line-height 22.4→21px (−6.95px on a 5-line fence = −1.4px/line),
      overlay callout 44.78 vs 60.78px (−16px) + `callout-title`/`callout-type` markers 0→1, overlay code
      `.hljs` 0→1 and `hljs-token` 0→10, overlay mermaid 27 vs 284.39px (−257px; the report's −363px is
      its own, larger diagram). Under NO markdown-body theme (5 of 10 configs) the Preview prose
      line-height 1.571 vs 1.5 shows up on every block (the dead-rule finding). **GREEN** with the
      seeded list: harness 2175/2175 allowed, VS Code fast 191/191, VS Code full 2175/2175, 0 stale.
      Stale rule proven (bogus entry → RED "1 STALE", removed → GREEN); new drift proven (Preview-only
      `h1..h6` line-height 1.25→1.3 in `main.css` → RED, 140 unexplained cells in the harness, 14 in VS
      Code; restored, md5 verified). Deviations / decisions to review:
      - **Not `parity-harness.{html,ts}`**: the harness page is the host's REAL `buildWebviewHtml` output
        (+ Node-Lute `renderForMode` overlay, + the production `media/dist` bundle, + the real VS Code
        webview default sheet incl. its `@layer vscode-default`), built per config in Node — no `.html`
        file and no globalSetup were needed. `serve.mjs` gained a `/media/*` static route. Needs
        `node build.mjs` first (CSS edits are measured only after a rebuild).
      - **Gated rect properties are `height`, `gapBefore`, `left`, `width`, `firstGlyphX`,
        `nestedListLeft`** — not an absolute `top`: one short block would otherwise repeat as ~30 cascaded
        `top` cells. `gapBefore` (distance from the previous kind's bottom) + `height` pins every top.
      - **Allow-list schema extensions** (all backwards-compatible): `theme` may be a list of config ids
        (one entry per cell, not per theme × cell), every entry is PINNED (`delta: [min,max]` for numeric cells, `values: ["exp -> act"]` for strings; union of the harness and real-VS-Code measurements, regenerated by `scripts/pin-parity-allowlist.mjs`) so a CHANGE of an allowed difference (list padding 40->44px) is red, not only a new cell, and `task` is `532 step N` or
        `532 follow-up`. **51 entries were `532 follow-up`** (35 are left after the link-colour and code background/font steps): the gate found drifts no step owns — IR vs
        WYSIWYG for frontmatter / html blocks / table gap / footnote defs / 2.38px code offset, link
        colour + underline in the `auto` themes, math + KaTeX not drawn by the overlay, the split pane
        keeping 10px side padding where the narrow-column Preview centres at 239px. They need a decision.
      - Entries PIN their values (review follow-up): numeric cells carry `delta: [min,max]` (+1px/2%
        slack), string cells `values: ["exp -> act"]`; the pins are the union of the harness and the
        real-VS-Code measurements (window size / fonts / injected colours differ). Proved: main.css
        list padding 40->44px -> harness RED (108 cells), restored GREEN. A pin is regenerated with
        `scripts/pin-parity-allowlist.mjs <red reports>`. The VS Code spec judges in `afterAll`, so a
        filtered (`-g`) run is still judged. The registry moved to `test/parity/elements.ts`.
      - `code-ref` and `wiki-link` are in the registry but inert in the canon (a chip needs a workspace
        file / a wiki document), so their chip markers are listed as unreachable, not asserted.
      - §E 5 was adapted to what exists before step 4: `PARITY_OBSERVERS` classifies every
        `observers.set` in `finish-init.ts` (text-scanned both ways); step 4 replaces it with the real
        decorator registry. The IR-stage "expected markers present" check runs inside the gate.
      - The mode-mismatch overlay (5a) and background (5b) are NOT covered yet (overlay is always the
        IR overlay under `defaultMode: ir`); `root.background-color` is snapshotted but the overlay's
        own container is not.
- [x] **2. Geometry tokens (part 1 — plumbing, no visible change).** DONE 2026-10-08.
      `varifyVditorGeometry` in `build.mjs` (thin wrapper; the rewrite table + count-asserted apply live
      in `scripts/vditor-geometry-patch.mjs`, shared with `test/backend/vditor-geometry-patch.test.ts`:
      8 anchors, each must match EXACTLY once, throws naming the patch otherwise). Token set (default =
      Vditor's value, held in the `var()` fallback): `--vmarkd-geo-line-height` 1.5, `-block-gap` 16px
      (p/ul/ol/blockquote/table margin-bottom, `li p` margin-top), `-list-indent` 2em, `-heading-mt`
      24px, `-heading-mb` 16px, `-heading-lh` 1.25, `-code-pad` .5em, `-code-radius` 5px (`pre > code`).
      Themes: `vscode-*-2026` declare the full set on `body.markdown-body` with today's effective values
      (line-height 1.6, rest = defaults); github/material carry `@profile: default` in the header.
      `main.css` "3a. Content geometry — ALL stages" is the contract comment (no declarations: a default
      declared on `.vditor-reset` would SHADOW the theme's body-level token, so defaults live in the
      fallback); the rules Vditor has no counterpart for arrive in step 3. §E lint tests 1-3 in
      `test/backend/parity-geometry-lint.test.ts` (+ `test/parity/{css-rules,geometry-lint}.ts`): theme
      token set / `@profile: default`, twin parity, no surface selector in `markdown-themes/*` and
      `content-theme/*`, `main.css` surface-scoped geometry rules carry `@surface-only: <reason>` — the 33
      existing rules are TAGGED in place, with a ratchet (`MAX_TAGGED_SURFACE_RULES = 33`, may only shrink).
      **Proof of no visible change:** parity gate GREEN, nothing moved: harness 2175/2175 allowed, 0
      unexplained, 0 stale; real VS Code fast 191/191, full matrix (10 boots) 2175/2175, 0 stale.
      RED proofs: dropped token / removed `@profile` / surface selector in a theme / untagged rule each
      turn the lint red; a changed token default (block-gap 16px -> 17px in the patch, rebuilt) turns
      the harness gate RED (27 unexplained), restored -> GREEN. Not covered in this step (no Vditor
      declaration to varify; arrive with their consumers in step 3): `--vmarkd-geo-code-lh`,
      `-bq-pad`/`-bq-border-w`, `-font-family`, `-code-border`, `-diagram-min-h`.
- Note for step 3 (step-2 review): Vditor content themes `ant-design.css` / `wechat.css` override
  margins/padding with plain selectors, so the geo tokens have no effect under them; the vscode
  themes' `body.markdown-body .vditor .vditor-reset { line-height: 1.6 }` duplicates the token. The
  tagged-rule ratchet is exact (39 today, after the lint learned `.vditor-ir__preview/__node`,
  min/max-width/height and border shorthands); lower it as rules are deleted.
- [x] **3. Geometry tokens (part 2 — apply the decision).** Delete the task-110 block; set the
      vscode profile tokens (40px / 0.7em / 1.25 / code 1.5 / box 16px+1px) and the github profile
      (2em / 16px / 1.5); default profile per decision 1; gutter markers → `calc()`. Delete the
      list-indent / block-gap / code-lh / dead-lh allow entries (RED without the CSS change, GREEN
      with it, RED again when the block is restored). Rewrite `preview-spacing.spec.ts` to assert the
      profile on IR+WYSIWYG+Preview+overlay; `wysiwyg-parity.spec.ts:197` back to `toEqual`;
      `parity.spec.ts` threshold 8 → 1. ADR-0009 + ADR-0003 amendment + task 110 note. Package +
      install the VSIX and let the user judge by eye before continuing (memory:
      install-vsix-to-see-visual-changes).
      **DONE 2026-10-08 (VSIX install + the user's eyeball still pending, see below).** Delivered:
      the task-110 block is gone from `main.css`; the default profile lives on `body { --vmarkd-geo-* }`
      in section 3a (VS Code rhythm: 1.6 / 0.7em / 40px / 24+16 / 1.25 / code-lh 1.5), `vscode-*-2026`
      spell the same values out, `github-*` declare GitHub's (1.5 / 16px / 2em / 1.5 code), `material-dark`
      stays `@profile: default`. New token `--vmarkd-geo-code-lh` (2 more count-asserted patches: `pre`,
      `pre > code`); `dl/details/hr` margin-bottom in 3a; the vscode themes' duplicated `line-height: 1.6`
      and blockquote `margin-bottom: 16px` now read the tokens; the six heading gutter markers are
      `calc(heading-lh token x per-level scale x --me-font-size)` (same px at 14px/1.25); the IR math node
      carries KaTeX's 1em top margin itself (the Preview collapses it with the neighbour gap; once the
      gap fell below 14px IR sat 4.2px high). Tagged-rule ratchet 39 -> 34 (six task-110 rules out, one
      math rule in). **Gate:** allow entries owned by step 3: 167 -> 0 (122 eliminated outright; 45 still
      differ for structural reasons and 2 new math-block `style.margin-top` cells appeared, all 47 retagged
      `532 follow-up` with a new reason — see the list below). RED first with the 167 deleted and the old CSS:
      1257 unexplained (`tmp/532/step3/red-harness.json`); GREEN after: harness 1364/1364 allowed, 0
      unexplained, 0 stale; real VS Code full matrix (10 boots) 1364/1364, 0 stale. Task-110 block restored
      -> harness RED (700 unexplained), `preview-spacing` (github profile) and `wysiwyg-parity` RED; md5
      verified restore. `preview-spacing.spec.ts` rewritten (3 profiles x overlay/IR/WYSIWYG/Preview);
      `wysiwyg-parity` callouts back to `toEqual`; `parity.spec.ts` threshold 8 -> 1 (blocks and callouts).
      ADR-0009 + ADR-0003 amendment + task-110 note + CHANGELOG written. Remaining `532 follow-up` entries
      (need a per-kind decision, NOT the profile): IR source panels vs rendered output (frontmatter,
      html-block, html-comment `text.line-height` 21 vs 22.4: the IR source `code` has the code leading),
      footnote definitions, code/diagram wrapper `style.line-height` (edit wrapper div keeps
      the prose leading, the code lines agree), wiki-link `gapBefore`. DONE since (user decision, 2026-10-08): the diagram bottom margin is `1em` on every stage (main.css §3a rule after the top-margin one; display math keeps its 16px), the `diagram-mermaid style.margin-bottom` allow entry is deleted (gate RED with it deleted on the old CSS, GREEN after; chromium + real VS Code). NOT done: VSIX package + install, the
      `@visual` golden re-base (`npm run test:visual`, local-only), the code-box tokens (`-bq-pad`,
      `-code-border`: the vscode box is still the existing `--vmarkd-code-box-*` + `.hljs` rules, which
      are already identical on every stage).

      **Step 3b (2026-10-08, the three review fixes):** (1) diagram blocks: the Preview's rendered diagram/math
      `div` gets the editors' wrapper top margin (`1em`; main.css 3a, Preview only through a `:not` so the
      render inside the editors' injected preview does not double it), the bottom stays Vditor's 16px, which the
      editors reach through the same margin collapse; the 4.2px `diagram-mermaid rect.gapBefore` regression and the
      `style.margin-top` cells are gone, and the d2 Preview probe is the wrapping `pre` (like the editors' wrapper),
      which removes the d2 margin cells. (2) display math: the IR/WYSIWYG math NODE now carries `margin: 1em 0 16px`
      and the boxes inside (`pre` preview, `.language-math`, `.katex-display`) none, with the 27px click-target
      floor only for a preview with nothing rendered — block top to the next block's top is now 37.3px on IR,
      WYSIWYG and Preview (was 27 / 41 / 37.3, vscode profile); two consecutive math blocks agree by construction (1em / 16px collapse on every stage; the canon fixture has no such pair, so not measured). (3) `hr`:
      the block gap no longer overrides Vditor's 24px; new token `--vmarkd-geo-hr-gap` (GitHub 24px, VS Code
      profile and default 0.5em = the user-agent margin VS Code's own `markdown.css` leaves; it drives the Preview,
      IR and WYSIWYG `hr` and the IR/WYSIWYG footnote rule that stands in for the Preview's `hr`).
      Allow entries: 11 removed (9 diagram/math + 2 table `gapBefore`), 2 added (`overlay>ir math-block rect.height`,
      owned by step 4: the overlay shows raw TeX; the mermaid `style.margin-bottom` cell retagged), footnote-def pins
      re-measured. Tagged-rule ratchet 34 -> 35.
      **Known, NOT fixed (follow-ups):** (a) the heading-marker offset that predates this task: the `#` marker's
      line box is 2-5px taller than the heading's line box on every theme, because the per-level marker scales
      are Vditor's stock sizes x16/14 — needs a per-profile heading-em token; (b) the vscode/github dark and
      light profiles duplicate their `--vmarkd-geo-*` values (themes have no include mechanism; the lint test
      pins the twins equal); left as is.

- [x] **4. Decorator registry + overlay decoration.** `content-decorators.ts`; `runFinishInit` loops
      it; `main.ts` decorates `#vmarkd-prerender` before `new Vditor()`; toolbar clone after
      overflow; wiki-chip host/webview corpus parity test. Delete the overlay callout / hljs /
      toolbar allow entries. Registry tests 5–6 of §E. `prerender-style-parity.spec.ts` deleted
      (cells listed in the commit message).
      **Also (user, 2026-10-08): math in the overlay** — the overlay shows raw TeX until KaTeX runs;
      decorate math blocks/inline math in the early overlay pass like hljs/callouts. Removes the
      `math-*` `overlay>ir` allow entries.
      **Step 4 (2026-10-08, done):** `media-src/src/boot/content-decorators.ts` (in `boot/`, not `editing/`:
      it wires editing + links + diagrams observers and putting it in `editing/` made a module cycle) is the
      registry: `{name, stages, decorate?, observe?, parityMarkers}` (`parityMarkers` are NAMES in
      `PARITY_MARKERS`, the selector stays next to the comparator). `runFinishInit` calls
      `observeDecorators('edit'|'preview', ctx, register)` (same `observers.set` keys as before, `preview-<name>`
      for the Preview pane); `main.ts` calls `decorateOverlay(#vmarkd-prerender .vditor-reset)` BEFORE the inline
      init / `new Vditor()` (try/catch per decorator, elapsed ms in `window.__vmarkdOverlayDecorateMs`).
      Overlay decorators: callouts, html-comments, code-source (`.hljs` tagging + synchronous `hljs.highlight` on
      the rendered fences, `editing/overlay-render.ts`), math (KaTeX). Math choice: KaTeX is NOT synchronous
      today (Vditor `addScript`s it lazily), so the host now PRELOADS katex.min.js + mhchem + katex.min.css before
      main.js when the document has math (`hasMath` full-doc gate in html-builder.ts, same ids as Vditor's
      mathRender so it dedupes) — the hljs-preload pattern, not a reserved height. Toolbar clone now runs
      `installToolbarOverflow` on the clone (disposed with the overlay). Wiki chips: host/webview corpus test
      (`test/backend/wiki-chip-parity.test.ts`) found a REAL host bug (a `&` in a page name painted as a literal
      `&amp;`; Lute's escaped HTML was escaped again) — fixed in `renderWikiChipsInHtml`. §E 5: the
      `PARITY_OBSERVERS` text-scan stand-in is replaced by `BEHAVIOUR_OBSERVERS` + registry tests (hand-written
      `observers.set` names == behaviour list; none is a decorator; markers registered/reachable; overlay pass
      adds every overlay-stage marker on the real canon render, idempotent, serialization-neutral).
      **Gate:** the 52 `532 step 4` allow entries are deleted (0 remain); RED first with the old code: 509
      unexplained; GREEN: harness and real-VS-Code full matrix 767/767 allowed, 0 unexplained, 0 stale.
      `prerender-style-parity.spec.ts` + its fixture deleted (its heading/paragraph/list/quote/table/code
      overlay-vs-IR style + rect cells are the `overlay>ir` cells of the gate for h1/paragraph/ul/blockquote/
      table/code-fence under `auto`). NOT done: line-number gutter (`codeBlockLineNumbers`) is not reproduced in
      the overlay highlight (the overlay is decorated before the options are parsed); code-ref chips are not
      decorated in the overlay (need the host resolve round trip); diagrams in the overlay stay raw (step 5c).
      **Cold-start cap (2026-10-08, review):** `decorateOverlay` only decorates the top-level blocks that
      start within TWO viewports (`visibleBlockCount`: one rect-read pass, then the head blocks go into a
      fragment for the decorators and back) — the overlay is not scrollable before the swap. Cold cost on
      40/120-fence docs: 97/77 ms before -> 20/22 ms after (chromium harness, production bundle, first
      load). The parity gate lifts the cap (`window.__vmarkdOverlayDecorateAll`, set by the same
      `VMARKD_PRERENDER_PARITY_HOLD` hook in html-builder.ts) because a test window shows less than the
      canon; `parity.spec.ts` "decorates only the first two viewports" pins the cap itself on real layout.
      **Found, not fixed:** the live editor's `reintroduceChips` (wiki-serialize.ts) double-escapes `&` in a
      wiki page name the same way the host did.
- [ ] **5. Overlay fidelity bugs (from the overlay report, separate but small).**
      - [x] 5a. **Mode mismatch with `vmarkd.editor.defaultMode`:** `resolveOpenMode(savedMode,
            defaultMode)` in `src/shared/` used by BOTH `markdown-editor-provider.ts:189` and
            `vditor-options.ts:95` (`preview` → `ir` overlay); unit test for the 4×4 table;
            `prerender-reflow-parity`'s `openInMode` helper reused in the gate's fast boot with
            `defaultMode: wysiwyg` once per full run.
      - [x] 5b. **Transparent overlay background:** `#vmarkd-prerender { background: var(--vmarkd-
            page-bg, var(--vscode-editor-background)) }` in `html-builder.ts`; the gate's overlay
            snapshot adds the root `background-color` (overlay == live `.vditor-reset`'s effective
            page bg).
      - [x] 5c. **Diagram placeholder height** from render-cache metadata (`{width,height}` added to
            the cache entry on PUT, read in `renderForMode`), fixed fallback min-height; delete the
            overlay-diagram allow entry (bounded tolerance for the no-cache case documented in the
            policy, not the allow-list).
      - [ ] 5d. (phase 2, after a size budget decision) inline the cached SVG into the overlay.
      **Steps 5a-5c done 2026-10-08 (5d open).**
      5a: `src/shared/open-mode.ts` `resolveOpenMode(saved, default)`, used by `markdown-editor-provider.ts`
      (overlay mode; the host resolves `vmarkd.editor.defaultMode` + `defaultModeByGlob` with the same
      `resolveDefaultMode` the webview's option comes from) and `vditor-options.ts`. Unit: 5 x 5 table
      (`test/backend/open-mode.test.ts`). Real VS Code: `prerender-open-mode.spec.ts` (`defaultMode:
      wysiwyg` -> the held overlay is `.vditor-wysiwyg`; `preview` -> `.vditor-ir`). RED with the old
      savedMode logic (wysiwyg case: expected 1, received 0) and with `resolveOpenMode` ignoring the
      default; GREEN restored. NOT done: the gate's fast boot does not run a `defaultMode: wysiwyg`
      configuration (the dedicated spec carries it); a >700KB document is forced to IR by the webview's
      streaming gate while the host may still paint WYSIWYG (pre-existing, not in this step).
      5b: `#vmarkd-prerender` paints `var(--vmarkd-page-bg, var(--vscode-editor-background))`;
      `material-dark.css` was the one theme missing `--vmarkd-page-bg` (live page `#282c34`, the
      overlay would have fallen back to the editor background - the gate caught it), now declared.
      The snapshot's root cell gains `style.page-bg` (the overlay's own container colour; the live stages
      walk up to the first painted ancestor, else the editor background). RED = transparent overlay: 8
      unexplained cells in the harness, 1 in real VS Code (`rgba(0, 0, 0, 0)` vs `rgb(18, 19, 20)`).
      5c: the theme-independent size key + `annotateDiagramSizes` (`src/shared/diagram-size.ts`), the sizes
      kept in the render cache's `index.json` under a separate `sizes` map (the host cannot recompute the
      webview's theme-folding SVG hash at HTML-build time, so the size is NOT a field of the SVG entry;
      backwards compatible, no cache-format tag bump), the webview reports `{sizeKey, size: [w, h, pad]}`
      on the `diagram-render-cached` PUT, `renderForMode(..., diagramSize)` tags the overlay's diagram
      previews, and the `diagram-placeholder` overlay decorator (`editing/diagram-placeholder.ts`) empties
      the source and reserves `aspect-ratio` at `min(100%, w)` (pad folded into the ratio) - or the fixed
      `--vmarkd-geo-diagram-min-h` (160px) when uncached. The 14 `532 step 5` allow entries are deleted;
      the by-design placeholder cells (`marker.svg`, `text.*`, `firstGlyphX` of a diagram kind in
      `overlay>ir`) are exempted in `policy.ts` (`isOverlayPlaceholderCell`), the uncached contract is
      pinned by `parity.spec.ts` instead of the allow-list. The gate measures the CACHED open (harness:
      first open reports the sizes to a stub host, the capture page is rebuilt with them; real VS Code:
      the matrix spec opens, closes and re-opens the file). Real VS Code, mermaid + d2
      (`diagram-overlay-height.spec.ts`): first open jump of the block below = 297px (160 + 160 reserved
      vs 284 + 333 rendered), second open -0.01px. Before: the overlay showed the source (27px per
      diagram, -257px/-229px vs the render). NOT done: 5d (inline cached SVG); the fixed fallback
      height is a guess (160px) - a first-ever open still jumps by |rendered - 160|.
      **Review fixes (2026-10-08):** (A) `STREAM_MIN_CHARS` + `shouldStream()` moved to `src/shared/open-mode.ts`;
      `resolveOpenMode(saved, default, streamed)` pins IR for a streamed document, used by the host overlay
      (reads `performance.streamLargeFiles`) and `vditor-init.ts` (`streamActive`) - one rule. Unit: `open-mode.test.ts`;
      real VS Code: `prerender-open-mode.spec.ts` (>700k doc + `defaultMode: wysiwyg` -> IR overlay), RED with the host
      arg neutralised. (B) `measureDiagramSize` stores the svg's NATURAL size (absolute width/height attrs, pt->px, else
      viewBox; live box only as fallback), so a narrow-pane first render no longer under-reserves a wide pane.
      (C) `reportRenders` keeps a separate `size:<hash>` slot: a zero/hidden measurement posts no size and does not
      block the later report. Unit tests for both, RED with each fix reverted.
- [x] **6. Loose lists survive serialization** (decision 2, DONE 2026-10-08). Layer chosen by measurement:
      (b), a build-time Lute anchor, NOT the planned string repair `restoreLooseLists`. The walkers already
      read the DOM's looseness, but `adjustVditorDOMListTight0` overwrote `data-tight` from the structural
      guess `isTightList` (a list whose items hold at most one `<p>` is "tight" = every loose list), and the
      format renderer's `renderListItem` always trimmed an item and ended it with ONE newline, so no input
      could ever produce a blank line between items. Three count-asserted anchors in `scripts/lute-blob-patch.mjs`
      (`LUTE_LOOSE_LIST_PATCHES`, media/ copy only): L1 `isTightList` (no `data-tight="true"` + an item with a
      direct `<p>` = loose; a list that declares tight keeps the old verdict, so task 391's repair shape is
      untouched), L2 format `renderListItem` (a loose list's item ends with a blank line), L3 the sv
      `renderListItem` (the split-view source pane wrote loose lists tight too; found by the parity gate:
      `preview>sv`). One fix for every consumer: `getValue`, spin, `serializeForHost` incremental, the Preview,
      `reserializeMarkdown`/host write-back, sv. Measured: the string-repair route would have needed the oracle
      round trip at three seams (`getMarkdown.ts` patch, `edit-sync.ts`, `lute-host.ts`) and could not fix the
      sv path; the anchors are 3 spots in one file. Unit: `test/backend/lute-loose-list-patch.test.ts`
      (anchors + 10-shape corpus IR/WYSIWYG/spin/host + sv; RED with the anchors dropped, same-way failures);
      `minimal-diff-writeback.test.ts` fake `rt` updated (it modelled the old loose->tight collapse).
      Real VS Code: new `list-loose.spec.ts` (IR + WYSIWYG: edit inside a loose list -> getValue, saved file and
      Preview `<li><p>`; RED with the stock blob), `list-tight.spec.ts` green, the four `ul-loose` allow
      entries deleted (gate RED before: 4 stale + 1 unexplained `preview>sv`, GREEN after).
      NOT done / residual: task-list items still serialize their checkbox as `[ ]  a` / `[X]` (pre-existing,
      tight or loose, unrelated to looseness).
- [x] **7. Reflow marker does not change wraps** (decision 3): `.vmarkd-softbreak::before` →
      zero-advance (`display:inline-block; width:0; overflow:visible; margin-left: -0.1em`) so the
      soft-break space is the only wrap opportunity, as in the Preview; the policy marks
      `.vmarkd-softbreak` as `editOnly` for marker COUNT but compares rects exactly (the wrap must
      match). Delete the reflow allow entries; `prerender-reflow-parity.spec.ts` folds into the
      gate's reflow-ON boot and is deleted.
      DONE (2026-10-08). `::before` is `inline-block; width:0; overflow:visible` moved by a TRANSFORM
      (`translate(-0.15em, 0.3em)`: centred over the space, dropped below the baseline into the
      leading) — NOT the `margin-left:-0.1em` written above: a negative margin on a 0-wide box still
      advances the line, which left the last line 2px short per marker (measured 888.09 vs 891.19).
      The gate was blind to a wrap on a different word with the same line count (height only moves
      with the count), so it gained `rect.lastLineRight` (right edge of the last text line, prose
      blocks `p/blockquote/ul/ol/li/h*`) and the canon's paragraph / blockquote got long soft-wrapped
      lines. Policy: `isEditOnlyMarkerCell` exempts `marker.softbreak` COUNT on `ir>preview` only.
      The two reflow allow entries are deleted. RED (old CSS, entries deleted): 2 unexplained
      `ir>preview` `rect.lastLineRight` (paragraph -21.84px, blockquote -21.83px, reflow config);
      GREEN after (602/602, 0 unexplained); deliberate restore of the old CSS -> the same 2 RED; md5
      restored. Real VS Code parity-matrix 10/10, soft-break-reflow, reflow-toolbar, hard-break-roundtrip,
      reflow-line-breaks green. `prerender-reflow-parity.spec.ts` is NOT deleted: its IR cells are
      covered by the gate (`overlay>ir`, reflow-ON config: heights, gaps, exact marker count) and
      dropped, but the gate only opens in IR, so its two WYSIWYG-open tests stay.

- [x] **9. Link colour across stages (user, 2026-10-08).** Under `theme.content: auto` (and in the
      allow-list wherever measured) link / autolink colour differs IR↔Preview and IR↔WYSIWYG: make
      the link colour one token (`--vmarkd-link`) applied on every stage; delete the `link` /
      `autolink` allow entries.
- [x] **Follow-up: code block background / font align across IR source panel and Preview (user,
      2026-10-08, "depends on the code-block theme").** DONE 2026-10-09. **Finding: there was no CSS
      divergence to fix.** Measured (chromium harness, `getComputedStyle`; github-light, vscode-dark-2026,
      auto-monokai, +monokai-code, material-dark; then the 10-combo spec below): the IR *painted* render
      `pre.vditor-ir__preview > code`, the IR *expanded editable source* `pre.vditor-ir__marker--pre >
      code` (tagged `.hljs` by code-source.ts) and the Preview `pre > code` have IDENTICAL
      background-color, font-family, font-size and padding in every theme - e.g. github-light
      `rgb(246,248,250)` / `mononoki, Consolas...` / 16px / 16px; vscode-dark-2026 `rgb(36,37,38)` /
      `"Droid Sans Mono"...` / 14px / 16px; auto-monokai and material-dark `rgb(43,43,43)` /
      `rgb(40,44,52)` / mononoki / 11.9px / 11.9px. All driven by the active hljs style link
      (`resolveCodeStyle`), nothing hardcoded. The 8 `code-*` `ir>preview` allow entries (background-color
      + font-family) were a GATE PROBE artifact: the IR probe used an anchor, which lands on the
      collapsed (0x0) source half and walks up to the `div[data-type=code-block]` wrapper - transparent
      background and the PROSE font (`-apple-system...`) - while the Preview probe was the painted `pre`
      (monokai `rgb(43,43,43)` / `monospace`). The same artifact was the `style.line-height` 22.4px vs 21px
      "probe level" entries. Winning rules (both sides): the hljs style sheet's `.hljs` background +
      `code`/`.hljs` font tokens (content-theme code font token). **Fix = the probe**: `code-fence` /
      `code-indented` now probe the painted `code` box on every stage (`select` form in
      `test/parity/elements.ts`: IR/WYSIWYG `div[data-type=code-block] > pre.*__preview > code`, Preview
      `pre > code`). Allow-list: the 4 background/font entries and the 2 line-height entries deleted (6
      of the 51 `532 follow-up` entries), and the now-visible box-level form of the already accepted
      2.38px WYSIWYG offset added (`rect.left` +2.38, `rect.width` -2.38 for both kinds, tagged
      `accepted (user, 2026-10-08)`); no new difference. **Expanded source net** (the gate parks the caret
      and cannot see it): `test/parity/code-source.ts` + `media-src/e2e/code-source-parity.spec.ts`
      (10 content x workbench x code-theme combos incl. auto/monokai/github/a11y-light/obsidian/nord,
      ~3 s each) and `test/vscode-e2e/code-source-parity.spec.ts` (3 real-VS-Code boots, ~10 s each:
      auto, monokai, a11y-light on Light Modern). The config matrix already varies `theme.code` once
      (`+markers+monokai-code`); adding configs would cost ~35 s per real-VS-Code boot, so the code-theme
      axis lives in the dedicated spec instead. RED: allow entries deleted + old probe -> `style.font-family` red in all 10
      configs and `style.background-color` in auto-monokai / auto-high-contrast (ir>preview); GREEN: new probe, 566 measured / 566 allowed / 0
      stale (harness) and 9+1 real-VS-Code matrix boots clean. Deliberate break (main.css rule forcing a
      magenta background + serif on the IR rendered code; code-source.ts not tagging `.hljs`): gate RED on
      `style.background-color` / `style.font-family` (every config), harness spec 10/10 RED, real-VS-Code
      spec RED ("the source <code> lost its .hljs tag"); md5-verified restore.
      **Source text colour - DONE 2026-10-09.** Cause: Vditor's `.vditor-ir__node--expand
      .vditor-ir__marker--pre code { color: var(--textarea-text-color) }` (0,2,1) out-ranked the hljs
      theme's `.hljs { color }` (0,1,0) on the `.hljs`-tagged source `<code>` (`rgb(209,213,218)` vs the
      render's `rgb(201,209,217)` under github-dark/monokai/high-contrast, `rgb(220,220,220)` under vs2015,
      ...: it differed under ALL pairings but github-light, not only monokai/high-contrast). Fix:
      `build.mjs` `patchVditorIndexCss` item 4b scopes Vditor's rule to `code:not(.hljs)` (count-asserted
      anchor), so a tagged source takes its colour from the active hljs style like the render - nothing
      hardcoded. `color` joined `CODE_SOURCE_PROPS`; combos `auto/Monokai` and `auto/High Contrast` added
      to the chromium spec (12 combos) and to the real-VS-Code spec (5 boots). RED: chromium 11/12 and
      real VS Code 5/5 on `color` with the patch made a no-op (md5-verified restore); GREEN 12/12 + 5/5.
- [x] **Diagram margins for ALL engines - DONE 2026-10-09.** The top/bottom `1em` rules listed 10 of the 17
      engines. main.css 3a is now ONE `div:is(<all 17 engine classes>) { margin-block: 1em }`, one class-level
      override cancelling the top margin inside the editors' injected preview (`@surface-only`), and the
      display-math top margin (math keeps its 16px bottom); d2/vega had no margin rule of their own, no
      conflict. The same sweep found vega / vega-lite / stl missing from the panel-reset list and from the
      two code-box-mirror exclusion lists (a vega-lite placeholder was 194px against the 160px minimum, padding
      16px): added. New canon elements `diagram-nomnoml` and `diagram-vega` (vega-lite) - both render
      offline in chromium and real VS Code; the capture's settle expression waits for them and the harness
      counts diagrams from the registry (`DIAGRAM_COUNT`). `engine-registry.test.ts` now pins every
      `:is(.language-...)` group of 6+ engines in main.css to the registry, and the margin rule to
      registry-minus-math (§E 6 engine list = CSS list; the placeholder list already derives from the
      registry). RED: new elements on the old CSS -> `style.margin-top/bottom` expected 14px actual 0px for
      nomnoml and vega in every config; GREEN after; deliberate break (nomnoml + vega-lite dropped from the
      margin list, md5-verified restore) -> unit test x2 and the gate RED. Pinned (allow-list, same
      reasons as d2): nomnoml/vega `ir>preview style.font-family` / `style.line-height` and `ir>wysiwyg
      rect.firstGlyphX`. 616 measured / 616 allowed / 0 stale on both layers.
- **Accepted differences (user, 2026-10-08)** — kept on purpose, tagged `accepted (user, 2026-10-08)` in
  the allow-list: IR vs WYSIWYG frontmatter panel, html blocks, table gap, footnote definitions, the
  2.38px code offset and 1.2px centred-diagram x; the split pane's padding vs the narrow-column Preview.
- [x] **8. Nightly matrix + docs.** DONE 2026-10-08. The nightly/tag workflow runs the FULL tier
      (`npm run test:vscode`, no `VMARKD_FAST`), so `parity-matrix.spec.ts` already runs all 10
      configurations there - no workflow change needed (verified: `.github/workflows/nightly.yml` +
      `playwright.config.ts` `testMatch` unset). Measured 6.4 min wall clock for the 10 boots (24-51 s
      each) at load average ~20 (NOT a quiet box), recorded in `playwright.config.ts` and
      `DEVELOPMENT.md`. Fast tier keeps 1 matrix boot and gains `list-loose.spec.ts` (2 boots, ~32 s);
      `diagram-overlay-height` (~21 s) and `prerender-open-mode` (3 boots, ~44 s) stay full-only.
      Docs: `DEVELOPMENT.md` "Visual parity gate" (allow-list/pinning, new theme, new element) + tier
      table; skills `vmarkd-testing`, `vmarkd-visual-debugging`, `vmarkd-renderer-theming`.
- [ ] **9. End-of-task:** simplify pass, `npm run quality`, coverage check on every new TS module,
      `xvfb-run -a npm run test:vscode:fast`, then propose the full suite (do not start it unasked).

## Tests (summary — details per step)

- **Unit (vitest):** parity registry ≡ fixture; theme-file lint; `main.css` per-surface geometry
  lint; decorator registry ≡ `finish-init`; engine list ≡ CSS list; `resolveOpenMode`;
  `restoreLooseLists` corpus on real Lute; allow-list schema + task references; twin-theme tokens.
- **Chromium harness (CI):** `parity.spec.ts` — 10 configurations × 5 stages (overlay injected from
  Node-Lute output) in ~20s total; `visual.spec.ts` goldens re-based once after step 3 (eyeballed).
- **Real VS Code:** `parity-matrix.spec.ts` (fast: 1 boot; full: 10 boots); `list-loose.spec.ts`;
  the kept `font-parity` + `mode-switch-parity`; the fast tier after every step; full suite at
  hand-over (proposed, not started unasked).
- **RED proof per step:** each step's commit message lists the allow-list entries it deleted and the
  failing cells observed with the entries deleted BEFORE the product change.

## Open decisions for the user (USER DECISION — nothing starts before these)

1. **Target geometry.** Options:
   - **(A) Theme-owned profile, identical on all five stages — RECOMMENDED.** `vscode-*-2026` (and
     `auto` under a VS Code default theme) = VS Code's native preview rhythm (40px lists, 0.7em block
     gap, 1.6 leading, 1.25 headings, 16px+1px code box) on edit AND preview AND overlay; `github-*` =
     GitHub's (2em, 16px, 1.5); `material-dark` and the no-theme default = the DEFAULT profile (sub-
     decision 1b). Reasons: the vscode themes exist to look like VS Code's preview and the user sees
     every stage, so parity is only meaningful if the edit surface moves too (`font-parity` already
     holds the vscode profile to the native preview as the external oracle); github Previews stop
     being 40px (today's side bug); each theme stays faithful to its reference. Cost: edit-surface
     list indent grows 28→40px for the vscode profile (DOM-driven list editing is unaffected; the
     gutter markers are floated and recomputed per step 3).
   - (B) VS Code rhythm everywhere, all themes. Simplest; makes github themes un-GitHub.
   - (C) Vditor's rhythm everywhere (revert task 110). Zero jump with one deletion; gives up the
     VS Code fidelity task 110 was asked for and makes `font-parity` fail by design.
   - **1b. Default profile** (no content theme: `auto` under Monokai / high contrast; material):
     VS Code rhythm (recommended — the editor lives in VS Code and the native preview is the reference
     users compare with) or Vditor's (today's edit values).
2. **Loose-list repair scope:** everywhere (Preview, `getValue`, writeback — recommended, it is a
   fidelity bug on disk too) or Preview-only (zero risk to saved bytes; the on-disk collapse stays).
3. **Reflow marker:** zero-advance glyph in the editor (recommended — Preview stays marker-free and
   wraps match) vs markers in the Preview too vs no marker at all.
4. **Nightly budget:** 10 boots (~12–15 min) as proposed, or trim to the 5 named themes + Monokai
   (6 boots) and keep the variants harness-only.
5. **Overlay diagrams:** stop at placeholder height (5c) or also inline cached SVG bytes (5d —
   HTML size grows by the cached SVGs of the first `MAX_PRERENDER_CHARS` of the document).
6. **ADR shape:** new ADR-0009 superseding the parity clause of ADR-0003 (recommended — the clause
   is a decision reversal, not a clarification) vs an amendment inside ADR-0003.

## See also

- Reports: `tmp/fable-preview/report.md`, `tmp/fable-overlay/report.md` (+ raw json/png/html there);
  probes `tmp/532-probe/{loose,tight}.cjs` (Node Lute, loose-list round-trip).
- ADR-0003 (per-surface contracts — the clause this reverses), ADR-0004 (build-time patch mechanism
  used for `varifyVditorGeometry`), ADR-0005 (system map), ADR-0006 (diagram theming — untouched).
- Tasks 110 (preview-only rhythm, superseded by this), 443 (vscode prose/heading parity — the
  external-oracle spec stays), 480 (code lh fix + the loosened callout check this re-tightens), 83
  (reflow markers), 184 (render cache — placeholder heights), 106/179 (callouts), 61 (minimal-diff
  writeback — loose lists), 282 (`defaultMode`), 448/450 (boot-cost model behind the matrix sizing),
  516 (un-highlighted code-box mirror), 524 (settings hygiene the matrix spec must follow).
- Skills: `vmarkd-renderer-theming`, `vmarkd-visual-debugging`, `vmarkd-testing`,
  `vmarkd-lute-features` (serializer seams).
