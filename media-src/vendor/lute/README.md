# Vendored Lute engine

Lute (`88250/lute`) is the GopherJS-compiled markdown parser Vditor loads as
`lute.min.js`. Vditor's npm release froze at an old Lute (tag **v1.7.6**, built
2023), so we **vendor a prebuilt build pinned to a specific `master` commit** —
reproducible, offline, and with the parse/table/math + `Sanitize` fixes that never
reached the npm release. See `tasks/66-lute-engine-upgrade.md` for the rationale.

## Files here

| file | what |
|------|------|
| `lute.min.js` / `.map` | the vendored GopherJS bundle (prebuilt; **no Go→JS build needed**) |
| `source.json` | the pin: `commit`, `committedAt`, `sha256`, `goVersion`, license |
| `LICENSE` / `NOTICE` | Mulan PSL v2 text + attribution (required on redistribution) |

`build.mjs` (`syncLute()`) verifies `lute.min.js` against `source.json.sha256`
and copies it over Vditor's bundled copy after `syncVditorAssets()`. The
About/Info dialog links the pinned `commit` + `committedAt` (see the
`fixInfoVersion` esbuild patch in `media-src/esbuild-shared.mjs`).

## Upgrade to the newest Lute

All commands run from the **repo root**. The helper is
`media-src/scripts/fetch-lute.mjs`.

```sh
# 1. List recent commits that actually rebuilt javascript/lute.min.js
#    (only these are valid pins — the artifact is committed, so an arbitrary
#    commit may not have a fresh bundle). Shows date · sha · message.
node media-src/scripts/fetch-lute.mjs --list 20

# 2. Pin one. Fetches lute.min.js + .map + LICENSE at that SHA, records the
#    commit date (from the GitHub API) + sha256 into source.json.
node media-src/scripts/fetch-lute.mjs <commit-sha>

# 3. Rebuild — build.mjs verifies the sha256 and installs the new engine.
node build.mjs
```

GitHub raw/API are unauthenticated here; if you hit a rate limit, retry or set
`GH_TOKEN`. A network failure while fetching the commit date is non-fatal —
`committedAt` is just left empty (the About dialog then shows the sha without a date).

## Before committing an upgrade — verify round-trip fidelity

The real risk is **serialization drift** (a doc that round-trips differently on the
new engine = silent data change), not API breakage. Vditor's mode is lightly tested
upstream, so check it yourself:

1. **Differential harness** (the signal a synthetic corpus can't give): run the
   repo's real `.md` files through both the old and new `lute.min.js` and diff
   `Md2VditorIRDOM` / `VditorIRDOM2Md` (+ WYSIWYG), `Md2HTML`, and static `Sanitize`.
   GopherJS loads in Node with `window = global` + one scheduler tick before
   `global.Lute` is set; spawn one process per build to avoid the `global.Lute`
   collision. See `tasks/66` for the method and the last baseline.
2. **Fidelity pass** on the known-fragile cases: tables (merged cells, inline math,
   space before `**`/`` ` ``), task lists (esp. `- [x] N. text`), sup/sub, autolinks,
   math blocks, code blocks, HTML paste. Fixtures: `tasks/56/57/60/65`.
3. Run the suite: `npm test` (unit, repo root) + `npm run test:e2e` (webview, from
   `media-src/`), then smoke-test in VS Code (`node build.mjs` → install the VSIX →
   wiki-link chips + streaming render).
4. **Keep the previous `lute.min.js` for rollback** until the new pin is confirmed.

## Notes / gotchas

- `Lute.Version` reports the **base tag** (e.g. `1.7.6`) even on a `master` build
  hundreds of commits ahead — it's not bumped between tags. Trust `source.json.commit`,
  not the version string. (This is exactly why the About dialog shows the commit, not
  the version.)
- One known API change across the range: `New()` → `New(options)`. Vditor calls
  `Lute.New()` with no arg then `SetJSRenderers(...)` separately — fine under GopherJS
  (nil arg), but re-verify wiki-link renderers (`custom-renderer.ts`) after a bump.
- **License (Mulan PSL v2, §4):** on distribution (the VSIX) ship `LICENSE` + retain
  `NOTICE`. `fetch-lute.mjs` regenerates both; don't drop them from the packaged tree.
