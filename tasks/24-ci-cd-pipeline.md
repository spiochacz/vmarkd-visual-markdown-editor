# Task: Proper CI/CD pipeline (with controlled version bumping)

> **Source:** internal — add a PR test gate, consolidate the deploy paths, make
> version bumping deliberate
> **Value / Risk:** 🟢 high (safe, repeatable releases) / medium (touches publishing
> — dry-run first)

## Current state (verified 2026-05-30)
Everything below was read in full; the bones exist but there are real gaps.

- **`.github/workflows/main.yml` ("Deploy Extension")** — manual `workflow_dispatch`.
  `yarn` install → `foy build` → **`npm test`** → publish to **Open VSX** and **VS
  Marketplace** (HaaLeo action, tokens `OPEN_VSX_TOKEN` / `VS_MARKETPLACE_TOKEN`).
  ⚠️ **`npm test` will fail** — root `package.json` has **no `test` script** (only
  `watch`, `start`, `publish:marketplace`, `release:marketplace`, `pub`). Tests live
  in `media-src` (`test`: `node --test src/*.test.ts`, `test:e2e`: `playwright test`).
- **`.github/workflows/publish.yml` ("Publish Extension")** — on `v*` tags. `npm
  install` (root + `media-src`) → `foy build` → `vsce publish` (`VSCE_PAT`, fallback
  `VS_MARKETPLACE_TOKEN`). Clean, but **no test step**.
- **`scripts/release-marketplace.sh`** (clean) — `git pull --ff-only`, **`npm version
  patch`** (hardcoded), patch the README vsix path, `foy build`, `vsce package`,
  `publish:marketplace`, `git push --tags`. ⚠️ **The hardcoded `npm version patch` is
  the root cause of "bump per change"** — every release is a patch, no minor/major,
  and the habit becomes one bump per fix.
- **`scripts/publish-marketplace.sh`** (clean) — loads `.env`, checks `VSCE_PAT`,
  `vsce publish`.
- **`.github/workflows/republish.md`** — a how-to that reinforces `npm version patch`
  on every update.
- **`Foyfile.ts`** — `build` task ends with `git add -A` (a build side-effect that
  stages the whole tree; surprising in CI/local builds).

### Problems to solve
1. **No PR validation** — both workflows are manual/tag deploys; nothing runs on
   `pull_request`. Bad code can reach `master` and a release.
2. **The deploy `npm test` is broken** (no root `test` script) and e2e is never run.
3. **Version bumping is hardcoded to patch** and culturally per-change.
4. **Two overlapping deploy paths** (`main.yml` manual dual-registry vs `publish.yml`
   tag-based vsce) plus two bash scripts — redundant and confusing.

## Goal
- A real **CI** gate on every PR/push: build + unit + e2e + lint.
- **One** release path, where the **version bump lives** — deliberate, parameterized
  (patch/minor/major), committed back, and tagged. No bump per change.
- Fix the broken bits (root `test`, dual deploy, `git add -A`).

Publisher `oleksiiko`; build via `foy` (Foyfile.ts) → esbuild.

---

## Part A — CI workflow (`.github/workflows/ci.yml`)
Trigger: `pull_request` + `push` to `master`.

1. `actions/checkout@v4`, `actions/setup-node@v4` (node 20, cache).
2. Install root + `media-src`.
3. `foy build` (must pass).
4. **Unit tests** — add a root `test` script that delegates:
   `"test": "npm --prefix media-src test"`, then run `npm test`.
5. **E2e** — `npx playwright install --with-deps chromium`, then
   `npm --prefix media-src run test:e2e` (harness already in `media-src/e2e/`).
6. **Lint / type-check** — `tsc --noEmit` (eslint if adopted); wire as a `lint` script.
7. Make these **required status checks** on `master` (branch protection).

## Part B — Release workflow + version policy (the user's ask: bumping lives here)
Consolidate to **one** release path and put the bump in it, done right.

- **Accumulate** changes under `CHANGELOG.md` `[Unreleased]`. **Never bump per change.**
- **Bump once per release**, parameterized and committed:
  - **Option 1 — fix the script:** make the bump an argument instead of hardcoded:
    ```bash
    BUMP="${1:-patch}"          # patch | minor | major
    npm version "$BUMP" -m "chore(release): v%s"   # commits + tags
    git push --follow-tags       # tag triggers publish.yml
    ```
  - **Option 2 — `workflow_dispatch` release:**
    ```yaml
    on: { workflow_dispatch: { inputs: { bump: { default: 'patch' } } } }
    steps:
      - run: npm version ${{ inputs.bump }} -m "chore(release): v%s"
      - run: git push --follow-tags
    ```
- Let the **`v*` tag drive `publish.yml`** (keep that workflow as the single publisher;
  add a test step / `needs:` CI so it never publishes red code).
- On release, move `[Unreleased]` → a dated `## [X.Y.Z]` section in the CHANGELOG.
- Decide the **registries**: keep dual publish (Open VSX + Marketplace) — fold it into
  `publish.yml`, retire `main.yml`'s separate deploy so there's one path. Reconcile the
  token names (`VSCE_PAT` vs `VS_MARKETPLACE_TOKEN` vs `OPEN_VSX_TOKEN`).
- Rewrite `republish.md` to point at the single release flow (republish = re-run the
  tag publish, not a routine patch bump).

## Part C — Fixes / hardening
1. Add the missing root `test` (and `lint`) scripts so `npm test` works everywhere.
2. Remove `git add -A` from `Foyfile.ts`'s `build` task (a build shouldn't stage the
   tree); stage explicitly in the release script only.
3. Collapse the redundant deploy paths (`main.yml` vs `publish.yml` + two scripts) into
   **CI (ci.yml)** + **release/publish (one workflow)** + optional local helper script.
4. Check `.vscode/launch.json` — it appears to contain corrupted/duplicated content
   (separate from CI, but worth cleaning while here).
5. **VSIX hygiene:** verify `.vscodeignore` excludes `sharp` (a dev-only dependency,
   `package.json:156`) and all build cruft (`node_modules/`, `media-src/` sources,
   `out/` analysis docs, `tasks/`) from the packaged `.vsix`. After `vsce package`,
   inspect the archive (`vsce ls` / unzip) to confirm only `out/extension.js` + runtime
   `media/` assets ship. (Overlaps `28-extension-identity.md` step 4.)

## Secrets / config
- `VSCE_PAT` / `VS_MARKETPLACE_TOKEN` — VS Marketplace (publisher `oleksiiko`).
- `OPEN_VSX_TOKEN` — Open VSX.
- Branch protection on `master` requiring CI checks.

## Verify
- Open a PR → CI runs build + unit + e2e + lint; merge blocked if red.
- `npm test` succeeds locally and in CI (root delegates to `media-src`).
- Run the release path with `minor` on a test → version bumped **once** to the chosen
  level, committed + tagged, `publish.yml` triggers, `.vsix` published to both
  registries; repo `package.json` matches the published version. No step double-bumps.

## See also
- `21-backend-tests-vitest.md` — CI's unit step runs vitest once adopted.
- `20-tree-shake-vditor-source-import.md` — add `bundle-size.test.ts` as a CI check.
