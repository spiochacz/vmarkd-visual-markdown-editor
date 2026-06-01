# Task: Bun toolchain (package manager + script runner)

> **Status:** ✅ Done (2026-06-01).
> **Source:** user request — out of the dependency-update discussion
> (`out/DEPENDENCY-UPDATES.md`): drop the niche `foy` task runner (and the
> `ts-node` it needs) in favour of Bun.
> **Value / Risk:** 🟢 simpler, faster dev toolchain / low (dev-time only — the
> shipped extension is unchanged).

## Decision / scope
"Light" Bun adoption — Bun as **package manager + script/build runner only**.
Bun installs deps and runs the build directly; it does **not** replace the
workhorse tools. Deliberately kept as-is (Bun just launches them):

- **`tsc`** — compiles the host *and* type-checks (Bun cannot type-check).
- **`playwright`** — drives real chromium (Bun has no browser).
- **`esbuild`** — bundles the webview; replaceable by `Bun.build` but the Vditor
  config (`esbuild-shared.mjs`) is intricate — not worth the migration.
- **`vitest`** — 189 unit tests; replaceable by `bun test` but the `vscode`
  alias + jsdom config make it not worth it.

The extension still ships as plain Node-targeted `tsc` output — VS Code runs it
in its own Node runtime, never Bun.

## What changed
- **`Foyfile.ts` → `build.ts`** — Bun runs TypeScript natively
  (`bun ./build.ts [watch]`). Asset-sync + `tsc` + webview-build logic preserved
  1:1. Removes the `foy` task runner and `ts-node`.
- **`package.json`** — added `build`; `watch`/`start` point at `build.ts`;
  dropped `foy` + `ts-node` from devDependencies.
- **Lockfiles** — `bun.lock` (root + `media-src`) replace `package-lock.json`.
- **CI** (`main.yml`, `publish.yml`) — `oven-sh/setup-bun` +
  `bun install --frozen-lockfile` + `bun ./build.ts` + `bun run test`.
- **`scripts/release-marketplace.sh`** — `foy`/`npx` → `bun`/`bunx`
  (`npm version patch` kept for the git tag — see task 24 for the bump-policy fix).
- **`.vscodeignore` / `tsconfig` exclude** — `Foyfile.ts` → `build.ts`; ignore
  `bun.lock` in the `.vsix`.
- **`DEVELOPMENT.md`** — documents the Bun-only workflow (correct
  `bun run --cwd media-src <script>` form).

## Deliberate carry-overs (not done here — belong to task 24)
- `build.ts` still ends with **`git add -A`** (1:1 with the old Foyfile). The
  release flow relies on it. Removing it is **task 24 Part C #2**.
- Source maps still ship in the `.vsix` (`**/*.map`) — kept on purpose (debug
  aid). Stripping them is **task 24 §5**.

## Verify
- `bun ./build.ts` → host (`out/extension.js`) + webview (`media/dist/main.js`)
  build green.
- `bun run test` → 189 unit pass; `bun run --cwd media-src test:e2e` → 56 e2e pass.
- `bunx @vscode/vsce package` produces a working `.vsix`.
- No `foy` / `ts-node` anywhere (`grep`, `bun.lock`).

## See also
- `24-ci-cd-pipeline.md` — its "Current state" predates this; the `git add -A`
  removal and VSIX source-map trim live there.
