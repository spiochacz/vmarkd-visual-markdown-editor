# Task: Upgrade the Lute markdown engine to the latest from 88250/lute

> **Status:** ✅ Done (2026-06-04) — pinned to master `36ea9e0`, vendored + build-integrated, 281 tests green, VSIX verified, confirmed in-editor.
> **Source:** User request (2026-06-03) — bump the Lute parser vditor uses to the newest `master`.
> **Value / Risk:** 🟡 security (`Sanitize` advisory) + parse/table/math fidelity fixes / medium — fidelity-drift risk, vditor mode is lightly tested upstream now

## Problem
vditor `3.11.2` bundles Lute compiled from tag **v1.7.6, build `2023-02-17`** (`media-src/node_modules/vditor/dist/js/lute/lute.min.js`, GopherJS / go1.19.13). Lute `master` is **+515 commits** ahead (HEAD `36ea9e0`, 2026-06-03) — ~3 years of fixes that never landed in vditor because vditor's npm release froze at 3.11.2 (its git HEAD `86c2aaf` ≈ the same tag, so bumping vditor itself yields nothing).

Relevant changes in those 515 commits (mostly SiYuan/Protyle-driven — 192 `protyle` vs 7 `vditor` mentions — but the shared `parse/`/`lex/`/`ast/`/`render/` core feeds vditor's IR/WYSIWYG/SV modes):
- 🔒 security advisory `GHSA-w7cg-whh7-xp28` touching `Sanitize` (vditor uses `Lute.Sanitize` for HTML cleanup)
- direct vditor fixes: sup/sub input (`vditor#1822`), `linkBase` on inserted HTML (`#214`), `|` in inline math in tables (`vditor#1550` — overlaps task 60), autolink parsing (`lute#190` / `vditor#1513`)
- shared-core: em / inline-element / math-block / table parsing improvements

## Goal
vditor runs on a newer, pinned Lute build with the security and fidelity fixes, **without round-trip regressions** in IR/WYSIWYG/SV editing.

## Compatibility (already verified — see analysis)
- All ~50 Lute methods vditor calls still exist on `master`: statics in `javascript/main.go` (`New/Caret/Sanitize/Version/EscapeHTMLStr/NewNodeID/WalkContinue`), instance methods (`Md2VditorIRDOM`, `SpinVditorIRDOM`, `VditorDOM2Md`, `SetJSRenderers`, `SetMark`, `SetGFMAutoLink`, …) in `vditor_*.go`/`lute.go`/`h2m.go`, exposed via `js.MakeWrapper`. `vditor_ir.go`/`vditor_wysiwyg.go`/`vditor_sv.go` are maintained.
- **⚠️ one signature change:** `New()` → `New(options)`. vditor calls `Lute.New()` with no arg (`setLute.ts`) then `SetJSRenderers(...)` separately — likely fine under GopherJS (nil arg), but **first thing to test** (esp. wiki-link renderers in `custom-renderer.ts`).

## Steps
1. **Pin a specific Lute commit** (not the moving `master` HEAD) for reproducibility; record the SHA in this task.
2. Grab the prebuilt `javascript/lute.min.js` + `.map` from that commit (Lute commits the GopherJS artifact — **no Go→JS build needed**). Fallback if a chosen commit lacks the artifact: `gopherjs build --tags javascript -o lute.min.js -m` with GopherJS + Go 1.20.
3. **Vendor** the file into the repo (e.g. `media-src/vendor/lute/lute.min.js` + `.map`) — `node_modules` is not committed, so a raw swap is wiped on `npm install`.
4. Add a step in `build.mjs` that overwrites `media/vditor/dist/js/lute/lute.min.js` (+ `.map`) with the vendored file **after** `syncVditorAssets()`.
5. **License compliance (Mulan PSL v2).** Lute is licensed under **Mulan PSL v2** — permissive (MIT/Apache-like, *not* copyleft), so bundling/patching into our MIT extension is fine, but §4 requires, on distribution (the VSIX): (a) ship a copy of the license, (b) retain Lute's copyright/patent/trademark/disclaimer notices. So alongside the vendored binary add:
   - `media-src/vendor/lute/LICENSE` — full Mulan PSL v2 text (from `88250/lute/LICENSE`).
   - `media-src/vendor/lute/NOTICE` (or fields in `source.json`) — `Copyright (c) 2019-present, b3log.org · Mulan PSL v2 · source: 88250/lute@<SHA>`.
   - Ensure the license/notice is included in the packaged VSIX (check `.vscodeignore` doesn't exclude `media-src/vendor/lute/` — or copy the notice into a shipped path). Note: we *already* redistribute `lute.min.js` indirectly via the `vditor` dependency, so this formalizes existing attribution rather than adding a new obligation; no copyleft / source-disclosure / relicensing required.
6. `node build.mjs`, install locally, smoke-test.

## Compat test strategy (to build during execution)
Build a differential harness: load two `lute.min.js` builds in plain Node (GopherJS needs `window=global` + one scheduler tick before `global.Lute` is set, then `Lute.New()`), run the same corpus through every method Vditor calls, and diff outputs. Two layers: API presence (`typeof lute[m]==='function'` for the ~50 methods) and behavioral diff of `Md2VditorIRDOM`/`VditorIRDOM2Md` (+ WYSIWYG), `Md2HTML`, and static `Lute.Sanitize`. Corpus: the repo's real `.md` files + Lute's own `test/spin_ir_test.go`/`spin_wysiwyg_test.go` cases (input DOM) + a few XSS snippets for `Sanitize`. Spawn one Node process per build to avoid the `global.Lute` collision.

**Baseline already measured (2026-06-03, throwaway harness):** shipped v1.7.6 vs both `fa3e64ef` and `master` → full API compat. On synthetic corpus (374 DOM + md + XSS): 790/790 identical. On the **81 real repo `.md` files**: `fa3e64ef` 492/492 identical; `master` differs in 2 files — 6 diffs in `tasks/21` where **master FIXES a data-loss bug** (current Lute drops the content of `- [x] N. text` task items on round-trip) + 1 cosmetic list-indent reflow in `tasks/28`. ⇒ drift risk low; `master` additionally fixes a real fidelity bug. Pin choice (`fa3e64ef` vs `master`) is mostly about whether to take the 4 post-Aug-2025 `Sanitize` GHSA fixes (see `tasks/67`).

## Verify
- **Re-run the differential harness on the user's real `.md` files** for the chosen candidate before committing — the one signal a synthetic corpus can't provide. Pay special attention to the `- [x] N. text` task-item case.
- **Round-trip / fidelity pass** (the real risk) on: tables (merged cells, inline math, space before `**`/`` ` ``), task lists, sup/sub, autolinks, math blocks, code blocks, HTML paste. Scenarios from `tasks/56`/`57`/`60` and `tasks/65` are ready fixtures. Compare saved source old-Lute vs new-Lute.
- Wiki-link chips still render (`custom-renderer.ts` `SetJSRenderers` after the `New()` signature change).
- Streaming render still works (`stream-render.ts` calls `lute.Md2VditorIRDOM`).
- Keep the old `lute.min.js` for rollback.

## See also
- Lute upstream: `88250/lute` `master` (HEAD `36ea9e0`, 2026-06-03), Mulan PSL v2; pin a specific commit SHA. API compat + baseline diff results are inline above.
- **Not fixed by this task:** `tasks/56` (listToggle) and `tasks/57` (KaTeX `throwOnError`) are vditor TS code, not Lute. `tasks/60` (table-cell trim) *may* partially benefit (the `|`-in-math-in-table commit).
- Build pipeline: `build.mjs` (`syncVditorAssets`), Lute load at `vditor/src/ts/markdown/previewRender.ts:59`, `setLute.ts`.
