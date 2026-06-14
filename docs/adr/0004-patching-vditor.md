# ADR-0004 — Patching Vditor at build time

- **Status:** Accepted
- **Date:** 2026-06-14
- **Tags:** vditor, build, esbuild, css, patching, architecture
- **Related:** ADR-0003 (CSS theming — "behaviour → esbuild TS patch", "Vditor-origin CSS → build-time source-patch"), `media-src/esbuild-shared.mjs` (`VDITOR_TS_PATCHES` + `vditorSourcePatches`), `build.mjs` (`patchVditorIndexCss`, `varifyVditorPalette`, `syncVditorAssets`), `src/html-builder.ts` (the `index.css` `<link>`).

## Context

vMarkd embeds **Vditor** (vendored under `media-src/node_modules/vditor`) and must change some of
its behaviour and CSS. A fork is on the table long-term, but until then we patch at build time.
Two questions decide every patch: **what kind of thing am I changing (TS behaviour vs CSS)** and
**which copy of the asset does the surface that needs the change actually load.** Get the second
wrong and the patch silently does nothing on the surface you care about while still looking
"fixed" on another (the harness).

### One copy of every asset (this used to be two)

Vditor's TS is only ever consumed by being bundled from source (`media-src/src/*.ts` →
esbuild → `media/dist/main.js`). Vditor's CSS (`index.css`, the content-themes) is loaded by a
`<link>` to the **copied** `media/vditor/dist/…` assets (`build.mjs syncVditorAssets()` copies
node_modules → `media/`), by every surface: the **real editor** (`src/html-builder.ts` links it),
the **Playwright harness** (`/vditor/…` link), and the **HTML-export** feature. One copy, linked
everywhere — so a single build-time source-patch of the copied file reaches all of them.

> **History (why the rules below exist).** `index.css` used to also be **bundled** into
> `media/dist/main.css` via `main.ts: import 'vditor/dist/index.css'`. That created a SECOND copy
> (bundled from the *unpatched* node_modules) that only the editor loaded, while `build.mjs`
> patched only the *copied* `media/` one (harness + export). The two drifted: a WYSIWYG
> inline-code-padding fix went green in the harness but the editor still showed Vditor's
> `0 !important` (the harness loaded the patched copy, the editor the unpatched bundle). Fixed by
> dropping the bundle import and linking the patched `media/` copy in the editor too — so there is
> now ONE copy of `index.css` and no CSS bundle-patch mechanism at all. (ADR-0004 simplification B.)

## Decision

### Two patch mechanisms — pick by what you're changing

1. **Vditor TS behaviour** → **esbuild `onLoad` source patch**, declared in the
   `VDITOR_TS_PATCHES` registry and applied by the single `vditorSourcePatches` engine plugin
   (`media-src/esbuild-shared.mjs`). Each entry is `{ file: <filter>, transform: (code, path) => code }`;
   the transform is an **anchor-asserted** `patchXxx` function (e.g. `patchIrLinkClick`,
   `patchMathRender`, `patchCalloutArrowNav`). A file touched by more than one patch chains them in
   one transform (esbuild runs only the first matching `onLoad` per file). Reaches the bundle (the
   only thing that consumes Vditor TS). Adding a patch = write the asserted `patchXxx` + one
   registry row.

2. **Vditor CSS** → **`build.mjs` source-patch** of the copied `media/vditor/dist/…` file, run
   AFTER `syncVditorAssets()`. Examples: `varifyVditorPalette` (palette literals →
   `var(--vmarkd-*)`), `patchVditorIndexCss` (WYSIWYG inline-code padding `0` →
   `var(--vmarkd-code-px, .4em)`). Reaches every surface, because every surface links that one copy.

### Rules for every patch

- **Anchor-assert and throw on miss.** Each patch checks its exact source anchor and throws a named
  error if absent, so a Vditor version bump **fails the build loudly** instead of silently no-op-ing.
- **Token-drive values** where a theme should vary them: rewrite to `var(--vmarkd-*, <default>)`
  rather than a literal, so themes stay the single source (ADR-0003).
- **Prefer fixing Vditor's own rule at the source over a higher-specificity override in `main.css`.**
  An override leaves Vditor's wrong rule in place plus a rule to maintain; patching the source makes
  the actual rule correct (cleaner cascade, nothing to out-rank). Reserve `main.css` `!important` for
  what we genuinely can't patch (VS Code injected defaults — ADR-0003).
- **CSS load order is a contract.** The editor links `media/vditor/dist/index.css` **before**
  `media/dist/main.css` (`html-builder.ts`), so our bundle still wins equal-specificity ties — the
  same order the harness HTML uses. If you add a Vditor CSS `<link>`, keep our CSS after it.
- **Verify in the REAL webview, not just the harness.** Use the real-vscode suite
  (`test/vscode-e2e/`) for anything touching a Vditor asset; it loads exactly what ships and is the
  only thing that caught the (now-removed) bundled/copied drift.

## Alternatives considered

- **Runtime `main.css` override** (higher specificity + `!important`) instead of patching the source —
  works and reaches the editor, but leaves Vditor's wrong rule and an override to maintain. Use only
  when the rule can't be patched at source.
- **Bundling `index.css`** (`import 'vditor/dist/index.css'`) — rejected/removed: it created the
  unpatched second copy and the editor/harness drift (see History). Linking the single patched copy
  is simpler and drift-free.
- **Patch the node_modules file in place** before bundling — fragile: `npm ci` / reinstall resets it,
  not reproducible. The esbuild `onLoad` rewrite is hermetic (operates on read, not on disk).
- **Cache-buster (`?v=`) on index.css** — does NOT apply: the editor links the same file as the
  harness/export. `?v=` matters only for runtime-`<link>`-loaded vendored JS (mermaid/echarts —
  `patchMermaidVersion`/`patchEchartsVersion`).
- **Fork Vditor** — the accepted long-term backstop; until the anchor-asserted patches become
  unmanageable, the build patches win on maintenance cost.

## Consequences

- **+** One copy of every asset, two mechanisms (TS bundle-patch via the registry, CSS source-patch
  of the copied file). No "patched it but the editor didn't change" class of bug.
- **+** TS patches live in one declarative registry — adding/auditing them is a table edit, and the
  near-identical per-patch plugin boilerplate is gone.
- **+** Anchor asserts turn a Vditor bump into a loud build failure at the exact patch site.
- **−** Relies on Vditor source anchors — drift risk, mitigated by the asserts; a fork removes it.
- **−** Requires the real-vscode suite (slower, ad-hoc, WSLg/display) to truly verify Vditor-asset patches.
