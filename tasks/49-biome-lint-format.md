# Task: Adopt Biome (lint + format)

> **Status:** ✅ Done (2026-06-01).
> **Source:** user request (2026-06-01) — the repo had no linter/formatter; only
> `tsc` type-checked. Closes the "Lint / type-check" follow-up noted in task 24 §6.
> **Value / Risk:** 🟢 consistent style + bug-catching / low (one dev-dep, config
> tuned to existing style).
> **Engines:** none.

## Why Biome (not ESLint + Prettier)
Fits the project's deliberate **minimal-tooling** stance ([[toolchain-plain-node-npm]]):
one Rust binary does lint **+** format (vs ESLint + Prettier + `typescript-eslint`
+ `eslint-config-prettier` + plugins), one config, no lint/format conflict. We give
up type-aware lint rules (which `tsc` partly covers) and a third-party plugin
ecosystem we don't need (no React).

## What shipped
- **Dep:** `@biomejs/biome` (root devDep) — single tool.
- **`biome.json`** configured to the **existing** style (so it didn't rewrite the
  world): 2-space indent, single quotes, no semicolons (ASI), 80 cols. Chosen by
  measuring the repo: 67 space-indented files vs 2 tab-indented; only 5 lines in
  all `.ts` ended with `;`. Scoped to our code only (`src`, `media-src/src`,
  `media-src/e2e`, `test`, root + media-src `*.mjs`) — not vendored assets/JSON.
  Respects `.gitignore` (VCS integration).
- **Rules:** `recommended`, minus three tuned off for this codebase:
  - `noExplicitAny` — the code intentionally uses `any` for Vditor's untyped API
    and message payloads (285 of ~360 findings; fighting it = huge churn, no value).
  - `noNonNullAssertion` — intentional `!` (36 findings).
  - `noTemplateCurlyInString` — false positives on literal config tokens like
    `${projectRoot}` / `${fileBasenameNoExtension}`.
- **Scripts:** `lint` (`biome check`), `lint:fix` (`biome check --write`),
  `format` (`biome format --write`).
- **CI gate:** `npx biome ci` step in `.github/workflows/ci.yml` (no-write, before
  Build). PRs now fail on lint/format violations.
- **Cleanup applied:** formatted 20 files (incl. the 2 tab-indented ones →
  spaces); auto-fixed the safe + unsafe-mechanical lints (template literals,
  optional chaining, `node:` import protocol, literal keys, `import type`,
  `const`). Hand-fixed the rest: an unused var, 5 `forEach` expression-bodies →
  block bodies (`useIterableCallbackReturn`), typed `inputTimer`, and 2
  `biome-ignore` on idiomatic `exec()`/TreeWalker assign-in-while loops.

## Verify
- `npm run lint` / `npx biome ci` → exit 0 (clean).
- `node build.mjs` (tsc + esbuild) green; 189 unit tests green — formatting/fixes
  changed no behaviour.
- Open a PR with a style/lint violation → CI's "Lint (biome)" step fails.

## See also
- `24-ci-cd-pipeline.md` §6 — this closes the lint follow-up.
