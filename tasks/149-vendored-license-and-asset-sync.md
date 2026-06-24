# Task 149 — Vendored-asset license compliance + build asset-sync consolidation

> **Status:** ✅ DONE 2026-06-24 — items 1,2,3,5 + the regression test landed; item 4 satisfied via
> documented re-pin procedure (generic fetcher deferred, see below). Created from a multi-agent
> whole-system architecture review (8-dimension workflow). **The license item was ship-class.**
>
> **Implemented:**
> - **Item 1 (license compliance) ✅** — the new `syncVendored()` engine copies `LICENSE`/`NOTICE` for
>   every vendored lib into `media/`; PlantUML's missing licenses vendored (`vendor/plantuml/LICENSE`
>   = plantuml-mit MIT, `viz-global.LICENSE` = @viz-js/viz MIT — source.json's "Apache-2.0" claim was
>   wrong, corrected). Verified end-to-end via `vsce ls`: `d2.LICENSE` (MPL-2.0), `elk.LICENSE`
>   (EPL-2.0), both plantuml licenses + all others are in the package list.
> - **Item 2 (consolidation) ✅** — 15 hand-rolled `syncX` fns (~520 LOC) → one `VENDORED_ASSETS` table
>   (`media-src/vendor/vendored-assets.mjs`, importable for the test) + `syncVendored()` engine in
>   `build.mjs` (build.mjs −520/+31). Tolerates both source.json sha shapes (files-map + top-level).
> - **Item 3 (mkdir) ✅** — engine always `mkdir`s the target.
> - **Item 5 (orphaned deps) ✅** — removed graphre/nomnoml/smiles-drawer/topojson-client from root
>   devDeps + graphre/nomnoml from media-src; both lockfiles reconciled (`npm ci` stays green).
> - **Regression test ✅** — `test/backend/vendored-licenses.test.ts` (56 cases): every entry declares
>   a license, every declared license + copy-source file exists, every pinned vendor dir is in the
>   table (no silent un-sync), explicit copyleft guards for d2/elk/plantuml.
> - **Item 4 (re-pin) ◑** — re-pin procedure documented in the `vendored-assets.mjs` header
>   (fetch-*.mjs for lute/mermaid/echarts; build-d2-wasm.sh for d2; manual download→sha256→source.json
>   for the rest). A generic `fetch-vendor.mjs` was **deliberately deferred**: d2 (Go→WASM build), elk
>   (esbuild bundle) and markmap (concat) are custom-built, so a one-size fetcher is the wrong tool;
>   the sha-gate already catches a bad manual re-pin loudly.
>
> **Verified:** `node build.mjs` green (all 15 verified+installed); `npm run lint:ci` green;
> `npm test` green (74 files / 840 tests, incl. the new 56). Not committed (user controls git).
> **Source:** architecture review (2026-06-24), build-deps lane, adversarially verified.
> **Value / Risk:** 🔴 closes a real marketplace-distribution legal defect + removes the build
> accretion that caused it / low — additive build work, no runtime change.

## Why this exists
The five focused reviews this session (144–148) were each feature-scoped, so no one owned the
**distribution/legal** axis. The whole-system pass found the published VSIX is non-compliant.

## Findings → work items

### 1. 🔴 Published VSIX omits license text for ~12 of 15 vendored libraries
`build.mjs` copies `LICENSE`/`NOTICE` into the shipped `media/` tree ONLY in `syncLute` (:311),
`syncMermaid` (:356), `syncEcharts` (:399). `.vscodeignore:3` excludes `media-src/` but `media/` **is**
packaged → the VSIX ships `d2-compile.wasm` (**MPL-2.0**, copyleft) and bundled `elk-main.js`
(**EPL-2.0**, copyleft) **with no license text**, which both licenses legally require to accompany the
binary. PlantUML ships with no vendored license at all despite `source.json` declaring MIT/Apache-2.0.
- **Fix:** propagate `LICENSE`/`NOTICE` for EVERY vendored asset into `media/` (fold into the
  `syncVendored()` engine in item 2 so it can't be forgotten per-lib); add an esbuild **license
  banner** to the bundled `elk-main.js`; vendor PlantUML's MIT/Apache text. Optionally ship one
  aggregated `THIRD-PARTY-NOTICES` at the package root referenced from the README.
- **Regression net:** a test asserting every shipped vendored binary under `media/` has an
  accompanying license file, so the omission can't recur.

### 2. 🟠 Asset-sync is 15 hand-rolled near-identical functions (~360 LOC), inconsistent shapes
`build.mjs:275-803` defines `syncLute`…`syncMarkmap`, each repeating read-`source.json` /
sha256-verify / copy. Shapes diverge: single top-level sha (lute/mermaid/echarts) vs a `source.files`
map (the rest); some log a missing-pin warning (`:286,336,380`) while others **silently return**
(`:524,554,586,620,660,688,718,750`); only 3 copy a license (the root cause of item 1). This is the
exact accretion the TS-patch side already escaped via the declarative `VDITOR_TS_PATCHES` registry.
- **Fix:** mirror that registry — one `VENDORED_ASSETS` table `[{name, files, copyLicense, mkdir}]`
  driven by a single `syncVendored(entry)` that uniformly sha-verifies, mkdirs, copies the binary
  **and** its license, and logs a **consistent** missing-pin warning. The orchestration block
  (`build.mjs:836-853`) becomes a loop. Self-resolves items 1, 3, 4.

### 3. 🟡 `syncAbcjs`/`syncSmilesDrawer`/`syncMarkmap` copy without `mkdir`
`build.mjs` copyFile at `:472 / :505 / :798` with no preceding `fs.mkdir`, unlike the 11 siblings that
mkdir defensively — they rely on Vditor's dist having pre-shipped a same-named dir (graphviz + mathjax
were already dropped from Vditor's dist, so this is plausible to break with an ENOENT). The always-mkdir
`syncVendored()` engine (item 2) fixes this.

### 4. 🟡 Re-pin reproducibility documented for only 3 of 15 libs
`media-src/scripts/` has only `fetch-{lute,mermaid,echarts}.mjs`; the other 12 have no fetch/re-pin
script and no `source.json` note. Build-from-clone reproducibility is intact (sha-guard catches manual
errors loudly), but re-pinning (CVE/version bumps) is undocumented manual work.
- **Fix:** a generic `fetch-vendor.mjs <name> <version|url>` that downloads, sha256s, and rewrites the
  registry entry — or at minimum a per-asset re-pin `note` in each `source.json`. Pairs with item 2.

### 5. 🟡 Four orphaned root devDependencies
`package.json:635-639` lists `graphre`, `nomnoml`, `smiles-drawer`, `topojson-client` — zero imports
across `src/`, `test/`, `media-src/src/`, `*.mjs` (the renderers consume the **vendored** min.js by
path+sha). `graphre`+`nomnoml` are ALSO duplicated unused in `media-src/package.json`. Dev-only (no
VSIX impact). Remove them.

## Tests (per AGENTS)
- **unit/build** — assert every shipped vendored binary under `media/` has a license file (item 1);
  assert `VENDORED_ASSETS` table covers all synced libs (no silent gaps).

## See also
- `build.mjs` (`sync*` + orchestration `:836`), `.vscodeignore`, `media-src/vendor/*/source.json`,
  `media-src/esbuild-shared.mjs` (`VDITOR_TS_PATCHES` — the model to copy). Tasks 145 (bundle/perf —
  the same `media/` tree), 147 (patch-engine — the declarative-registry pattern this mirrors).
